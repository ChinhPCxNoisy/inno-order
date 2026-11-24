# Đặc tả 01 - Thanh toán VietQR động, tự đối soát và tự xác nhận

Phiên bản: 1.0 (2026-11-12). Người viết: PM/PO. Đối tượng đọc: Developer (dev-inno), Tester.
Quy ước ước lượng: S = tối đa 1 ngày công, M = 2-4 ngày, L = 5-10 ngày (một developer).
Quy ước nhãn: "Giả định cần xác minh" (GĐ-xx) = điều phụ thuộc đối tác bên ngoài hoặc chuẩn kỹ thuật mà PO không thể xác minh khi viết; developer phải xác minh với tài liệu chính thức của đối tác trước khi code phần đó, không được coi là sự thật.

---

## 0. Hiện trạng code (bằng chứng)

| Hạng mục | Hiện trạng | Bằng chứng |
|---|---|---|
| Phương thức thanh toán | Enum đã có `CASH, TRANSFER, QR_BANK, CARD, WALLET`; `PaymentStatus` có `PENDING, COMPLETED, REFUNDED, FAILED` | `apps/api/prisma/schema.prisma:55-68` |
| Mô hình Payment | Chỉ có `orderId` (bắt buộc), `amount`, `method`, `status`, `cashierId`, `receiptNo`. Không có tham chiếu giao dịch ngân hàng, không có mã đối soát | `schema.prisma:345-362` |
| Thanh toán | `payOrder` do thu ngân bấm: khóa dòng bàn, `updateMany` có điều kiện `status in PAYABLE` rồi mới tạo Payment (chống thanh toán đồng thời, 3 request song song cho 201/409/409). Giảm giá không vượt tạm tính; VAT tính sau giảm giá bằng `calcTotals` | `apps/api/src/orders/orders.service.ts:84-91, 989-1145` |
| QR_BANK/TRANSFER | Chỉ là nhãn: thu ngân chọn "Chuyển khoản"/"Quét mã QR" rồi bấm "Xác nhận đã nhận" thủ công. Không sinh mã QR, không kiểm tra tiền về | `apps/admin/src/pages/Pos.tsx:37, 107-115` |
| Hoàn tiền | `refundOrder` ghi Payment hoàn với `method: 'CASH'` cố định bất kể khách trả bằng gì | `orders.service.ts:1175-1186` |
| Quán có tài khoản ngân hàng? | Không có. Chỉ có `Store.settings` (JSON tự do, ai sửa được quán đều sửa được) | `schema.prisma:141`, `apps/api/src/stores/stores.service.ts:180-182` |
| Realtime | SSE chỉ cho nhân viên (token JWT qua query), pub/sub trong tiến trình (1 instance). Khách theo dõi đơn bằng poll 3 giây | `apps/api/src/realtime/realtime.controller.ts:23-40`, `events.service.ts:28-39`, `apps/miniapp/src/useOrder.ts:20-47` |
| Mini app | Không có màn thanh toán. Màn hoàn tất chỉ hiện "Thanh toán đã được quán xác nhận" sau khi nhân viên bấm | `apps/miniapp/src/pages/Tracking.tsx:113-153` |
| Raw body | `NestFactory.create` chưa bật `rawBody`, cần cho kiểm tra chữ ký webhook | `apps/api/src/main.ts:26` |
| Thư viện | Không có `@nestjs/schedule`, không có client Redis, không có hàng đợi; chỉ có `sharp`, `bcryptjs`, `@nestjs/jwt` | `apps/api/package.json` |
| QR | Admin có bộ mã hóa QR tự viết (byte mode, ECC M, version 1-10, tối đa 213 byte) đủ cho payload VietQR; mini app chưa có | `apps/admin/src/qr.ts:1-20` |
| Module trả phí | Cơ chế `Store.enabledModules` do Super Admin bật/tắt theo quán | `apps/api/src/common/modules.ts:5-23` |
| BRD | FR-POS-04 thanh toán chuyển khoản P0; FR-CUST-13 thanh toán online P2; dòng 2406 "Không làm thanh toán online phức tạp ở MVP" | `202609162104.md:830, 746, 2406` |

Kết luận: tính năng này là mở rộng sau MVP (BRD xếp P2) nhưng là lợi thế cạnh tranh trực tiếp với đối thủ có VietQR động. Phần "tự xác nhận" phụ thuộc đối tác nhận biến động số dư, vì vậy thiết kế tách làm hai tầng: (1) sinh QR động + thu ngân xác nhận (không phụ thuộc đối tác, làm được ngay), (2) tự đối soát qua adaptor (cắm đối tác khi có).

---

## 1. Mục tiêu và giá trị

Cho quán: bỏ thao tác "đếm tiền, nhìn app ngân hàng, bấm xác nhận"; giảm sai sót xác nhận nhầm (bấm "đã nhận" khi tiền chưa về); đối soát cuối ngày nhanh; không để khách "quét rồi đi" mà tiền chưa vào.
Cho khách: quét hoặc chuyển khoản một lần, màn hình báo "Đã thanh toán" ngay, không phải chờ gọi nhân viên.

Số đo thành công (đề xuất, PO chốt):
- Tỷ lệ thanh toán QR tự xác nhận không cần thu ngân thao tác >= 95% số giao dịch QR.
- Thời gian từ lúc ngân hàng ghi có đến lúc mini app hiện "Đã thanh toán" (p95) <= 10 giây (GĐ-01: phụ thuộc độ trễ của nhà cung cấp, đo thực tế khi pilot).
- 0 trường hợp một đơn bị ghi nhận thanh toán hai lần (kiểm bằng truy vấn đối soát hằng đêm).
- 0 giao dịch ngân hàng "mồ côi" tồn quá 24 giờ chưa được xử lý (mỗi giao dịch có người chịu trách nhiệm).
- Chênh lệch đối soát cuối ngày (tiền về tài khoản so với tổng Payment QR) = 0 đồng sau khi xử lý các giao dịch ngoại lệ.
- Thu ngân giảm >= 50% thời gian thao tác cho mỗi lần thanh toán QR so với quy trình thủ công (đo bằng quan sát 20 lượt tại quán pilot).

---

## 2. Phạm vi

Gồm:
1. Cấu hình tài khoản nhận tiền theo từng quán (đa quán, tiền về tài khoản của quán, không qua InnoCom).
2. Sinh mã VietQR động (số tiền + nội dung chứa mã đối soát duy nhất) cho hóa đơn, hiển thị trên POS và trên mini app.
3. Giao diện nhà cung cấp biến động số dư (adaptor) + một adaptor `MANUAL` (không tự động) + một adaptor `MOCK` (kiểm thử) + khung viết adaptor thật đầu tiên (nhà cung cấp do PO chọn, xem câu hỏi Q1).
4. Webhook nhận giao dịch: xác thực, idempotent, chống replay, ghi sổ giao dịch ngân hàng (`BankTransaction`).
5. Khớp giao dịch với hóa đơn, tự ghi nhận Payment và hoàn tất hóa đơn; xử lý trùng, thiếu, thừa, quá hạn, chuyển nhầm.
6. Realtime: POS/admin nhận sự kiện; mini app thấy ngay (poll nhanh trên màn QR).
7. Hàng đợi ngoại lệ cho thu ngân/quản lý, đối soát cuối ngày, hoàn tiền giao dịch QR (ghi nhận + nhắc chuyển trả thủ công).
8. Phân quyền, nhật ký kiểm toán, bật/tắt theo module.

