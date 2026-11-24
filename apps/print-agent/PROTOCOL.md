# Giao thức Print Agent <-> Server (v1)

Bám đặc tả `docs/specs/02-in-phieu-va-thanh-toan-gop-ban.md` mục A5. Kiểu TypeScript chuẩn: `src/protocol.ts` và `src/document/types.ts`.
Server giả lập chạy đúng giao thức này: `src/mock/mock-server.ts` (dùng làm chuẩn để backend đối chiếu).

## 1. Chung

- Tất cả endpoint ở `/api/v1/agent/*`, JSON UTF-8. Agent luôn chủ động gọi (quán không mở cổng).
- Xác thực: `Authorization: Bearer <agentToken>`. Token sai/bị thu hồi: `401` (`{"message":"Token máy in không hợp lệ"}`). Agent gặp 401 thì log lỗi, chờ >= 30 giây rồi thử lại (không dừng).
- Chỉ HTTPS (agent từ chối `http://` trừ localhost hoặc khi bật `allowInsecureHttp`).
- Giờ: ISO 8601 UTC. Agent hiệu chỉnh đồng hồ theo `serverTime` ở poll/heartbeat khi kiểm tra hạn thuê.
- Server xác định quán và agent từ token; agent không gửi storeId. Mỗi máy in thuộc đúng một agent; job chỉ giao cho agent sở hữu `printerId`.

## 2. Endpoint

### 2.1 `POST /agent/heartbeat` (mỗi 15 giây)
Request:
```json
{ "version": "0.1.0",
  "printers": [ { "printerId": "uuid", "reachable": true, "status": "OK|PAPER_OUT|COVER_OPEN|ERROR", "detail": "Sắp hết giấy" } ] }
```
`status` bỏ trống nếu máy in không trả lời lệnh truy vấn (DLE EOT) - lúc đó chỉ biết `reachable`. Response `200`: `{ "serverTime": "ISO" }`.
Server: cập nhật `PrintAgent.lastSeenAt`, `Printer.status/statusDetail/lastSeenAt`. (Đặc tả cho phép trả thêm `printers[]` cấu hình; agent v0.1 dùng cấu hình cục bộ, bỏ qua trường này.)

### 2.2 `GET /agent/jobs/next?wait=20&max=5` (poll dài)
- Nhận tối đa `max` job `PENDING` đến hạn (`nextAttemptAt <= now`) của máy in thuộc agent, theo `createdAt`, đặt `SENT`, `leaseUntil = now + 60s`, `attemptCount += 1` (`UPDATE ... FOR UPDATE SKIP LOCKED`).
- Không có job: giữ kết nối tối đa `wait` giây (agent chấp nhận số lẻ, `0` = trả ngay) rồi trả mảng rỗng. Client ngắt kết nối giữa chừng thì job vừa thuê phải trả về `PENDING` (mock đã làm).
- Response `200`: `{ "jobs": [AgentJob...], "serverTime": "ISO" }`. (Agent cũng chấp nhận mảng trần `[...]`.)
- Timeout HTTP phía agent = `wait + 10` giây.

`AgentJob`:
```json
{ "id": "uuid", "jobType": "KITCHEN_TICKET", "printerId": "uuid",
  "attemptCount": 1, "maxAttempts": 3,
  "leaseUntil": "2026-11-12T12:43:00.000Z", "createdAt": "2026-11-12T12:42:00.000Z",
  "copies": 1, "openDrawer": false, "dedupeKey": "ticket:<orderId>:KITCHEN",
  "payload": { "kind": "kitchen_ticket", "data": { } } }
```
`jobType`: `KITCHEN_TICKET | BILL | PRE_BILL | CANCEL | REPRINT | TEST | DRAWER | TABLE_MOVE`. Khu Bếp/Bar do server định tuyến: mỗi khu một job tới `printerId` tương ứng; `stationLabel` ("Bếp"/"Bar") nằm trong `payload.data` để in trên phiếu. Tham chiếu đơn/bill/bàn/đợt nằm trong `data` (`orderNumber`, `round`, `tableCode`, `billNo`); agent không cần id nội bộ.
`REPRINT`: dùng cùng loại payload với bản gốc kèm `data.reprint = { count }`.

