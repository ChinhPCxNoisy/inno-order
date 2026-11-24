# InnoOrder Print Agent

Chương trình nhỏ chạy trên máy tính quầy của quán: hỏi server (poll dài) xem có phiếu cần in không, dựng lệnh ESC/POS và gửi tới máy in nhiệt LAN (TCP cổng 9100), rồi báo kết quả. Quán không phải mở cổng ra internet. Giao thức: xem `PROTOCOL.md`.

## Yêu cầu
- Windows 10/11 (hoặc hệ khác có Node), Node.js >= 22.
- Máy in nhiệt ESC/POS có cổng mạng (LAN), khổ 58 hoặc 80 mm, đặt IP tĩnh (hoặc giữ chỗ trong router).
- Máy quầy luôn bật, cùng mạng với máy in, ra được internet (HTTPS).

## Cài đặt
```
cd apps\print-agent
npm install            (chạy ở thư mục gốc repo nếu dùng workspace)
copy agent.config.example.json agent.config.json
notepad agent.config.json
```
Sửa `serverUrl`, `agentToken` (tạo ở Admin > Máy in > Print Agent, chỉ hiện một lần), và `printers[]`: `id` là id máy in trong Admin, `host` là IP máy in, `width` 58 hoặc 80. Không có phụ thuộc chạy (runtime) nào ngoài Node; chữ tiếng Việt dạng ảnh dùng phông đóng gói sẵn trong `fonts/`. Cách nhanh nhất: Admin tạo Print Agent thì server trả sẵn nội dung `agent.config.json` (đã điền `serverUrl`, token và danh sách máy in), chỉ cần lưu lại và sửa `host` của từng máy in (xem PROTOCOL.md mục 7).

Tìm IP máy in: in "self-test" của máy (giữ nút Feed khi bật nguồn) hoặc quét mạng: `npm run discover` (liệt kê máy mở cổng 9100 trong dải /24 của máy quầy).

## Kiểm tra máy in LAN (trước khi chạy dịch vụ)
1. `npm run test-print -- <id máy in> -c agent.config.json` : in trang thử (thước cột, đủ chữ có dấu, chữ to, mã QR không có, cắt giấy). Chữ có dấu phải đúng 100%.
2. Không in được? Từ PowerShell: `Test-NetConnection 192.168.1.50 -Port 9100` phải `TcpTestSucceeded : True`.
3. Xem trước không cần máy in: `npm run sample -- --kind bill --width 80 --encoding raster` (ghi `sample-out/*.txt|png`).

## Chạy
- Thử bằng tay: `npm start` (hoặc `npm run build` rồi `npm run start:prod`). Có `--once` (lấy một lượt rồi thoát), `--dry-run` (không in, không báo kết quả, ghi xem trước vào `./dry-run`; job vẫn bị thuê và sẽ quay lại hàng đợi sau khi hết hạn thuê).
- Nhật ký: console và `logs/agent.log` (xoay vòng 512 KB x 3 tệp). Trạng thái cục bộ: `data/state.json`.