Không gồm (phase sau hoặc không làm):
- Tự động chuyển khoản hoàn tiền qua API ngân hàng (hầu hết nhà cung cấp biến động số dư chỉ cho đọc; GĐ-02). Hoàn tiền QR v1 = ghi nhận trên hệ thống + thu ngân chuyển trả bằng app ngân hàng, hệ thống nhắc và đối chiếu.
- Ví điện tử (MoMo, ZaloPay...), thẻ, cổng thanh toán thẻ.
- Thu hộ qua tài khoản trung gian của InnoCom (kéo theo nghĩa vụ pháp lý về trung gian thanh toán, ngoài phạm vi).
- Hóa đơn điện tử (HĐĐT) / kết nối cơ quan thuế.
- Mini app tự thanh toán và đóng bàn khi bàn chưa gọi đồ xong (xem Mục 7).

Điều kiện tiên quyết: khái niệm Hóa đơn bàn (Bill) và dịch vụ `settle` ở Đặc tả 02 phần (b). Nếu Đặc tả 02 chậm, có phương án tạm (Mục 9, bước 1-bis) chỉ áp dụng cho một đơn.

---

## 3. Luồng người dùng

### 3.1 Cấu hình (Chủ quán)
1. Vào Admin > "Thanh toán & đối soát" > "Tài khoản nhận tiền" > Thêm tài khoản: chọn ngân hàng (danh sách BIN), số tài khoản, tên chủ tài khoản (viết hoa không dấu, đúng như ngân hàng), chọn nhà cung cấp biến động số dư (`MANUAL`, hoặc nhà cung cấp đã được InnoOrder tích hợp), nhập khóa API do nhà cung cấp cấp (nếu có).
2. Hệ thống hiển thị URL webhook riêng của tài khoản (chứa token ngẫu nhiên) và chuỗi bí mật hiển thị một lần; chủ quán dán vào cổng của nhà cung cấp.
3. Bấm "Kiểm tra": hệ thống chờ giao dịch thử (chuyển 2.000 đồng tới chính tài khoản, hoặc nút "Giả lập" khi nhà cung cấp là `MOCK`). Khi nhận được và chữ ký hợp lệ, tài khoản chuyển "Đã xác minh" (`verifiedAt`), chỉ khi đó mới được dùng cho QR tự xác nhận. Tài khoản chưa xác minh vẫn tạo được QR nhưng chế độ chỉ "thu ngân xác nhận".
4. Đổi/xóa tài khoản: bắt buộc nhập lại mật khẩu, ghi audit, gửi thông báo cho mọi Owner/Manager của quán (chống đổi tài khoản nhận tiền để chiếm đoạt).

### 3.2 Thu ngân thanh toán bằng QR (luồng chính tại quầy)
1. Mở bàn trên POS, bấm "Thanh toán bàn" (Đặc tả 02), chọn phương thức "QR ngân hàng".
2. Hệ thống tạo `PaymentIntent` (số tiền còn phải thu của hóa đơn, mã đối soát duy nhất, hạn 15 phút - cấu hình) và hiển thị QR + số tiền + trạng thái "Đang chờ thanh toán".
3. Khách quét bằng app ngân hàng (số tiền và nội dung đã điền sẵn) và chuyển.
4. Nhà cung cấp gọi webhook; hệ thống khớp, ghi Payment, đóng hóa đơn, in bill, bàn sang "Cần dọn". POS tự đổi trạng thái sang "Đã thanh toán", phát âm báo nhẹ; thu ngân không cần bấm.
5. Nếu quá 15 phút: QR hết hạn, thu ngân bấm "Tạo lại mã". Giao dịch về muộn vẫn được xử lý (Mục 7).
6. Nếu nhà cung cấp là `MANUAL` hoặc lỗi webhook: thu ngân thấy nút "Tôi đã thấy tiền về, xác nhận" (ghi `confirmedBy = CASHIER`, nhắc đối chiếu sao kê, vào báo cáo đối soát là "xác nhận tay").

### 3.3 Khách tự thanh toán trong mini app (khách ngồi bàn, cấu hình quán cho phép)
1. Khách mở theo dõi đơn hoặc "Hóa đơn của bàn" và bấm "Thanh toán bằng QR" (chỉ hiện khi quán bật `customerCanPayQr` và bàn có hóa đơn mở).
2. Mini app gọi API tạo intent theo token phiên bàn; hiển thị QR, số tiền, nội dung, nút "Sao chép số tài khoản", "Sao chép nội dung", "Lưu ảnh QR" (khách đang cầm đúng điện thoại này nên không quét được chính màn hình; phải lưu ảnh rồi quét từ thư viện ảnh của app ngân hàng, hoặc chuyển khoản tay). GĐ-03: chưa xác minh hỗ trợ mở thẳng app ngân hàng từ Zalo mini app bằng liên kết sâu và API lưu ảnh vào thư viện của `zmp-sdk`; developer kiểm tra tài liệu zmp-sdk.
3. Khách chuyển xong và quay lại Zalo: mini app đã poll mỗi 2 giây (và tải lại ngay khi tab hiện lại, hook sẵn ở `useOrder.ts:49-55`), thấy "Đã thanh toán" kèm số tiền và giờ.
4. Quán thấy thông báo trên POS/KDS: "Bàn B05 đã thanh toán bằng QR".

### 3.4 Quản lý xử lý ngoại lệ
1. Màn "Giao dịch ngân hàng": danh sách giao dịch về tài khoản của quán với trạng thái khớp. Giao dịch cần xử lý hiện huy hiệu đỏ ở menu và toast realtime.
2. Mỗi giao dịch ngoại lệ có thao tác: "Gán vào hóa đơn" (khi nội dung sai/chuyển nhầm nhưng nhận ra), "Đánh dấu cần hoàn tiền", "Đã hoàn tiền (ghi chú số tham chiếu)", "Bỏ qua (không phải của quán/không liên quan)" kèm lý do bắt buộc.
3. Cuối ngày: màn "Đối soát" so sánh tổng tiền về tài khoản với tổng Payment QR; tồn đọng phải xử lý hết mới "Chốt ngày" (Owner/Manager).

### 3.5 Hoàn tiền giao dịch QR (Quản lý)
1. Vào hóa đơn đã thanh toán > "Hoàn tiền" (chỉ Manager/Owner), nhập lý do. Hệ thống ghi Payment hoàn đúng phương thức gốc (`QR_BANK`), tạo "Việc cần làm: chuyển trả cho khách" (số tiền, tài khoản người gửi nếu nhà cung cấp trả về ở dạng che).
2. Quản lý chuyển khoản trả bằng app ngân hàng, nhập số tham chiếu và bấm "Đã chuyển trả". Nếu nhà cung cấp báo cả giao dịch ra (OUT) thì hệ thống tự gợi ý khớp (GĐ-04).

---

## 4. Thay đổi mô hình dữ liệu (Prisma đề xuất)

Nguyên tắc migration: chỉ thêm bảng/cột mới, cột mới nullable hoặc có default; không đổi/xóa cột hiện có; viết tay SQL theo mẫu `20261112150000_order_seq_and_client_request_id` vì `prisma migrate dev` không chạy được trong môi trường không tương tác (xem `docs/review/03-dev-backend-report.md`, mục 1) rồi `prisma migrate deploy`.