### 2.3 `POST /agent/jobs/:id/result`
Request:
```json
{ "ok": true, "durationMs": 120, "printerStatus": "OK" }
{ "ok": false, "error": "Máy in ... từ chối kết nối", "errorCode": "PRINTER_REFUSED", "retryable": true, "printerStatus": "ERROR", "durationMs": 300 }
{ "ok": true, "note": "DEDUPED", "durationMs": 0 }
```
Server:
- `ok`: `PRINTED`, `printedAt`. Chấp nhận cả khi job đã bị trả về `PENDING` do hết hạn thuê (tránh in lần hai).
- `ok=false`: nếu `retryable !== false` và `attemptCount < maxAttempts` -> `PENDING`, `nextAttemptAt = now + {5s,15s,45s}[attemptCount-1]`; ngược lại `FAILED` và phát `print.failed`. Lưu `lastError`, `errorCode`.
- Idempotent: gửi lại kết quả cho job đã `PRINTED/FAILED/CANCELLED` trả `200` với trạng thái hiện tại, không đổi.
- Response `200`: `{ "status": "PENDING|SENT|PRINTED|FAILED|CANCELLED" }`. `404` job không tồn tại/không thuộc agent; `4xx` khác agent coi là "server không nhận nữa" và bỏ kết quả đó. `5xx/429/mạng`: agent lưu kết quả vào hàng chờ cục bộ (`data/state.json`) và gửi lại cho tới khi được nhận.
- `note: "DEDUPED"`: agent thấy job đã in rồi (danh sách 500 job gần nhất) nên không in lại.

## 3. Mã lỗi (`errorCode`)

| Mã | Ý nghĩa | retryable |
|---|---|---|
| `PRINTER_UNREACHABLE` | không thấy máy in trên mạng | true |
| `PRINTER_REFUSED` | máy in từ chối kết nối (tắt/sai cổng) | true |
| `PRINTER_TIMEOUT` | quá thời gian kết nối/ghi | true |
| `PRINTER_IO` | lỗi socket khác | true |
| `PRINTER_NOT_CONFIGURED` | `printerId` không có trong cấu hình agent | false |
| `PRINTER_HOST_REJECTED` | địa chỉ máy in bị chặn (không phải IP nội bộ) | false |
| `INVALID_PAYLOAD` | payload sai định dạng | false |
| `RENDER_FAILED` | lỗi dựng phiếu/vẽ chữ | false |
| `JOB_EXPIRED` | job cũ hơn `maxJobAgeMinutes` (mặc định 15) | false |
| `UNSUPPORTED_TRANSPORT` | kiểu kết nối chưa hỗ trợ | false |

## 4. Vòng đời và an toàn in trùng

`PENDING -> SENT (thuê 60s) -> PRINTED | PENDING (lỗi, có lùi) | FAILED`. Quá hạn thuê chưa có kết quả: server trả `PENDING` (hoặc `FAILED` nếu hết lượt). Agent bỏ qua job đã hết hạn thuê khi nhận được (theo đồng hồ server), để người khác in. Cơ chế "ít nhất một lần"; phiếu in đôi chấp nhận được hơn mất phiếu. `dedupeKey` do server dùng để không tạo job trùng (`@@unique([storeId, dedupeKey])`), agent chỉ chuyển tiếp.

## 5. Payload (`payload.kind`)

| kind | Nội dung | Ghi chú |
|---|---|---|
| `kitchen_ticket` | `data: KitchenTicketData` | phiếu Bếp/Bar |
| `cancel_ticket` | `data: CancelTicketData` | phiếu hủy món, tới đúng khu của món |
| `bill` | `data: BillData` (`preBill: true` = tạm tính) | bill gộp bàn |
| `test` | `data?: TestPageData` | phiếu in thử có tiếng Việt |
| `drawer` | không | chỉ mở két |
| `document` | `document: { "v":1, "blocks":[...] }` | khối `text/kv/item/sep/qr/feed/cut/drawer` (đặc tả A5.3) |
| `raw` | `base64` | byte ESC/POS server dựng sẵn, gửi nguyên (tối đa 4 MB); `copies` lặp lại toàn bộ |

Ví dụ phiếu bếp (server chỉ cần gửi JSON thuần, có dấu đầy đủ, không cắt dòng):
```json
{ "kind": "kitchen_ticket", "data": {
  "stationLabel": "Bếp", "tableCode": "B05", "areaName": "Trong nhà", "orderNumber": 1042, "round": 2,
  "createdAt": "2026-11-12T12:42:00.000Z", "source": "QR",
  "items": [ { "name": "Lẩu Thái hải sản", "quantity": 2, "options": [ { "group": "Cay", "value": "Vừa" } ], "note": "ít hành" } ],
  "orderNote": "Khách dị ứng đậu phộng" } }
```
Định nghĩa đầy đủ (trường bắt buộc/tuỳ chọn): `src/document/types.ts`. Tiền VND là số nguyên; agent chỉ định dạng, không tính lại. Múi giờ hiển thị mặc định `Asia/Ho_Chi_Minh` (`data.timeZone` để đổi). Hậu quả với backend: nên gửi `payload` dạng cấu trúc (như trên) thay vì chuỗi `content`, để agent chọn raster/CP1258/ASCII theo từng máy in.