### Chạy như dịch vụ Windows
Cách 1 - Task Scheduler (không cần cài thêm): mở PowerShell bằng quyền Administrator:
```
npm run build
powershell -ExecutionPolicy Bypass -File scripts\install-task-windows.ps1
```
Tạo tác vụ "InnoOrder Print Agent" chạy lúc khởi động máy, tự chạy lại khi lỗi. Gỡ: thêm `-Uninstall`. (Script chưa được chạy thử trên máy quán thật; kiểm tra bằng `Get-ScheduledTask`.)
Cách 2 - NSSM (https://nssm.cc, cài tay): `nssm install InnoOrderPrintAgent "C:\Program Files\nodejs\node.exe" "D:\print-agent\dist\cli\agent.js" --config D:\print-agent\agent.config.json`, đặt Startup directory là thư mục agent, rồi `nssm start InnoOrderPrintAgent`.

## Cấu hình tiếng Việt cho từng máy in
| `encoding` | Cách hoạt động | Khi nào dùng |
|---|---|---|
| `raster` (mặc định) | Vẽ chữ thành ảnh rồi in bằng `GS v 0`. Đúng dấu trên mọi máy hỗ trợ in ảnh, không phụ thuộc bảng mã. Chậm và nặng hơn (phiếu bếp ~50 KB) | Mặc định, nên dùng |
| `cp1258` | Gửi `ESC t <codePage>` rồi mã Windows-1258; dấu thanh là ký tự rời | Máy có bảng mã tiếng Việt, cần in nhanh |
| `ascii` | Bỏ dấu ("Lau Thai hai san") | Dự phòng cuối cùng |

## Xử lý sự cố
- **Không in được tiếng Việt / chữ lạ**: đặt `"encoding": "raster"`. Nếu vẫn dùng `cp1258`: số bảng mã `codePage` khác nhau theo model (mặc định 52, chưa kiểm trên máy thật); tra tài liệu máy, thử số khác. Máy không có bảng mã Việt thì ra ký tự lạ hoặc dấu lệch: chuyển `raster`.
- **Ra chữ rác kiểu `GS v 0`/ký tự lạ ở đầu phiếu**: máy không hỗ trợ in ảnh raster hoặc là máy nhãn, hoặc đang ở chế độ khác (ESC/POS emulation); kiểm tra chế độ máy, thử `ascii`.
- **Không cắt giấy**: thử `cutMode` `full`, `partial_feed` hoặc `full_feed` (máy khác nhau hiểu khác); máy khổ nhỏ không có dao cắt thì đặt `none`.
- **Giấy ra ít, phiếu bị cắt sát chữ cuối**: tăng khoảng đẩy giấy (hiện 4 dòng, trong code `feedBeforeCut`).
- **Chữ bị cắt/lệch lề phải**: máy có số điểm khác 384/576: đặt `dots` (ví dụ 512) và/hoặc `cols` cho máy đó.
- **Két tiền không mở**: đặt `"drawer": true` cho máy in nối két; thử `"drawerPin": 1`; két phải cắm vào cổng RJ11 (DK) của máy in.
- **Job báo `PRINTER_REFUSED` / `PRINTER_TIMEOUT`**: máy tắt, sai IP/cổng, máy đang bận kết nối khác (nhiều máy in chỉ nhận một kết nối). Server tự thử lại 3 lần (5s, 15s, 45s) rồi báo lỗi trên POS.
- **`PRINTER_HOST_REJECTED`**: agent chỉ gửi tới IP mạng nội bộ (10.x, 172.16-31.x, 192.168.x).
- **Server từ chối token**: kiểm tra `agentToken`; token bị thu hồi thì tạo lại ở Admin.
- **Phiếu in đôi**: có thể xảy ra hiếm khi mất mạng đúng lúc báo kết quả (ưu tiên không mất phiếu); agent đã chặn in lại job đã in (danh sách cục bộ).

## Phát triển và kiểm thử
```
npm run typecheck
npm test                      # node --test, không cần framework ngoài
npm run mock-server -- --seed # server giả lập (cổng 4010, token mock-agent-token) + 3 job mẫu
npm run fake-printer          # máy in giả lập cổng 19100, giải mã phiếu ra văn bản/PNG
npm run decode -- tep.bin --out ./preview
```
Chạy thử đầu cuối: bật `mock-server --seed` và `fake-printer`, cấu hình agent với `serverUrl` `http://127.0.0.1:4010`, `agentToken` `mock-agent-token`, `security.allowLoopback: true`, máy in `kitchen` ở `127.0.0.1:19100`, rồi `npm run once`. Nhớ tắt các tiến trình giả lập sau khi dùng.

## Chưa có (xem báo cáo)
In USB/Windows spooler (interface `PrinterTransport` đã chừa chỗ), tự cập nhật, mã QR dạng ảnh cho máy không hỗ trợ QR native, kiểm thử trên máy in thật.