```prisma
enum BankTxnDirection { IN OUT }

enum BankTxnStatus {
  RECEIVED          // vừa ghi sổ, chưa xử lý (trạng thái thoáng qua)
  MATCHED           // đã khớp và ghi nhận Payment đủ số tiền
  PARTIAL           // khớp hóa đơn nhưng thiếu tiền; đã ghi nhận phần chuyển (xem 7.2)
  OVERPAID          // khớp, ghi nhận đủ phần cần thu, còn dư (excessAmount > 0)
  UNMATCHED         // không tìm thấy mã đối soát
  DUPLICATE_PAYMENT // hóa đơn đã được thanh toán bằng cách khác (tiền mặt/QR khác)
  LATE_CLOSED       // về muộn, hóa đơn đã đóng/hủy/hoàn
  NEEDS_REVIEW      // khớp mơ hồ hoặc chữ ký/tài khoản bất thường
  REFUND_PENDING    // đã quyết định hoàn, chưa chuyển trả
  REFUNDED          // đã chuyển trả
  IGNORED           // bỏ qua có lý do
}

model PaymentAccount {
  id               String   @id @default(uuid(7)) @db.Uuid
  storeId          String   @db.Uuid
  label            String
  bankBin          String   @db.VarChar(6)
  bankName         String
  accountNumber    String
  accountName      String
  provider         String   @default("MANUAL")  // khóa adaptor: MANUAL | MOCK | ...
  providerConfigEnc String? // JSON mã hóa AES-256-GCM (khóa API của đối tác)
  webhookToken     String   @unique             // 32 byte ngẫu nhiên base64url, nằm trong URL
  webhookSecretEnc String?                      // bí mật ký/kiểm chữ ký, mã hóa
  isActive         Boolean  @default(true)
  isDefault        Boolean  @default(false)     // đúng 1 mặc định/quán, ràng buộc trong service
  verifiedAt       DateTime?
  lastWebhookAt    DateTime?
  createdByUserId  String?  @db.Uuid
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  store   Store             @relation(fields: [storeId], references: [id], onDelete: Restrict)
  intents PaymentIntent[]
  txns    BankTransaction[]

  @@unique([storeId, bankBin, accountNumber])
  @@index([storeId, isActive])
  @@map("payment_accounts")
}

enum PaymentIntentStatus { PENDING PAID PARTIALLY_PAID EXPIRED CANCELLED SUPERSEDED }

model PaymentIntent {
  id              String   @id @default(uuid(7)) @db.Uuid
  storeId         String   @db.Uuid
  accountId       String   @db.Uuid
  billId          String?  @db.Uuid   // từ Đặc tả 02 (Bill); bước 1-bis dùng orderId
  orderId         String?  @db.Uuid
  code            String   @unique    // mã đối soát, ví dụ IO7K2M9XQ4 (xem 5.1)
  amount          Decimal  @db.Decimal(14, 2) // số tiền yêu cầu, đóng băng lúc tạo
  paidAmount      Decimal  @default(0) @db.Decimal(14, 2)
  status          PaymentIntentStatus @default(PENDING)
  qrPayload       String              // chuỗi EMVCo đầy đủ, để dựng lại ảnh QR
  expiresAt       DateTime
  paidAt          DateTime?
  createdByUserId String?  @db.Uuid   // null nếu do khách tạo
  createdByCustomer Boolean @default(false)
  createdAt       DateTime @default(now())

  store   Store          @relation(fields: [storeId], references: [id], onDelete: Restrict)
  account PaymentAccount @relation(fields: [accountId], references: [id], onDelete: Restrict)

  @@index([storeId, status, expiresAt])
  @@index([billId, status])
  @@map("payment_intents")
}

model BankTransaction {
  id               String   @id @default(uuid(7)) @db.Uuid
  storeId          String   @db.Uuid
  accountId        String   @db.Uuid
  provider         String
  providerTxnId    String               // mã giao dịch phía đối tác (khóa idempotent)
  direction        BankTxnDirection @default(IN)
  amount           Decimal  @db.Decimal(14, 2)
  content          String               // nội dung chuyển khoản gốc
  contentNormalized String              // đã bỏ dấu, viết hoa, chỉ chữ-số
  bankReference    String?
  counterpartyName String?              // tên người chuyển, nếu đối tác cung cấp
  counterpartyAccountMasked String?     // chỉ 4 số cuối, không lưu đầy đủ
  transferredAt    DateTime             // giờ giao dịch theo ngân hàng
  receivedAt       DateTime @default(now())
  rawPayload       Json                 // giữ nguyên để tra soát; xem GĐ về thời hạn lưu (Mục 10)
  status           BankTxnStatus @default(RECEIVED)
  intentId         String?  @db.Uuid
  billId           String?  @db.Uuid
  appliedAmount    Decimal  @default(0) @db.Decimal(14, 2)
  excessAmount     Decimal  @default(0) @db.Decimal(14, 2)
  resolvedByUserId String?  @db.Uuid
  resolvedAt       DateTime?
  resolutionNote   String?

  store   Store          @relation(fields: [storeId], references: [id], onDelete: Restrict)
  account PaymentAccount @relation(fields: [accountId], references: [id], onDelete: Restrict)

  @@unique([accountId, providerTxnId])
  @@index([storeId, status, receivedAt])
  @@index([storeId, transferredAt])
  @@map("bank_transactions")
}

model DailyReconciliation {
  id          String   @id @default(uuid(7)) @db.Uuid
  storeId     String   @db.Uuid
  businessDate String  @db.VarChar(10)   // YYYY-MM-DD theo giờ VN (dùng vn-date.ts)
  bankInTotal Decimal  @db.Decimal(14, 2)
  qrPaymentTotal Decimal @db.Decimal(14, 2)
  manualConfirmTotal Decimal @db.Decimal(14, 2)
  unresolvedCount Int
  difference  Decimal  @db.Decimal(14, 2)
  closedByUserId String @db.Uuid
  closedAt    DateTime @default(now())
  note        String?

  @@unique([storeId, businessDate])
  @@map("daily_reconciliations")
}
```

Bổ sung cho `Payment` (bảng `payments`, `schema.prisma:345`), tất cả nullable/có default:
```prisma
  billId        String?  @db.Uuid          // thêm ở Đặc tả 02
  intentId      String?  @db.Uuid
  bankTransactionId String? @unique @db.Uuid // một giao dịch ngân hàng chỉ tạo tối đa 1 Payment
  confirmedBy   String   @default("CASHIER") // CASHIER | BANK_FEED | SYSTEM
  refundOfPaymentId String? @db.Uuid
  refundStatus  String?   // PENDING_TRANSFER | DONE (chỉ cho Payment hoàn)
  refundNote    String?
```
`Payment.orderId` (hiện bắt buộc) chuyển thành nullable ở Đặc tả 02; Đặc tả này không đụng.

Thêm module trả phí: `qr_auto_confirm` vào `MODULE_DEFS` (`apps/api/src/common/modules.ts:5`). Cấu hình theo quán lưu ở `Store.settings.payment` (JSON, đọc qua hàm có kiểu, không cho client ghi tùy ý):
```json
{ "qrIntentTtlMinutes": 15, "customerCanPayQr": false, "autoAcceptPartial": true, "requirePaymentBeforeKitchen": false }
```
Biến môi trường mới: `APP_ENCRYPTION_KEY` (32 byte base64, mã hóa `providerConfigEnc`/`webhookSecretEnc`), `PAYMENT_WEBHOOK_BASE_URL`. Bắt buộc khi API khởi động nếu có tài khoản `provider != MANUAL`.

Backfill: không cần dữ liệu cũ. Payment cũ giữ `confirmedBy = 'CASHIER'` (default của cột). Không có bước migrate dữ liệu rủi ro.

---

## 5. API

Tiền tố chung `/api/v1`. Lỗi trả `message` tiếng Việt có dấu (mini app hiển thị nguyên văn nếu 4xx có dấu, xem `apps/miniapp/src/api.ts:123-139`).

### 5.1 Quy tắc sinh mã và QR (backend, module `payments/vietqr`)