`copies` (1-5) và `openDrawer` nằm ở cấp job. `openDrawer` chỉ có hiệu lực nếu máy in khai báo `drawer: true` trong cấu hình agent; job `DRAWER` luôn mở két.

## 6. Cấu hình máy in (phía agent, bản v0.1)

`printers[]`: `id` (= `printerId` của server), `name`, `host`, `port` (9100), `width` (58|80), `encoding` (`raster` mặc định | `cp1258` | `ascii`), `codePage` (số cho `ESC t`, cp1258), `cutMode` (`partial|full|partial_feed|full_feed|none`), `drawer`, `drawerPin` (0|1), tuỳ chọn `cols`, `dots`, `connection` (`lan`). Backend có thể lưu các trường này trong `Printer` (spec A4: `encoding`, `codePage`, `openDrawer`) và đợt sau trả về trong heartbeat để khỏi sửa tệp cục bộ.

## 7. Phía server đã hiện thực (apps/api, đợt 2 backend) - các điểm đã chốt

- **Dạng response poll**: `{ "jobs": [...], "serverTime": "ISO" }` (đã chốt, khớp mock và agent). `POST /agent/jobs/:id/result` và `POST /agent/heartbeat` trả HTTP `201` (mặc định Nest) với body như mục 2; agent chấp nhận mọi 2xx.
- **Tránh chép tay `printerId`**: Admin tạo agent bằng `POST /stores/:storeId/print-agents {name}`; response gồm `token` (hiện MỘT lần, server chỉ lưu SHA-256) và `config` là nội dung `agent.config.json` đã điền `serverUrl`, `agentToken`, và `printers[]` (id, name, host, port, width, encoding, codePage, cutMode, drawer) của các máy in gán cho agent. Lưu `config` thành `agent.config.json` là chạy được (với máy chủ LAN/loopback thì thêm `security.allowLoopback`/`allowInsecureHttp` khi thử). Đổi máy in/cấu hình sau đó: `GET .../print-agents/:id/config` (token là chỗ giữ chỗ vì không còn bản rõ) hoặc `POST .../print-agents/:id/rotate-token` để nhận token mới kèm cấu hình mới. Máy in tạo khi quán chỉ có một agent tự gán vào agent đó.
- **Trạng thái máy in** từ heartbeat: `reachable=false` -> `OFFLINE`; `PAPER_OUT/COVER_OPEN/ERROR` -> `ERROR` (kèm `statusDetail`); còn lại -> `ONLINE`. Agent im > 45 giây: máy in của agent thành `OFFLINE` và server phát `print.agent_offline` một lần; có heartbeat lại phát `print.recovered`.
- **Hạn thuê/lượt thử**: thuê 60s; quá hạn server trả `PENDING` (hết `maxAttempts` thì `FAILED`, `errorCode=LEASE_EXPIRED`). Lỗi `retryable` lùi 5s/15s/45s. Job `PENDING` quá 15 phút từ lúc tạo: server chuyển `FAILED` (`JOB_EXPIRED`) và cảnh báo (không in phiếu cũ hàng loạt).
- **Chế độ in**: `Store.settings.printing.mode` = `AGENT | KDS_ONLY`; không đặt thì có agent hoạt động là `AGENT`, chưa có là `KDS_ONLY` (không tạo job, không báo lỗi giả).
- **Khu in**: `MenuCategory.station` và `MenuItem.printStation` (`KITCHEN|BAR|NONE`), mỗi khu một job tới máy in cùng khu (ưu tiên máy bật, có agent, ONLINE, `priority` nhỏ).
- **Tham chiếu trong payload**: phiếu bếp/bar có `round` (đợt gọi), `orderNumber`, `tableCode`, `areaName`; bill có `billNo`, `mergedTables`, `orders[].round`; phiếu hủy/đổi bàn có `orderNumber`/`tableCode`. `TABLE_MOVE` gửi dạng `kind: "document"`.
- **Sự kiện realtime (SSE `realtime/events`)**: `print.failed`, `print.recovered`, `print.agent_offline`, `print.printer_error`, `table.moved`; dữ liệu riêng nằm trong `data`.