Mã đối soát `code`:
- Dạng `IO` + 8 ký tự Crockford base32 (không có I, L, O, U), sinh bằng `crypto.randomBytes`, ví dụ `IO7K2M9XQ4`. Dài 10 ký tự, chỉ chữ in hoa và số. Duy nhất toàn nền tảng (ràng buộc `@unique`); retry nếu trùng.
- Không dùng số đơn (đoán được, và trùng giữa các quán).
- Nội dung chuyển khoản gợi ý: chỉ `code` (có thể thêm mã bàn nếu còn chỗ). GĐ-05: giới hạn độ dài nội dung và việc ngân hàng/app thay đổi hoặc cắt nội dung thay đổi theo ngân hàng. Quy tắc khớp vì vậy phải chịu được việc app ngân hàng chèn thêm chữ, đổi chữ thường, bỏ khoảng trắng.

Chuỗi VietQR (EMVCo MPM, `QRIBFTTA` chuyển nhanh tới tài khoản) dựng theo TLV (tag 2 số, độ dài 2 số, giá trị):
- `00` = `01` (phiên bản); `01` = `12` (QR động, có số tiền);
- `38` = Merchant Account Information: `00` = GUID NAPAS `A000000727`; `01` = (`00` = BIN ngân hàng 6 số, `01` = số tài khoản); `02` = `QRIBFTTA`;
- `53` = `704` (VND); `54` = số tiền, số nguyên không dấu thập phân; `58` = `VN`;
- `62` = Additional Data: `08` = nội dung (chính là `code`);
- `63` = CRC16/CCITT-FALSE (đa thức 0x1021, khởi tạo 0xFFFF) tính trên toàn chuỗi tính cả `6304`, viết HOA 4 ký tự hex.
GĐ-06: các tag, độ dài tối đa, và hành vi từng app ngân hàng phải được developer đối chiếu với đặc tả VietQR/NAPAS chính thức và kiểm thử quét bằng ít nhất 3 app ngân hàng thật (kiểm tra số tiền và nội dung điền sẵn và không bị sửa được/được sửa theo từng app) trước khi bật cho quán thật. Có unit test với vector chuẩn (CRC, chuỗi mẫu).
Dựng ảnh QR: phía client từ `qrPayload` (admin dùng lại `apps/admin/src/qr.ts`; mini app đưa bộ mã hóa này vào gói dùng chung hoặc thêm thư viện, xem mục 5 của `00-tong-quan-va-lo-trinh.md`). Không gọi dịch vụ dựng QR bên thứ ba để tránh lộ số tiền, tài khoản, mã đơn.

### 5.2 Adaptor nhà cung cấp biến động số dư

Giao diện TypeScript, đặt tại `apps/api/src/payments/providers/bank-feed-provider.ts`:
```ts
export interface NormalizedBankTxn {
  providerTxnId: string;
  accountNumber: string;      // tài khoản nhận
  amount: number;             // đồng, số nguyên
  direction: 'IN' | 'OUT';
  content: string;
  transferredAt: Date;
  bankReference?: string;
  counterpartyName?: string;
  counterpartyAccountMasked?: string;
  raw: unknown;
}
export interface BankFeedProvider {
  readonly key: string;
  /** Kiểm tra chữ ký/token từ header + rawBody. Ném lỗi nếu sai. */
  verifyWebhook(input: { rawBody: Buffer; headers: Record<string,string>; secret: string; config: unknown }): void;
  /** Chuyển payload của đối tác về dạng chuẩn (có thể trả nhiều giao dịch). */
  parseWebhook(body: unknown): NormalizedBankTxn[];
  /** Nội dung phản hồi HTTP đối tác mong đợi để ngừng gọi lại (khác nhau theo đối tác). */
  ackResponse(): { status: number; body: unknown };
  /** Tùy chọn: kéo giao dịch để vá webhook rơi. */
  pullTransactions?(args: { config: unknown; accountNumber: string; since: Date }): Promise<NormalizedBankTxn[]>;
  /** Tùy chọn: xác nhận lại 1 giao dịch với đối tác trước khi ghi nhận khoản lớn. */
  confirmTransaction?(args: { config: unknown; providerTxnId: string }): Promise<boolean>;
}
```
Đăng ký bằng `ProviderRegistry` (map `key` -> instance) ở `payments.module.ts`. Có sẵn: `MANUAL` (không webhook; chỉ để tạo QR và xác nhận tay), `MOCK` (cho test/pilot nội bộ: `POST /api/v1/payments/mock/simulate` chỉ bật khi `NODE_ENV != production`, bị từ chối ở production). Nhà cung cấp thật (SePay, Casso, payOrder hoặc API ngân hàng trực tiếp) chọn theo Q1 và viết thành 1 file adaptor riêng. GĐ-07: định dạng payload, cách ký, mã giao dịch, độ trễ, có cho kéo lại lịch sử không, phí và thời gian onboarding đều phải lấy từ tài liệu và hợp đồng của chính đối tác; không có số liệu nào trong tài liệu này.

### 5.3 Webhook (public, không JWT)

`POST /api/v1/webhooks/bank/:provider/:accountToken`
- `@Public()`; rate limit theo IP+token (dùng `common/utils/rate-limiter.ts`, ngưỡng hợp lý cho lưu lượng đối tác); giới hạn kích thước body (ví dụ 64 KB); bật `rawBody: true` ở `main.ts`.
- Quy trình, theo đúng thứ tự:
  1. Tra `PaymentAccount` theo `accountToken` (không thấy: trả 404, không tiết lộ lý do chi tiết, ghi log cảnh báo kèm IP).
  2. `verifyWebhook` bằng bí mật của tài khoản. Sai: 401, ghi `AuditLog action='webhook_rejected'`, đếm; vượt ngưỡng thì cảnh báo cho Owner.
  3. Chống replay: nếu đối tác có timestamp trong chữ ký thì từ chối lệch quá 5 phút (GĐ-08: tùy đối tác); luôn dựa vào idempotency ở bước 5 làm chốt cuối.
  4. `parseWebhook`. Chỉ xử lý `direction = IN`. Kiểm tra `accountNumber` của giao dịch bằng `PaymentAccount.accountNumber` (chống payload của tài khoản khác chui vào token này); sai: lưu `NEEDS_REVIEW`.
  5. Ghi `BankTransaction` với ràng buộc `@@unique([accountId, providerTxnId])`. Trùng (P2002): coi là gửi lại, trả `ackResponse()` mà KHÔNG xử lý lại. Đây là chốt idempotent.
  6. Gọi `PaymentMatchingService.match(txnId)` (xem 5.4). Lỗi trong khớp không được làm webhook trả 5xx sau khi đã ghi sổ (giao dịch đã an toàn trong sổ; có job quét lại `RECEIVED` mỗi phút). Chỉ trả 5xx khi chưa ghi được sổ, để đối tác gọi lại.
  7. Trả `ackResponse()` (HTTP 200 nhanh, mục tiêu < 1 giây; việc nặng như in bill làm sau commit).
- Với khoản >= ngưỡng cấu hình (ví dụ 5.000.000 đồng, PO chốt) và adaptor có `confirmTransaction`: gọi xác nhận ngược với đối tác trước khi ghi nhận (chống webhook giả khi lộ bí mật). Chưa xác nhận được: `NEEDS_REVIEW`.

### 5.4 Thuật toán khớp (`PaymentMatchingService.match`)

Chạy trong transaction, khóa theo hóa đơn (dùng `lockTable` tương tự `orders.service.ts:159-161`, hoặc `SELECT ... FOR UPDATE` trên dòng bill):
1. Chuẩn hóa `contentNormalized` = bỏ dấu tiếng Việt, in hoa, bỏ ký tự không phải chữ-số.
2. Tìm mã `IO[0-9A-Z]{8}` trong chuỗi chuẩn hóa (chấp nhận mã nằm giữa các chữ khác). Nhiều mã khác nhau trong cùng nội dung: `NEEDS_REVIEW`. Không có mã: `UNMATCHED`.
3. Tra `PaymentIntent` theo `code`. Không có: `UNMATCHED`.
4. Chốt chặn đa quán: `intent.storeId == txn.storeId` và `intent.accountId == txn.accountId`. Sai: `NEEDS_REVIEW` và cảnh báo (nghi lẫn token hoặc giả mạo). Không bao giờ ghi nhận chéo quán.
5. Lấy hóa đơn của intent (khóa), tính `remaining = bill.total - tổng Payment COMPLETED của bill`.
6. Quyết định:

| Tình huống | Xử lý |
|---|---|
| Hóa đơn `PAID`, hoặc hóa đơn khác đã trả đủ bằng tiền mặt/QR khác | `DUPLICATE_PAYMENT`; không ghi Payment; vào hàng đợi hoàn tiền; thông báo thu ngân |
| Hóa đơn đã `VOID/REFUNDED` hoặc đơn bị hủy | `LATE_CLOSED`; hàng đợi hoàn tiền |
| `amount == remaining` | Ghi Payment `QR_BANK` đúng `amount`, `confirmedBy = BANK_FEED`, `status = MATCHED`, intent `PAID`, đóng hóa đơn (gọi `BillService.applyPayment`, xem Đặc tả 02) |
| `amount < remaining` | Nếu `autoAcceptPartial` (mặc định bật): ghi Payment bằng `amount`, hóa đơn `PARTIALLY_PAID`, intent `PARTIALLY_PAID`, giao dịch `PARTIAL`, báo POS "Còn thiếu X đồng". Nếu tắt: không ghi, `NEEDS_REVIEW` |
| `amount > remaining` | Ghi Payment bằng `remaining`, hóa đơn `PAID`, giao dịch `OVERPAID` với `excessAmount = amount - remaining`, vào hàng đợi hoàn phần dư (hoặc quản lý ghi nhận "tip" có lý do) |
| Intent `EXPIRED` nhưng hóa đơn còn mở và `amount <= remaining` | Vẫn ghi nhận (tiền đã vào), vì tiền thật đã về; trạng thái như các dòng trên |
| Intent `SUPERSEDED` (hóa đơn đổi tổng sau khi tạo QR) | Áp dụng như dòng `amount` so với `remaining` mới (không quan tâm số cũ) |
| Giao dịch OUT | Không khớp thanh toán; nếu khớp việc hoàn tiền đang chờ thì gợi ý đóng (GĐ-04) |

7. Sau commit: phát sự kiện realtime, tạo print job bill (tiền mặt mở két không áp dụng), ghi audit (xem Mục 7.8).

Tạo Payment qua hàm dùng chung `BillService.applyPayment(tx, {billId, amount, method:'QR_BANK', actor:{type:'SYSTEM'|'USER'}, bankTransactionId, intentId})` (Đặc tả 02). Hàm này phải tái sử dụng chốt chặn của `payOrder`: khóa bàn, `updateMany` có điều kiện, 409 khi thua cuộc đua. Khi nhánh tự động thua cuộc đua với thu ngân (cùng lúc bấm tiền mặt), kết quả là `DUPLICATE_PAYMENT` chứ không phải lỗi.

### 5.5 Endpoint cho nhân viên (JWT + `assertStoreAccess`)

| Method + đường dẫn | Vai trò | Mô tả |
|---|---|---|
| `GET /stores/:storeId/payment-accounts` | OWNER, MANAGER, CASHIER (che số tài khoản, chỉ 4 số cuối cho CASHIER) | Danh sách tài khoản |
| `POST /stores/:storeId/payment-accounts` | OWNER, SUPER_ADMIN | Thêm. Body `{label, bankBin, bankName, accountNumber, accountName, provider, providerConfig?}`. Trả `{id, webhookUrl, webhookSecret (chỉ lần này)}`. Yêu cầu nhập lại mật khẩu: header `X-Reauth-Password` hoặc trường `password` |
| `PATCH /stores/:storeId/payment-accounts/:id` | OWNER | Đổi tên, bật/tắt, đặt mặc định; đổi số tài khoản/ngân hàng cần nhập lại mật khẩu và đặt lại `verifiedAt = null` |
| `POST /stores/:storeId/payment-accounts/:id/rotate-secret` | OWNER | Quay bí mật webhook |
| `POST /stores/:storeId/pos/bills/:billId/qr` | CASHIER+, WAITER không | Tạo intent. Body `{amount?: number}` (mặc định = còn phải thu; không được lớn hơn). Trả `{intentId, code, amount, expiresAt, qrPayload, bank:{bankName, accountNumber, accountName}, autoConfirm: boolean}` |
| `GET /stores/:storeId/pos/qr-intents/:id` | CASHIER+ | Trạng thái (POS cũng nhận SSE) |
| `POST /stores/:storeId/pos/qr-intents/:id/cancel` | CASHIER+ | Hủy mã |
| `POST /stores/:storeId/pos/qr-intents/:id/manual-confirm` | CASHIER+ | Xác nhận tay khi `autoConfirm=false` hoặc nhà cung cấp lỗi; body `{reason?}`; ghi `confirmedBy=CASHIER`, `AuditLog action='qr_manual_confirm'`; vẫn đi qua `BillService.applyPayment` |
| `GET /stores/:storeId/bank-transactions?status=&from=&to=&page=` | OWNER, MANAGER, CASHIER (chỉ đọc) | Sổ giao dịch |
| `POST /stores/:storeId/bank-transactions/:id/resolve` | OWNER, MANAGER (CASHIER chỉ `ATTACH_TO_BILL` khi bill thuộc ca của mình, PO chốt Q6) | Body `{action: 'ATTACH_TO_BILL'|'MARK_REFUND_PENDING'|'MARK_REFUNDED'|'IGNORE', billId?, note}`; `note` bắt buộc với IGNORE và MARK_REFUNDED |
| `GET /stores/:storeId/reconciliation?date=YYYY-MM-DD` | OWNER, MANAGER, CASHIER | Tổng hợp ngày: tổng tiền về, tổng Payment QR, xác nhận tay, giao dịch tồn, chênh lệch |
| `POST /stores/:storeId/reconciliation/:date/close` | OWNER, MANAGER | Chốt ngày; từ chối (409) khi còn giao dịch chưa xử lý, trừ khi `force=true` do OWNER kèm ghi chú |
| `POST /stores/:storeId/payments/:paymentId/refund` | OWNER, MANAGER | Hoàn tiền một Payment; thay thế hard-code `CASH` ở `orders.service.ts:1180` bằng `method` của Payment gốc |
| `POST /stores/:storeId/payments/:paymentId/refund/complete` | OWNER, MANAGER | `{reference}` đánh dấu đã chuyển trả |

### 5.6 Endpoint công khai cho khách (theo token phiên bàn, Đặc tả 02)

| Method + đường dẫn | Mô tả |
|---|---|
| `POST /public/sessions/:sessionToken/qr` | Tạo intent cho hóa đơn của bàn. Chỉ khi quán bật `customerCanPayQr` và module bật. Rate limit 5 lần/phút/token. Body `{}` (khách không được chọn số tiền, server dùng số còn phải thu). Trả như 5.5 nhưng không trả `autoConfirm` |
| `GET /public/payment-intents/:id` | Trạng thái `{status, amount, paidAmount, remaining, expiresAt, paidAt}`. Mini app poll 2 giây |
| `GET /public/orders/:id` (hiện có) | Bổ sung `payment: {status: 'UNPAID'|'PARTIAL'|'PAID', paidAmount, paidAt, method}` để màn Tracking hiện đúng cả khi không qua màn QR |

Lỗi mẫu: 409 "Hóa đơn đã thay đổi, vui lòng tạo lại mã QR"; 409 "Hóa đơn này đã được thanh toán"; 400 "Quán chưa cấu hình tài khoản nhận tiền"; 403 "Quán chưa bật thanh toán QR tự động"; 410 "Mã QR đã hết hạn, vui lòng tạo mã mới"; 401 "Chữ ký không hợp lệ" (webhook, không chi tiết hơn).

### 5.7 Realtime
- Mở rộng `EventsService`/`OrderEventPayload` (`apps/api/src/realtime/events.service.ts:6-19`): thêm kiểu `payment.confirmed`, `payment.partial`, `payment.needs_review`, `payment.expired`. `OrderEventPayload` hiện bắt buộc nhiều trường đơn hàng; nên đổi sang kiểu hợp nhất có trường `data?: Record<string, unknown>` thay vì nhồi trường rỗng như `table.call` đang làm (`events.service.ts:60-74`).
- Khách: poll `GET /public/payment-intents/:id` mỗi 2 giây trên màn QR. Phương án nâng cấp (tùy chọn): SSE công khai theo intent với token, vẫn dùng `EventsService` (lưu ý hiện chỉ đúng với 1 instance API, comment ở `events.service.ts:28-31`; khi scale cần Redis pub/sub).

### 5.8 Tác vụ nền
Cần thêm `@nestjs/schedule` (hoặc `setInterval` có khóa; PO/dev chọn):
- mỗi phút: chuyển intent `PENDING` quá `expiresAt` thành `EXPIRED`; quét lại giao dịch `RECEIVED` bị kẹt;
- mỗi 5 phút (chỉ adaptor có `pullTransactions`): kéo giao dịch từ mốc cuối để vá webhook rơi, đi qua cùng đường ghi sổ idempotent;
- mỗi giờ: cảnh báo giao dịch `UNMATCHED/NEEDS_REVIEW/DUPLICATE_PAYMENT/LATE_CLOSED` tồn quá 2 giờ (SSE + badge);
- hằng đêm: kiểm tra bất biến (mỗi hóa đơn `PAID` có tổng Payment COMPLETED = tổng; mỗi `bankTransactionId` có nhiều nhất 1 Payment) và ghi cảnh báo nếu vi phạm.

---

## 6. Thay đổi giao diện

### 6.1 Admin (`apps/admin`)
- Trang mới `apps/admin/src/pages/Payments.tsx`, thêm route `payments` ở `apps/admin/src/App.tsx:122-129` (mẫu giống route `printers`) và mục menu ở `apps/admin/src/components/Layout.tsx:31` (nhóm "THIẾT LẬP QUÁN", vai trò MGMT, thêm huy hiệu số giao dịch cần xử lý). Ba tab: "Tài khoản nhận tiền", "Giao dịch ngân hàng", "Đối soát".
- `apps/admin/src/pages/Pos.tsx`:
  - Thay `PayModal` (dòng 34-137) bằng `CheckoutModal` của Đặc tả 02; trong đó phương thức "Quét mã QR" (`QR_BANK`) hiển thị khung QR (dùng `qr.ts`), số tiền, đếm ngược hạn, dòng trạng thái ("Đang chờ", "Đã nhận X đ", "Còn thiếu X đ"), nút "Tạo lại mã", nút "Xác nhận tay" (chỉ khi `autoConfirm=false` hoặc sau 60 giây chưa nhận được mà thu ngân thấy tiền về). Phương thức `TRANSFER` giữ ý nghĩa "chuyển khoản không QR, xác nhận tay" để không phá thói quen quán.
  - Nhận SSE `payment.*` để đóng modal và toast thành công; xem `OrderNotifier.tsx` (cần thêm nhánh xử lý `payment.confirmed` và `payment.needs_review` ở khoảng dòng 45-87).
- `apps/admin/src/labels.ts:41` (`PAY_METHOD`) thêm nhãn "Xác nhận tự động" cho `confirmedBy`.
- `apps/admin/src/pages/Orders.tsx`: cột/huy hiệu "QR tự động" hoặc "QR xác nhận tay", nút "Hoàn tiền" gọi API mới theo quyền.
- `apps/admin/src/pages/Reports.tsx`: thêm thẻ "Thanh toán QR tự động / xác nhận tay / tiền mặt / chuyển khoản" và link tới đối soát.

### 6.2 Mini app (`apps/miniapp`)
- Màn mới `pages/Pay.tsx`, route `/s/:storeSlug/pay` thêm vào `apps/miniapp/src/components/layout.tsx:34-47` (cạnh các route hiện có).
- `pages/Tracking.tsx`: trong khối "Chi tiết món" (dòng 240-251) thêm nút "Thanh toán bằng QR" khi `order.payment.status !== 'PAID'` và quán bật tính năng; sau thanh toán, dòng 150-152 ("Thanh toán đã được quán xác nhận") đổi theo `payment.method` và `confirmedBy` (ví dụ "Đã nhận chuyển khoản 245.000đ lúc 19:42"). Ẩn nút khi không có tài khoản xác minh.
- `useOrder.ts`: hiện dừng poll khi đơn ở trạng thái cuối (`FINAL_STATUSES`); với trạng thái `PAID` chưa tới `COMPLETED` không đổi hành vi, nhưng cần poll nhanh 2 giây khi màn QR mở (hook riêng `usePaymentIntent`).
- Chuỗi tiếng Việt mới: "Quét mã để thanh toán", "Đang chờ thanh toán...", "Đã thanh toán", "Mã đã hết hạn, tạo mã mới", "Sao chép số tài khoản", "Sao chép nội dung", "Lưu ảnh QR", "Còn thiếu {x} đ, vui lòng chuyển thêm hoặc gọi nhân viên".
- Thiết kế v2 không có màn thanh toán QR (16 màn không gồm): cần designer duyệt trước khi dev làm màn này; trong lúc chờ dùng khung `card status-card` hiện có.

---

## 7. Trường hợp biên và bảo mật

### 7.1 Trùng và gửi lại
- Webhook gọi lại cùng `providerTxnId`: P2002 ở `BankTransaction`, trả ack, không xử lý lại. Cùng giao dịch khớp hai lần: cột `Payment.bankTransactionId @unique` chặn lần hai.
- Đối tác không có mã giao dịch ổn định (GĐ-09): khóa suy diễn = băm(`accountNumber|amount|transferredAt|contentNormalized`), đánh dấu độ tin cậy thấp; hai giao dịch giống hệt trong cùng giây là rủi ro nuốt giao dịch, ghi nhận trong rủi ro Mục 10.

### 7.2 Lệch số tiền
- Thiếu: mặc định ghi nhận phần đã chuyển (tiền thật đã về) và hóa đơn thành "thanh toán một phần"; thu ngân thu nốt bằng tiền mặt/QR mới. Tắt `autoAcceptPartial` để chuyển thẳng ngoại lệ.
- Thừa: chỉ ghi nhận đúng phần còn phải thu; phần dư vào hàng đợi, quản lý hoàn trả hoặc ghi nhận có chủ đích; không tự cộng vào doanh thu.
- Hóa đơn đổi tổng sau khi tạo QR (khách gọi thêm món): mọi intent `PENDING` của hóa đơn chuyển `SUPERSEDED`; mini app báo "Hóa đơn đã thay đổi, tạo lại mã"; vẫn nhận tiền về QR cũ theo bảng 5.4.

### 7.3 Quá hạn và chuyển nhầm
- Quá hạn mà hóa đơn còn mở: vẫn nhận (5.4). Hóa đơn đã đóng: `LATE_CLOSED`, vào hoàn tiền.
- Chuyển nhầm cho quán (khách gõ sai nội dung, không mã): `UNMATCHED`; thu ngân/quản lý có thể "Gán vào hóa đơn" bằng cách chọn hóa đơn mở cùng số tiền, ghi vào audit. Không có tự gán theo số tiền (nhiều bàn cùng số tiền sẽ nhầm); chỉ hiển thị gợi ý.
- Khách chuyển nhầm sang QR của quán khác: không phát hiện được; giao dịch đó không đến tài khoản của quán này nên hệ thống không thấy.
- Khách chuyển nhiều lần đúng một mã: lần đầu theo bảng 5.4, các lần sau `DUPLICATE_PAYMENT` hoặc `OVERPAID`.

### 7.4 Cuộc đua với thu ngân
Thu ngân bấm tiền mặt đúng lúc tiền về: nhánh thắng ghi Payment, nhánh thua nhận 409 nội bộ và chuyển giao dịch thành `DUPLICATE_PAYMENT`; hệ thống không bao giờ tạo hai Payment cho cùng phần cần thu. Tái sử dụng cơ chế `updateMany` có điều kiện sẵn ở `orders.service.ts:1039-1053`.

### 7.5 Webhook an toàn
- Token ngẫu nhiên trong URL (không đoán được) + chữ ký/khóa theo từng đối tác (không dùng chung giữa các quán) + so sánh hằng thời gian (`crypto.timingSafeEqual`) + HTTPS bắt buộc ở production.
- Bí mật và khóa API mã hóa AES-256-GCM, không bao giờ ghi vào log/audit/response (chỉ hiển thị một lần khi tạo/quay).
- Không log `rawPayload` ở mức INFO; giới hạn truy cập `rawPayload` cho OWNER/MANAGER; xem thời hạn lưu ở Mục 10.
- Danh sách IP của đối tác (nếu họ công bố, GĐ-10): tùy chọn cấu hình, không coi là đủ một mình.
- Cảnh báo bất thường: tỷ lệ chữ ký sai tăng, giao dịch lệch tài khoản, giao dịch lớn bất thường, webhook ngừng đột ngột (có `lastWebhookAt`, hiển thị "Chưa nhận tín hiệu trong N phút" trong lúc quán còn mở cửa).

### 7.6 Đa quán và riêng tư
- Mọi truy vấn lọc `storeId`; tài khoản nhận tiền thuộc quán; kiểm tra chéo `intent.storeId == txn.storeId` (5.4 bước 4).
- Số tài khoản người chuyển chỉ lưu che (4 số cuối); tên người chuyển lưu nếu đối tác trả về, chỉ OWNER/MANAGER xem; không hiển thị cho khách.
- Không gắn giao dịch với danh tính khách trừ khi khách đã đăng nhập (Đặc tả 03) và đồng ý.

### 7.7 Khi hệ thống/đối tác gián đoạn
Mất webhook: tab "Giao dịch ngân hàng" có chỉ báo "Chưa nhận tín hiệu"; thu ngân dùng "Xác nhận tay"; job `pullTransactions` vá sau. API InnoOrder tắt: đối tác thường gọi lại theo chính sách của họ (GĐ-11); giao dịch vẫn có trong sao kê ngân hàng nên đối soát cuối ngày bắt được.

### 7.8 Nhật ký kiểm toán (AuditLog)
Ghi các hành động: `payment_account_create/update/delete/rotate_secret`, `qr_intent_create/cancel`, `bank_txn_received/matched/unmatched`, `qr_manual_confirm`, `bank_txn_resolve`, `payment_refund`, `payment_refund_complete`, `reconciliation_close`, `webhook_rejected`. Ghi nhận tác nhân `system:bank-feed` khi tự động (`userId = null`, `afterData.actor = 'system'`). Mẫu ghi dùng `AuditService.log` (`apps/api/src/common/audit.service.ts`).

### 7.9 Chế độ trả trước (tùy chọn P1, cần quyết định Q4)
Quán trà sữa/cà phê/mang đi muốn khách trả trước khi bếp làm: cờ `requirePaymentBeforeKitchen`; đơn ở trạng thái chờ thanh toán không in phiếu bếp và không hiện ở KDS cho đến khi Payment đủ. Cần thêm cổng ở `createOrder` (`orders.service.ts:216-271`) và ở in phiếu; tách thành story riêng, không nằm trong luồng ăn tại bàn mặc định.

---

## 8. Tiêu chí nghiệm thu (Cho / Khi / Thì)

1. Cho quán có tài khoản `MOCK` đã xác minh và hóa đơn bàn B05 cần thu 245.000đ, khi thu ngân tạo QR và giả lập webhook đúng mã + đúng số tiền, thì trong <= 3 giây Payment `QR_BANK` được tạo với `confirmedBy = BANK_FEED`, hóa đơn `PAID`, bàn sang "Cần dọn", POS hiện "Đã thanh toán" mà thu ngân không bấm nút nào.
2. Cho webhook đã xử lý thành công, khi cùng `providerTxnId` được gửi lại 5 lần (kể cả song song), thì chỉ có đúng 1 Payment và hệ thống trả ack mỗi lần.
3. Cho webhook có chữ ký sai hoặc token sai, khi gọi, thì trả 401/404, không có BankTransaction nào được tạo (với chữ ký sai) và có một dòng audit `webhook_rejected`.
4. Cho giao dịch với số tiền ít hơn còn phải thu, khi `autoAcceptPartial = true`, thì tạo Payment bằng số tiền đã chuyển, hóa đơn `PARTIALLY_PAID`, POS và mini app hiện đúng "Còn thiếu".
5. Cho giao dịch lớn hơn còn phải thu, khi khớp, thì chỉ ghi nhận đúng số còn phải thu, `excessAmount` > 0 và xuất hiện trong hàng đợi hoàn tiền.
6. Cho intent đã hết hạn nhưng hóa đơn còn mở, khi tiền về đúng số, thì vẫn được ghi nhận thanh toán.
7. Cho hóa đơn đã thanh toán bằng tiền mặt, khi tiền QR về sau đó, thì không tạo Payment thứ hai, giao dịch ở `DUPLICATE_PAYMENT` và quản lý nhận thông báo.
8. Cho thu ngân bấm "Tiền mặt" và tiền QR về trong cùng lúc (test song song 20 lần), thì mọi lần chỉ có tối đa một Payment cho phần cần thu và không có lỗi 500.
9. Cho giao dịch không có mã đối soát, khi về, thì ở `UNMATCHED`, hiện trong tab "Giao dịch ngân hàng" và huy hiệu menu, không đổi trạng thái hóa đơn nào.
10. Cho quán A và quán B, khi giao dịch gửi tới token của quán A mang mã intent của quán B, thì `NEEDS_REVIEW`, không có Payment nào ở quán B.
11. Cho user CASHIER, khi gọi tạo/sửa tài khoản nhận tiền hoặc hoàn tiền, thì trả 403; Manager hoàn tiền được; đổi số tài khoản mà không nhập lại mật khẩu bị từ chối.
12. Cho mini app mở màn QR, khi tiền về, thì trong <= 5 giây từ lúc hệ thống ghi nhận (poll 2 giây) màn hiển thị "Đã thanh toán" và Tracking cho thấy đúng.
13. Cho hóa đơn đổi tổng sau khi tạo QR, khi khách chuyển đúng số tiền cũ, thì tiền được ghi nhận một phần và hóa đơn hiện số còn thiếu đúng.
14. Cho một ngày có 10 giao dịch QR, khi chạy đối soát, thì tổng tiền về = tổng Payment QR + ngoại lệ, "Chốt ngày" bị chặn khi còn ngoại lệ chưa xử lý.
15. Cho hoàn tiền một hóa đơn thanh toán bằng QR, khi quản lý xác nhận, thì Payment hoàn có `method = QR_BANK` (không phải `CASH`), có việc "chuyển trả" ở trạng thái chờ, và báo cáo phương thức trừ đúng số hoàn.
16. Cho `NODE_ENV=production`, khi gọi endpoint giả lập `MOCK`, thì bị từ chối.
17. Cho chuỗi VietQR được sinh, khi kiểm tra, thì CRC hợp lệ, số tiền và nội dung khớp, quét bằng 3 app ngân hàng thật điền đúng số tiền và nội dung (kiểm thử thủ công, ghi vào biên bản).

---

## 9. Phân rã công việc (thứ tự làm)

Phụ thuộc chính: B0 (Bill, `BillService.applyPayment`) của Đặc tả 02 phần (b).

| # | Công việc | Loại | Cỡ | Phụ thuộc |
|---|---|---|---|---|
| 1-bis | Phương án tạm nếu chưa có Bill: gắn `PaymentIntent.orderId`, gọi `payOrder` nội bộ; bỏ khi có Bill | BE | S | không |
| 1 | Migration + Prisma (4 bảng, cột Payment, `rawBody: true` ở `main.ts`, biến môi trường, module `payments`) | BE | M | không |
| 2 | Tiện ích mã hóa AES-GCM, sinh `code`, chuẩn hóa nội dung, dựng chuỗi VietQR + CRC + unit test vector | BE | M | 1 |
| 3 | CRUD `PaymentAccount` + che số + nhập lại mật khẩu + audit | BE | M | 1 |
| 4 | `BankFeedProvider` + `ProviderRegistry` + adaptor `MANUAL`/`MOCK` + endpoint giả lập | BE | M | 1 |
| 5 | Endpoint tạo/xem/hủy intent (nhân viên) + xác nhận tay | BE | M | 2, 3, B0 |
| 6 | Webhook controller + idempotent + giới hạn tần suất + log từ chối | BE | M | 4 |
| 7 | `PaymentMatchingService` đủ bảng 5.4 + tích hợp `BillService.applyPayment` + realtime + test đua | BE | L | 5, 6, B0 |
| 8 | Tác vụ nền (hết hạn, quét kẹt, cảnh báo, kiểm bất biến) | BE | M | 7 |
| 9 | Sổ giao dịch + resolve + đối soát + chốt ngày | BE | L | 7 |
| 10 | Hoàn tiền theo phương thức gốc + việc chuyển trả; sửa hard-code `CASH` | BE | M | B0 |
| 11 | Admin: trang Thanh toán & đối soát (3 tab) | FE | L | 3, 9 |
| 12 | Admin: `CheckoutModal` phần QR (trong Đặc tả 02) + SSE `payment.*` | FE | M | 5, 7 |
| 13 | Mini app: API công khai + màn QR + cập nhật Tracking | FE + BE | L | 7, thiết kế màn |
| 14 | Adaptor nhà cung cấp thật số 1 (sau khi PO chọn Q1 và có tài khoản thử nghiệm) | BE + hạ tầng | M | 6; GĐ-07 |
| 15 | Hạ tầng: HTTPS + domain cố định cho webhook, `APP_ENCRYPTION_KEY`, giám sát, trust proxy | Hạ tầng | S-M | 6 |
| 16 | Pilot: 1 quán, đo các số đo ở Mục 1, kiểm thử quét 3 app ngân hàng | Vận hành | M | 7, 14 |

Tổng ước lượng (một developer, không tính chờ đối tác): khoảng 4-5 tuần cho phần BE+FE, chưa tính B0 và pilot. Mốc có thể giao sớm (không phụ thuộc đối tác): sau bước 1-5 và 11-12 đã có QR động + thu ngân xác nhận (giá trị thật: khách quét là số tiền và nội dung đúng), chế độ `MANUAL`.

---

## 10. Rủi ro, giả định cần xác minh, quyết định cần PO

Rủi ro:
- Phụ thuộc đối tác: độ trễ, tính ổn định, chính sách gọi lại, thay đổi API. Giảm bằng adaptor + job kéo + xác nhận tay.
- Nội dung chuyển khoản bị app ngân hàng chỉnh sửa/cắt: tỷ lệ khớp tự động thấp hơn kỳ vọng. Đo ở pilot; dự phòng là gợi ý khớp theo số tiền cho thu ngân.
- Lộ bí mật webhook dẫn tới ghi nhận thanh toán giả: giảm bằng xác nhận ngược khoản lớn, cảnh báo bất thường, đối soát hằng ngày (không bao giờ bỏ qua đối soát với sao kê).
- Đổi tài khoản nhận tiền độc hại: nhập lại mật khẩu, thông báo mọi quản lý, audit.
- Rủi ro pháp lý/thuế: tiền về tài khoản của quán, không qua InnoCom nên InnoCom không là trung gian thanh toán (GĐ-12: PO xác nhận với tư vấn pháp lý khi mô hình thương mại chốt, đặc biệt nếu muốn thu phí theo giao dịch).
- Lưu `rawPayload` có dữ liệu cá nhân của người chuyển (tên, số tài khoản che): đặt thời hạn lưu (đề xuất 12 tháng, PO/pháp lý chốt) và job xóa/ẩn.

Giả định cần xác minh (tổng hợp): GĐ-01 độ trễ ghi có -> webhook; GĐ-02 khả năng hoàn tiền tự động qua API (giả định là không); GĐ-03 liên kết sâu mở app ngân hàng từ Zalo mini app và API lưu ảnh của `zmp-sdk`; GĐ-04 đối tác có trả giao dịch OUT không; GĐ-05 giới hạn độ dài/biến đổi nội dung chuyển khoản; GĐ-06 chi tiết chuỗi VietQR/NAPAS và hành vi app ngân hàng; GĐ-07 mọi thông tin API, ký, giá, onboarding của đối tác; GĐ-08 timestamp chống replay; GĐ-09 mã giao dịch ổn định; GĐ-10 danh sách IP đối tác; GĐ-11 chính sách gọi lại; GĐ-12 pháp lý.

Câu hỏi cho chủ sản phẩm:
- Q1: Chọn nhà cung cấp biến động số dư nào làm adaptor đầu tiên (hoặc kết nối trực tiếp ngân hàng)? Ai ký hợp đồng (InnoCom hay từng quán)? Phí do ai chịu?
- Q2: Quán nhận tiền trực tiếp vào tài khoản của họ (mặc định trong thiết kế này) hay InnoCom thu hộ?
- Q3: Có thu phí theo giao dịch QR hay gói tháng (module `qr_auto_confirm` thuộc gói nào: Standard/Pro)? Không có số liệu trong tài liệu này.
- Q4: Chế độ trả trước (mục 7.9) có nằm trong phạm vi đợt này?
- Q5: Khách tự thanh toán trong mini app có bật mặc định không, hay mặc định chỉ thu ngân tạo QR?
- Q6: Quyền xử lý giao dịch ngoại lệ: Cashier được "Gán vào hóa đơn" hay chỉ Manager?
- Q7: Thiếu tiền mặc định ghi nhận một phần (đề xuất) hay từ chối?
- Q8: Thời hạn lưu `rawPayload` và dữ liệu giao dịch ngân hàng bao lâu?
