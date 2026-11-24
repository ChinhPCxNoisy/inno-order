# Đặc tả 03 - Tích điểm, hạng thành viên và voucher qua Zalo

Phiên bản: 1.0 (2026-11-12). Người viết: PM/PO. Đối tượng đọc: Developer (dev-inno), Tester, Designer (các màn mới).
Ước lượng: S = tối đa 1 ngày công, M = 2-4 ngày, L = 5-10 ngày (một developer).
"GĐ-xx" = giả định cần xác minh (phụ thuộc Zalo hoặc pháp lý mà PO không thể xác minh khi viết). Không có giá tiền nào trong tài liệu này là số liệu thật; mọi con số mẫu ghi "ví dụ" chỉ để minh họa.

---

## 0. Hiện trạng code (bằng chứng)

| Hạng mục | Hiện trạng | Bằng chứng |
|---|---|---|
| Màn Ưu đãi (thiết kế v2 màn 12-13) | Chỉ là trạng thái rỗng "Ưu đãi đang được chuẩn bị"; chú thích trong mã nói rõ chờ API `/public/stores/:slug/vouchers` | `apps/miniapp/src/pages/Voucher.tsx:5-27` |
| Route | Chỉ có `/s/:storeSlug/voucher`; chưa có route chi tiết ưu đãi | `apps/miniapp/src/components/layout.tsx:40` |
| Cờ hiển thị tab | `showVoucherTab` có trong cài đặt quán và trả cho mini app | `apps/api/src/stores/stores.service.ts:24-25, 53`, `apps/miniapp/src/pages/Profile.tsx:60` |
| Khách hàng (CRM cơ bản) | Mô hình `Customer` theo quán: `phone`, `zaloUserId`, `totalOrders`, `totalSpent`, `lastVisitAt`, `marketingConsent`, `transactionalConsent`, `consentDate`, `status (ACTIVE/BLOCKED/DELETED)`. `@@unique([storeId, phone])`; `zaloUserId` chỉ có chỉ mục thường, không duy nhất | `apps/api/prisma/schema.prisma:124-128, 439-460` |
| Không có điểm, hạng, voucher, bản ghi consent | Không có bảng nào | `schema.prisma` (toàn bộ) |
| Khách tự khai SĐT khi đặt món, không xác thực | `CustomerCaptureDto` nhận `phone`, `name`, `marketingConsent`, `transactionalConsent` trên endpoint công khai; `createOrderTx` tạo/cập nhật `Customer` và đặt cờ consent theo giá trị client gửi lên, và ghi `consentDate = now()` mỗi lần đặt đơn dù consent không đổi | `apps/api/src/orders/dto/order.dto.ts:54-60`, `apps/api/src/orders/orders.service.ts:394-429` |
| `totalOrders` không bao giờ tăng; `totalSpent` chỉ tăng khi thanh toán, không giảm khi hoàn tiền | `payOrder` chỉ tăng `totalSpent`, `lastVisitAt`; `refundOrder` không đụng `Customer` | `orders.service.ts:1081-1090, 1149-1212` |
| Đăng nhập Zalo ở mini app chỉ lưu cục bộ | `zaloLogin()` lấy `getUserID`/tên/`getIDToken` và `Profile` lưu vào `localStorage`; không gọi server; chú thích trong mã nêu rõ chưa có xác thực chữ ký phía máy chủ vì chưa rõ tài liệu chính thức | `apps/miniapp/src/zalo.ts:1-67`, `apps/miniapp/src/pages/Profile.tsx:22-37`, `apps/miniapp/src/session.ts:1-7` |
| Đánh giá gắn `zaloUserId` do client gửi, server chưa xác minh | `OrderReview.zaloUserId` | `schema.prisma:474-478`, `apps/miniapp/src/api.ts:84-92` |
| "Xóa dữ liệu trên thiết bị" chỉ xóa `localStorage`, không xóa dữ liệu phía máy chủ | `clearSession()` | `apps/miniapp/src/pages/Profile.tsx:41-57`, `session.ts:46-49` |
| Giảm giá hiện có chỉ là một số tiền thu ngân nhập tay khi thanh toán, không lưu lý do/mã | `PayOrderDto.discountAmount`, ghi đè `Order.discountAmount` | `orders.service.ts:1019-1049`, `apps/admin/src/pages/Pos.tsx:38, 116-120` |
| Module trả phí theo quán | `Store.enabledModules` do Super Admin bật; có sẵn mẫu cho `staff_rating` | `apps/api/src/common/modules.ts:5-23`, `apps/admin/src/pages/Stores.tsx:280` |
| Không có bộ lập lịch | Không có `@nestjs/schedule` | `apps/api/package.json` |
| BRD | FR-CRM-01..09; voucher đơn giản P2 (FR-CRM-07, FR-CUST-15), tích điểm P2 (FR-CRM-08), gửi Zalo/SMS P2 (FR-CRM-09); MVP loại trừ "Voucher phức tạp" và "Tích điểm thành viên" | `202609162104.md:748, 902-910, 185-186` |
| Giá gói (tham khảo của BRD): voucher cơ bản ở gói Standard, CRM + Zalo Mini App ở gói Pro | `202609162104.md:1981-1982` |

Thiết kế mẫu (bộ HTML v2) dùng làm chuẩn giao diện, trích từ `.../design-v2/InnoOrder_App_v2/source/app.js` dòng 63-65:
- Màn "Ưu đãi của quán": thẻ ưu đãi (`.card.offer`) gồm ô mã (`.offer-code`, ví dụ "10%"), nhãn nhỏ (`eyebrow`, ví dụ "Hẹn lần ghé sau"), tiêu đề (`h2`, "Thêm một bữa ngon"), mô tả ngắn ("Giảm 10% cho đơn từ 300.000đ. Xem đầy đủ điều kiện áp dụng.") và mũi tên; dưới cùng dòng chú thích "Ưu đãi chỉ áp dụng khi được quán xác nhận. Không tự động trừ vào giỏ món."
- Màn "Chi tiết ưu đãi": thẻ trạng thái (`.status-card`) với biểu tượng quà, nhãn, tiêu đề lớn hai dòng "Thêm một / bữa ngon.", dòng phụ "Giảm 10% cho lần ghé sau", ô mã (`.coupon`, "HENGAPLAI"); thẻ "Điều kiện áp dụng" gồm 4 gạch đầu dòng (đơn tối thiểu và mức giảm tối đa, hạn dùng, không áp dụng đồng thời với ưu đãi khác, nhờ nhân viên kiểm tra trước khi thanh toán); nút "Sao chép mã ưu đãi" (toast "Đã sao chép mã {mã}", nếu không sao chép được hiện hộp thoại chứa mã).
- Các chuỗi minh họa phải bỏ khi có dữ liệu thật: hộp "Nội dung ưu đãi dưới đây là dữ liệu minh họa", nhãn "Ưu đãi minh họa", dòng "Đây là ưu đãi mẫu, chưa phải chương trình thực tế của quán".
- Các lớp CSS cần dùng đã có sẵn trong `apps/miniapp/src/css/app.scss` (`.offer`, `.offer-code`, `.coupon`, `.status-card`, `.big-status.red`, `.notice-box`, `.bottom-sheet`).
Thiết kế KHÔNG có: màn điểm thành viên, hạng, đổi điểm, ô nhập mã trong giỏ, màn consent. Các màn này cần designer bổ sung (Mục 6.3).

Lưu ý quan trọng về ràng buộc thiết kế: thiết kế v2 nói ưu đãi "chỉ áp dụng khi được quán xác nhận, không tự động trừ vào giỏ món". Đặc tả này tôn trọng điều đó: khách chọn/khai báo ưu đãi trong giỏ như một "yêu cầu dùng ưu đãi", thu ngân/POS là nơi áp dụng thật. Bật tự động áp dụng là quyết định sau (Q5).

---

## 1. Mục tiêu và giá trị

Cho quán: giữ chân khách quay lại (không cần cài app riêng, khách đã có Zalo); biết ai là khách quen; chạy chương trình ưu đãi có kiểm soát chi phí và chống lạm dụng; đo được hiệu quả.
Cho khách: tích điểm không cần thẻ giấy, thấy ưu đãi của quán ngay trong Zalo, dùng bằng mã, kiểm soát dữ liệu cá nhân của mình (đồng ý, rút lại, xóa).

Số đo thành công (đề xuất; PO chốt ngưỡng):
- Tỷ lệ hóa đơn đã thanh toán gắn với một thành viên (đo bằng `Bill.customerId` không rỗng / tổng hóa đơn): mục tiêu do PO đặt sau 3 tháng pilot.
- Tỷ lệ khách thành viên quay lại trong 30 ngày so với khách không phải thành viên (số liệu mô tả, không kết luận nhân quả).
- Tỷ lệ sử dụng voucher (đã dùng / đã phát) theo chiến dịch; chi phí giảm giá (tổng giảm) so với ngân sách chiến dịch.
- 0 voucher bị dùng quá một lần (với loại một lần/khách) và 0 lần dùng chéo quán (kiểm bằng truy vấn đối soát hằng đêm).
- 100% tin nhắn/thông báo tiếp thị gửi đi có bản ghi đồng ý còn hiệu lực tại thời điểm gửi.
- Điểm đã phát - điểm đã dùng - điểm hết hạn = số dư tổng (đối soát sổ điểm luôn khớp, sai lệch 0).

---

## 2. Phạm vi

Gồm (giai đoạn 1, không tốn phí tin nhắn):
1. Định danh thành viên bằng tài khoản Zalo, xác thực phía máy chủ (Mục 5.1), kèm số điện thoại tùy chọn có xác thực.
2. Ghi nhận đồng ý (consent) có thời điểm, phạm vi, phiên bản văn bản; rút lại; quyền xem/xuất/xóa dữ liệu.
3. Tích điểm theo hóa đơn đã thanh toán; số dư điểm; sổ điểm không sửa/xóa (append-only); hạng thành viên theo mức chi tiêu.
4. Đổi điểm lấy voucher; ghi nhận dùng điểm như một khoản giảm trên hóa đơn.
5. Voucher: giảm phần trăm, giảm số tiền, tặng món; điều kiện tối thiểu, mức giảm tối đa, thời hạn, giới hạn tổng lượt, giới hạn mỗi khách, một lần/khách, đối tượng (tất cả, thành viên, theo hạng).
6. Phát voucher: thủ công/chiến dịch, sinh nhật, quay lại sau N ngày, chào mừng; xuất hiện trong màn Ưu đãi của khách (phát trong ứng dụng, không tốn phí).
7. Màn mini app: "Ưu đãi của quán", "Chi tiết ưu đãi" đúng thiết kế v2; khai báo ưu đãi trong giỏ; thành viên (điểm, hạng, lịch sử) và consent.
8. POS: gắn khách vào hóa đơn, áp dụng voucher/điểm với kiểm tra phía máy chủ, phân quyền duyệt ngoại lệ.
9. Admin: tạo/tắt/sửa giới hạn voucher, xem lượt dùng, cấu hình chương trình điểm/hạng, danh sách khách, điều chỉnh điểm có lý do, báo cáo.
10. Module trả phí `loyalty` (bật theo quán bởi Super Admin).

Không gồm / giai đoạn sau:
- Gửi tin qua Zalo ZNS (tin nhắn Zalo tính phí): tùy chọn giai đoạn 2, chỉ nêu nguyên tắc ở Mục 5.9. Không bịa giá; chi phí do từng quán/nhà cung cấp xác định.
- SMS/OTP SMS (tốn phí); chỉ là phương án dự phòng xác thực số điện thoại (GĐ-02).
- Chương trình giới thiệu bạn bè, đố vui/vòng quay, gamification, thẻ quà tặng/tiền nạp trước, điểm dùng chung nhiều quán/chuỗi, liên kết thẻ thành viên ngân hàng.
- Điểm hết hạn tự động theo lô (FIFO) ở v1: xem câu hỏi Q4; v1 không hết hạn điểm (đơn giản, chắc chắn đối soát), có sẵn cột để mở rộng.
- Tự động áp dụng voucher vào hóa đơn không qua thu ngân (Q5).
- Áp dụng voucher cho từng nhóm món/danh mục (giữ ở mức hóa đơn, ngoại trừ "tặng món").

---

## 3. Luồng người dùng

### 3.1 Khách (mini app)
**Tham gia thành viên**
1. Khách vào Cá nhân > "Đăng nhập bằng Zalo" (đã có nút, `Profile.tsx`). Mini app lấy access token của Zalo và gọi `POST /public/stores/:slug/members/login`. Máy chủ xác minh token với Zalo (Mục 5.1), tạo hoặc tìm `Customer` theo (`storeId`, `zaloUserId`), trả `memberToken`.
2. Màn đồng ý (consent) hiện lần đầu: 
   - "Lưu thông tin Zalo của bạn để tích điểm và nhận ưu đãi tại {tên quán}" (phạm vi `LOYALTY`, bắt buộc để tham gia; không chọn sẵn... khách phải chủ động bấm "Đồng ý và tham gia");
   - "Cho phép quán gửi thông báo ưu đãi qua Zalo" (phạm vi `MARKETING_ZNS`, tùy chọn, mặc định KHÔNG chọn);
   - liên kết xem chính sách bảo vệ dữ liệu cá nhân của quán/InnoOrder.
   Từ chối `LOYALTY` thì vẫn gọi món bình thường như khách không đăng nhập.
3. Tùy chọn: thêm ngày sinh (chỉ ngày/tháng, phạm vi `PROFILE_BIRTHDAY`) để nhận ưu đãi sinh nhật; thêm số điện thoại qua quyền lấy số của Zalo (GĐ-01).
**Gọi món và tích điểm**
4. Khách đã đăng nhập gửi đơn như bình thường; mini app gửi `memberToken` (header) để gắn đơn với thành viên. Hóa đơn thanh toán xong: điểm được cộng, khách thấy ở màn "Đơn hoàn tất" dòng "+{n} điểm" và số dư mới.
5. Khách chưa đăng nhập: màn "Đơn hoàn tất" hiện lời mời "Đăng nhập Zalo để nhận {n} điểm cho đơn này (trong {N} ngày)". Sau khi đăng nhập, bấm nhận điểm: `POST /public/orders/:id/claim-points` (Mục 5.2); chỉ được khi đơn `COMPLETED`, chưa ai nhận, còn trong thời hạn.
**Ưu đãi**
6. Cá nhân > "Ưu đãi của quán": danh sách thẻ ưu đãi (công khai + của riêng khách). Chạm thẻ vào "Chi tiết ưu đãi": mã, điều kiện, hạn; bấm "Sao chép mã ưu đãi".
7. Tại Giỏ món: ô "Ưu đãi" (Mục 6.2). Khách chọn ưu đãi của mình hoặc nhập mã; mini app hiển thị "Giảm dự kiến" và dòng "Quán sẽ xác nhận khi thanh toán"; gửi đơn kèm `voucherCode` như yêu cầu. Giá đơn gửi lên KHÔNG bị trừ.
8. Cá nhân > "Điểm thành viên": số dư, hạng, tiến độ lên hạng, lịch sử cộng/trừ, danh sách quà đổi bằng điểm. Đổi điểm: chọn voucher đổi được > xác nhận > voucher xuất hiện trong "Ưu đãi của bạn".
**Quyền dữ liệu**
9. Cá nhân > "Quyền riêng tư": xem trạng thái đồng ý từng phạm vi, rút lại bất cứ lúc nào; "Tải dữ liệu của tôi"; "Xóa tài khoản thành viên và dữ liệu" (Mục 5.2). Nút "Xóa dữ liệu trên thiết bị" hiện có (`Profile.tsx:41-57`) giữ nhưng đổi lời giải thích để không nhầm với xóa trên máy chủ.

### 3.2 Thu ngân / POS
1. Mở hóa đơn bàn (Đặc tả 02) > khối "Khách hàng & ưu đãi".
2. Gắn khách: nếu đơn do thành viên đăng nhập gửi thì đã gắn sẵn; nếu không, nhập số điện thoại hoặc tìm theo tên Zalo; hệ thống hiển thị tên (che bớt), hạng, số dư điểm, ưu đãi khả dụng. Khách có thể đọc "mã thành viên" 6 chữ số hiển thị trong mini app (đổi mới mỗi 5 phút, chống đọc hộ người khác; có thể bỏ ở v1, Q6).
3. Áp dụng ưu đãi: chip "Khách muốn dùng: HENGAPLAI" (từ giỏ của khách) hoặc chọn/nhập mã; bấm "Áp dụng": máy chủ kiểm tra toàn bộ điều kiện và hiển thị khoản giảm đã tính hoặc lý do không áp dụng bằng tiếng Việt. Thành công: một dòng giảm giá loại VOUCHER trên hóa đơn (gỡ được nếu chưa thanh toán).
4. Dùng điểm (tùy chọn): nhập số điểm hoặc "Dùng tối đa"; hiển thị số tiền quy đổi; giới hạn theo phần trăm hóa đơn tối đa.
5. Thanh toán (Đặc tả 01/02). Tại thời điểm đóng hóa đơn: voucher chuyển `CONSUMED`, điểm bị trừ, điểm mới được cộng; thông tin này in lên bill.
6. Ngoại lệ (đơn chưa đạt tối thiểu, voucher quá hạn vài giờ, khách quên mã): chỉ Quản lý/Chủ quán được "Áp dụng ngoại lệ" kèm lý do bắt buộc; thu ngân tự duyệt không được.

### 3.3 Chủ quán / Quản lý (Admin)
1. Khách hàng > "Chương trình thành viên": bật/tắt, quy tắc tích điểm, quy đổi điểm, hạng, thời hạn nhận điểm sau thanh toán.
2. Khách hàng > "Ưu đãi": tạo (thông tin hiển thị: nhãn, tiêu đề, mô tả ngắn; loại, giá trị, tối thiểu, tối đa, hạn, giới hạn, đối tượng, mã công khai hoặc mã riêng từng khách, có đổi bằng điểm hay không), xem trước đúng như khách thấy, kích hoạt; tạm dừng/kết thúc; xem lượt dùng (ai dùng, hóa đơn nào, giảm bao nhiêu, thu ngân nào); phát cho một nhóm khách (theo hạng, theo "không ghé > N ngày").
3. Khách hàng > "Danh sách khách": tìm kiếm, chi tiết (điểm, hạng, lịch sử đơn, voucher, trạng thái đồng ý), điều chỉnh điểm (lý do bắt buộc), xử lý yêu cầu xóa dữ liệu.
4. Báo cáo > "Ưu đãi" và "Thành viên".

### 3.4 Super Admin
Bật module `loyalty` cho quán (trang "Quán trên nền tảng", `Stores.tsx:280`). Không thấy dữ liệu cá nhân khách của quán nếu không cần hỗ trợ (đặc tả không cấp thêm quyền xem hàng loạt).

---

## 4. Thay đổi mô hình dữ liệu (Prisma đề xuất)

Nguyên tắc migration: chỉ thêm; không xóa/đổi tên cột hiện có; viết SQL tay theo mẫu `20261112150000_order_seq_and_client_request_id`; chạy `prisma migrate deploy`.

```prisma
enum ConsentPurpose { LOYALTY TRANSACTIONAL MARKETING_ZNS PROFILE_BIRTHDAY }
enum PointEntryType { EARN REDEEM EXPIRE ADJUST REVERT }
enum VoucherType { PERCENT AMOUNT FREE_ITEM }
enum VoucherStatus { DRAFT ACTIVE PAUSED ENDED }
enum VoucherAudience { ALL MEMBERS TIER BIRTHDAY RETURNING WELCOME MANUAL }
enum VoucherIssueStatus { AVAILABLE RESERVED REDEEMED EXPIRED REVOKED }
enum RedemptionStatus { RESERVED CONSUMED RELEASED }

// Customer: thêm cột (tất cả nullable hoặc có default)
//   zaloVerifiedAt  DateTime?     // thời điểm máy chủ xác minh zaloUserId
//   phoneVerifiedAt DateTime?
//   birthMonth Int?  birthDay Int?  // chỉ ngày/tháng, không lưu năm sinh
//   pointsBalance Int @default(0)   // bản sao số dư, luôn khớp tổng PointLedger
//   tierId String? @db.Uuid
//   anonymizedAt DateTime?
//   source String @default("ORDER") // ORDER | ZALO_LOGIN | POS
//   @@unique([storeId, zaloUserId])  // NULL được lặp lại trong PostgreSQL; kiểm trùng trước khi tạo chỉ mục
// Order: thêm requestedVoucherCode String? (mã khách khai báo trong giỏ, không phải đã áp dụng)
// Bill (Đặc tả 02): customerId đã có; BillDiscount.voucherRedemptionId / pointsUsed đã có

model ConsentRecord {                 // append-only
  id          String   @id @default(uuid(7)) @db.Uuid
  storeId     String   @db.Uuid
  customerId  String   @db.Uuid
  purpose     ConsentPurpose
  granted     Boolean                     // true = đồng ý, false = rút lại
  textVersion String                      // phiên bản văn bản hiển thị khi đồng ý
  channel     String   @default("MINIAPP")
  evidence    Json?                       // ví dụ: {"screen":"consent_v1"}; không lưu địa chỉ IP nếu không cần
  createdAt   DateTime @default(now())
  @@index([storeId, customerId, purpose, createdAt])
  @@map("consent_records")
}

model LoyaltyProgram {                // 1 dòng / quán
  id                 String  @id @default(uuid(7)) @db.Uuid
  storeId            String  @unique @db.Uuid
  enabled            Boolean @default(false)
  earnAmountPerPoint Int     // số tiền (đồng) để được 1 điểm; PO/quán đặt, không có mặc định cứng
  minBillToEarn      Int     @default(0)
  maxPointsPerBill   Int?
  pointValueVnd      Int     // 1 điểm tương đương bao nhiêu đồng khi dùng điểm
  minRedeemPoints    Int     @default(0)
  maxRedeemPercent   Int     @default(50) // tối đa % hóa đơn được trả bằng điểm
  claimWindowDays    Int     @default(7)  // thời hạn khách nhận điểm sau khi thanh toán nếu chưa đăng nhập
  pointsExpiryMonths Int?                  // null = không hết hạn (v1)
  updatedAt          DateTime @updatedAt
  updatedByUserId    String? @db.Uuid
  @@map("loyalty_programs")
}

model LoyaltyTier {
  id               String  @id @default(uuid(7)) @db.Uuid
  storeId          String  @db.Uuid
  name             String
  minSpend         Decimal @db.Decimal(14, 2)  // so với Customer.totalSpent
  earnMultiplierPct Int    @default(100)
  sortOrder        Int     @default(0)
  @@unique([storeId, name])
  @@index([storeId, minSpend])
  @@map("loyalty_tiers")
}

model PointLedger {                   // append-only; không UPDATE/DELETE
  id            String   @id @default(uuid(7)) @db.Uuid
  storeId       String   @db.Uuid
  customerId    String   @db.Uuid
  type          PointEntryType
  points        Int                       // dương = cộng, âm = trừ
  balanceAfter  Int
  billId        String?  @db.Uuid
  orderId       String?  @db.Uuid
  dedupeKey     String   @unique          // ví dụ earn:{billId}, redeem:{billId}, revert:{paymentId}, claim:{orderId}
  reason        String?
  createdByUserId String? @db.Uuid
  createdAt     DateTime @default(now())
  @@index([storeId, customerId, createdAt])
  @@map("point_ledger")
}

model Voucher {
  id                 String   @id @default(uuid(7)) @db.Uuid
  storeId            String   @db.Uuid
  name               String                    // tên nội bộ
  tagline            String?                   // nhãn nhỏ (eyebrow): "Hẹn lần ghé sau"
  headline           String                    // tiêu đề: "Thêm một bữa ngon"
  subtitle           String?                   // "Giảm 10% cho lần ghé sau"
  code               String?                   // mã công khai dùng chung (ví dụ HENGAPLAI); null = chỉ phát mã riêng
  type               VoucherType
  value              Decimal  @db.Decimal(14, 2)   // % hoặc số tiền; FREE_ITEM thì bỏ qua
  maxDiscount        Decimal? @db.Decimal(14, 2)
  minSubtotal        Decimal  @default(0) @db.Decimal(14, 2)
  freeMenuItemId     String?  @db.Uuid
  startsAt           DateTime
  endsAt             DateTime?
  validDaysAfterIssue Int?                         // hạn kể từ lúc phát (cho mã riêng)
  totalLimit         Int?
  perCustomerLimit   Int?     @default(1)
  usedCount          Int      @default(0)          // số lượt RESERVED + CONSUMED
  stackable          Boolean  @default(false)
  audience           VoucherAudience @default(ALL)
  audienceTierId     String?  @db.Uuid
  triggerConfig      Json?                         // ví dụ {"daysSinceLastVisit":30,"validDays":14}
  listed             Boolean  @default(true)       // hiện trong danh sách công khai
  requiresMember     Boolean  @default(false)
  pointCost          Int?                          // có giá trị = đổi được bằng điểm
  cashierCanApply    Boolean  @default(true)
  extraTerms         Json     @default("[]")       // điều kiện bổ sung hiển thị (mảng chuỗi)
  status             VoucherStatus @default(DRAFT)
  createdByUserId    String?  @db.Uuid
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  @@unique([storeId, code])
  @@index([storeId, status, endsAt])
  @@map("vouchers")
}

model VoucherIssue {                  // mã riêng của từng khách
  id          String   @id @default(uuid(7)) @db.Uuid
  storeId     String   @db.Uuid
  voucherId   String   @db.Uuid
  customerId  String   @db.Uuid
  code        String                       // 8 ký tự Crockford base32 ngẫu nhiên
  status      VoucherIssueStatus @default(AVAILABLE)
  source      String                       // MANUAL | BIRTHDAY | RETURNING | WELCOME | CAMPAIGN | POINTS
  dedupeKey   String?                      // ví dụ birthday:{customerId}:{year}, returning:{voucherId}:{customerId}:{yyyymm}
  issuedAt    DateTime @default(now())
  expiresAt   DateTime?
  redeemedAt  DateTime?
  @@unique([storeId, code])
  @@unique([voucherId, dedupeKey])
  @@index([storeId, customerId, status])
  @@map("voucher_issues")
}

model VoucherRedemption {             // mỗi lần áp dụng lên một hóa đơn
  id          String   @id @default(uuid(7)) @db.Uuid
  storeId     String   @db.Uuid
  voucherId   String   @db.Uuid
  issueId     String?  @db.Uuid
  customerId  String?  @db.Uuid
  billId      String   @db.Uuid
  amount      Decimal  @db.Decimal(14, 2)
  status      RedemptionStatus @default(RESERVED)
  appliedByUserId String? @db.Uuid
  overrideReason  String?
  approvedByUserId String? @db.Uuid
  createdAt   DateTime @default(now())
  consumedAt  DateTime?
  releasedAt  DateTime?
  @@unique([voucherId, billId])             // một voucher chỉ áp dụng một lần trên một hóa đơn
  @@index([storeId, voucherId, status])
  @@index([storeId, customerId])
  @@map("voucher_redemptions")
}
```
Quy ước: điều kiện hiển thị "Điều kiện áp dụng" (Mục 6.2) được SINH từ các trường (`minSubtotal`, `maxDiscount`, `endsAt`/`validDaysAfterIssue`, `stackable`) cộng `extraTerms`; không nhập tay lặp lại để tránh lệch với logic thật.

Backfill và an toàn:
- Chỉ mục duy nhất `(storeId, zaloUserId)`: trước khi tạo, chạy truy vấn kiểm trùng; nếu có trùng thì gộp hoặc đặt `zaloUserId = NULL` cho bản ghi cũ hơn (ghi vào tệp báo cáo migration). Hiện mã chưa hề ghi `zaloUserId` vào `Customer`, nên khả năng trùng gần như bằng 0 (cần kiểm tra trên dữ liệu thật).
- `Customer.pointsBalance = 0`, `tierId = NULL` cho mọi khách hiện có. Khách cũ có SĐT (nhập tay, chưa xác thực) KHÔNG tự thành thành viên: họ phải đăng nhập Zalo và đồng ý.
- Bản ghi consent cũ (`marketingConsent`, `consentDate` trong `Customer`): không tin được vì được ghi từ dữ liệu client chưa xác thực (`orders.service.ts:403-428`). Migration KHÔNG chuyển thành `ConsentRecord`. Cột cũ được đặt lại `marketingConsent = false` cho khách chưa xác minh (PO duyệt, Q7) vì không có bằng chứng đồng ý hợp lệ; giữ bản sao dữ liệu cũ vào bảng lưu trữ (tên, ví dụ, `customers_legacy_consent_backup`) 90 ngày rồi xóa.
- `totalSpent` hiện sai khi hoàn tiền (không bị trừ); sửa ở Mục 5.6 (hoàn tiền) và chạy một lần tính lại `totalSpent`/`totalOrders` từ `payments`/`orders` cho khách có `customerId`.
- Module `loyalty` được thêm vào `MODULE_DEFS` (`apps/api/src/common/modules.ts:5`); quán chưa bật module thì mọi endpoint mới trả 403 "Quán chưa bật chương trình thành viên", các cột mới không ảnh hưởng hành vi cũ.

Biến môi trường mới: `ZALO_APP_ID`, `ZALO_APP_SECRET` (nếu cần cho bước xác minh, GĐ-01), `MEMBER_JWT_SECRET` (hoặc dùng cùng khóa JWT nhưng khác `audience`, đề xuất tách).

---

## 5. API

Tiền tố `/api/v1`. Lỗi `message` tiếng Việt có dấu. Mọi endpoint công khai chịu giới hạn tần suất (`apps/api/src/common/utils/rate-limiter.ts`, mẫu sẵn ở `public-order-throttle.guard.ts`).

### 5.1 Định danh thành viên và xác minh Zalo
`POST /public/stores/:slug/members/login`
- Body: `{ accessToken: string, idToken?: string, phoneToken?: string, zaloUserId?: string }`.
- Máy chủ KHÔNG tin `zaloUserId` do client gửi. Máy chủ dùng `accessToken` để gọi API của Zalo lấy mã người dùng thật rồi so khớp. GĐ-01: endpoint cụ thể, tiêu đề, quyền cần xin (user id, tên, số điện thoại), cách đổi `phoneToken` lấy số điện thoại (thường cần khóa bí mật của ứng dụng), giới hạn tốc độ, và việc có thể xác minh `idToken` bằng khóa công khai hay không đều phải được developer xác minh trong tài liệu chính thức của Zalo Mini App trước khi code; mã hiện tại cũng ghi rõ chưa xác minh được điều này (`apps/miniapp/src/zalo.ts:10-18`).
- Phương án nếu không xác minh được phía máy chủ: `zaloUserId` chỉ là mức tin cậy thấp (`zaloVerifiedAt = null`): được xem ưu đãi công khai, nhưng KHÔNG được nhận điểm, đổi điểm, nhận mã riêng (đây là đường bảo vệ chống gian lận). Khi đó cần OTP (GĐ-02, tốn phí) hoặc thu ngân xác nhận sở hữu số điện thoại tại quầy.
- Trả `{ memberToken, expiresAt, member:{ id, displayName, pointsBalance, tier:{name}|null, consents:{LOYALTY,MARKETING_ZNS,...}, needsConsent: boolean } }`.
- `memberToken` ký bằng khóa riêng, `aud = 'member'`, gắn `storeId` và `customerId`, thời hạn đề xuất 30 ngày (PO chốt); chỉ dùng cho quán đó (token quán A vô hiệu với quán B).
- Lỗi: 401 "Không xác minh được tài khoản Zalo, vui lòng thử lại"; 403 "Quán chưa bật chương trình thành viên"; 429 giới hạn tần suất.

Mở rộng `POST /public/stores/:slug/orders` (`public.controller.ts:100`): header `X-Member-Token` tùy chọn; hợp lệ thì `Order.customerId = member`. Trường `customer` tự khai hiện có (`order.dto.ts:54`) được xử lý lại: số điện thoại khai không xác thực chỉ lưu làm thông tin liên hệ của đơn, KHÔNG tạo thành viên, KHÔNG đặt consent; `marketingConsent`/`transactionalConsent` do client gửi bị bỏ qua. Thêm `voucherCode?: string` (yêu cầu dùng ưu đãi): máy chủ chạy kiểm tra "mềm", lưu `Order.requestedVoucherCode` và trả kết quả dự kiến `{valid, estimatedDiscount, reason?}`; không đổi giá đơn.

### 5.2 API công khai cho thành viên (header `X-Member-Token`)
| Endpoint | Mô tả |
|---|---|
| `GET /public/stores/:slug/vouchers` | Danh sách ưu đãi hiển thị: `{items:[{id, badge, tagline, headline, summary, validUntil, state:'AVAILABLE'|'LOCKED'|'USED'|'EXPIRED', lockedReason?, isPersonal}]}`. Gồm voucher `listed` công khai đang `ACTIVE` trong thời hạn, cộng mã riêng của thành viên. `badge` sinh từ dữ liệu ("10%", "50K", "TẶNG"). Không trả mã của voucher công khai chỉ dành cho thành viên khi chưa đăng nhập |
| `GET /public/stores/:slug/vouchers/:id` | Chi tiết: `{id, badge, tagline, headline, subtitle, code|null, terms:[string], validUntil, state}`; `code` chỉ trả nếu được phép xem; `terms` sinh theo Mục 4 |
| `POST /public/stores/:slug/vouchers/check` | Body `{code, subtotal}` tính trước cho giỏ. Giới hạn chặt (ví dụ 10 lần/phút/IP+quán) để chống dò mã; thông báo lỗi chung "Mã không hợp lệ hoặc đã hết hạn" không tiết lộ mã có tồn tại hay không |
| `GET /public/stores/:slug/members/me` | Hồ sơ thành viên: điểm, hạng kế tiếp và số tiền còn thiếu để lên hạng, trạng thái đồng ý |
| `PUT /public/stores/:slug/members/me/consents` | Body `{purpose, granted, textVersion}`; ghi `ConsentRecord` mới (không sửa bản ghi cũ) và cập nhật cờ tiện lợi trên `Customer`. Rút lại `MARKETING_ZNS` có hiệu lực ngay (chặn gửi tin) |
| `PUT /public/stores/:slug/members/me/profile` | `{birthMonth?, birthDay?}`; cần consent `PROFILE_BIRTHDAY` |
| `GET /public/stores/:slug/members/me/points?cursor=` | Lịch sử sổ điểm |
| `POST /public/stores/:slug/members/me/redeem` | Body `{voucherId}`: đổi điểm lấy voucher (`pointCost`). Trong một transaction: khóa khách, kiểm số dư, ghi `PointLedger` (REDEEM, `dedupeKey = redeem:{customerId}:{voucherId}:{idempotencyKey}`), tạo `VoucherIssue` nguồn `POINTS`. Lỗi: 409 "Bạn chưa đủ điểm để đổi ưu đãi này" |
| `POST /public/orders/:id/claim-points` | Thành viên nhận điểm cho đơn `COMPLETED` chưa gắn thành viên, trong `claimWindowDays`; một đơn chỉ nhận một lần (`dedupeKey = claim:{orderId}`); giới hạn số lần nhận mỗi khách mỗi ngày (chống đi nhặt link đơn); điểm tính theo cùng công thức Mục 5.5. Lỗi: 409 "Đơn này đã được nhận điểm", 410 "Đã quá thời hạn nhận điểm" |
| `GET /public/stores/:slug/members/me/export` | Xuất dữ liệu của chính thành viên (hồ sơ, đồng ý, điểm, voucher, danh sách đơn) dạng JSON |
| `DELETE /public/stores/:slug/members/me` | Xóa/ẩn danh (Mục 7.4) |

### 5.3 API nhân viên (JWT)
| Endpoint | Vai trò | Mô tả |
|---|---|---|
| `GET/PUT /stores/:storeId/loyalty/program` | Đọc: OWNER, MANAGER; Ghi: OWNER | Cấu hình điểm; mọi thay đổi audit (`loyalty_config`) kèm trước/sau |
| `GET/POST/PATCH/DELETE /stores/:storeId/loyalty/tiers` | OWNER | Hạng |
| `GET /stores/:storeId/customers?q=&tier=&page=` | OWNER, MANAGER | Danh sách; ẩn số điện thoại một phần cho MANAGER nếu PO muốn (Q8) |
| `GET /stores/:storeId/customers/lookup?phone=|code=` | CASHIER+ | Trả tối thiểu: tên che bớt, hạng, điểm, ưu đãi khả dụng; ghi audit mỗi lần tra (chống tra cứu dữ liệu hàng loạt); giới hạn tần suất |
| `GET /stores/:storeId/customers/:id` | OWNER, MANAGER | Chi tiết, sổ điểm, voucher, đồng ý |
| `POST /stores/:storeId/customers/:id/points/adjust` | OWNER, MANAGER (MANAGER chỉ tới hạn mức cấu hình) | `{points, reason}` lý do bắt buộc; ghi sổ loại `ADJUST` |
| `POST /stores/:storeId/customers/:id/anonymize` | OWNER | Xử lý yêu cầu xóa của khách (Mục 7.4) |
| `GET/POST /stores/:storeId/vouchers` | Đọc: OWNER, MANAGER, CASHIER (chỉ voucher `cashierCanApply`); Tạo: OWNER, MANAGER | Tạo, liệt kê |
| `PATCH /stores/:storeId/vouchers/:id` | OWNER, MANAGER | Chỉ sửa tên/mô tả/hạn/giới hạn khi voucher đã có lượt dùng; không được đổi `type`, `value`, `minSubtotal` sau khi có lượt dùng (tạo bản mới) |
| `POST /stores/:storeId/vouchers/:id/(activate|pause|resume|end)` | OWNER, MANAGER | Đổi trạng thái |
| `POST /stores/:storeId/vouchers/:id/issue` | OWNER, MANAGER | Phát cho `{customerIds[]}` hoặc `{segment:{tierId?, notVisitedDays?}}`; có chế độ xem trước số lượng; dedupe theo (voucher, khách) |
| `GET /stores/:storeId/vouchers/:id/redemptions` | OWNER, MANAGER | Lượt dùng (khách che bớt, hóa đơn, số tiền giảm, thu ngân, ngoại lệ) |
| `GET /stores/:storeId/reports/vouchers`, `GET /stores/:storeId/reports/loyalty` | OWNER, MANAGER | Báo cáo (Mục 6.1) |
| `POST /stores/:storeId/pos/bills/:billId/customer` | CASHIER+ | Gắn khách `{customerId}` |
| `POST /stores/:storeId/pos/bills/:billId/vouchers` | CASHIER+ | Áp dụng `{code | issueId, override?:{reason, approver:{userId,password}}}`; tạo `BillDiscount(kind=VOUCHER)` và `VoucherRedemption(RESERVED)`; trả hóa đơn đã tính lại và khoản giảm |
| `DELETE /stores/:storeId/pos/bills/:billId/vouchers/:redemptionId` | CASHIER+ (khi chưa có thanh toán) | Gỡ, `RELEASED`, giảm `usedCount` |
| `POST /stores/:storeId/pos/bills/:billId/points` | CASHIER+ | Dùng điểm `{points}`; tạo `BillDiscount(kind=POINTS)`; chưa trừ điểm cho đến khi đóng hóa đơn |

Lỗi áp dụng voucher (tiếng Việt, hiển thị nguyên văn trên POS): "Ưu đãi chưa đạt đơn tối thiểu 300.000đ (còn thiếu 20.000đ)", "Ưu đãi đã hết hạn ngày 30/11/2026", "Ưu đãi chưa bắt đầu", "Mã ưu đãi đã được sử dụng", "Ưu đãi đã hết lượt", "Khách này đã dùng ưu đãi này", "Ưu đãi này chỉ dành cho thành viên, vui lòng gắn khách vào hóa đơn", "Ưu đãi không áp dụng cùng ưu đãi khác", "Ưu đãi không áp dụng tại quán này", "Chưa có món {tên} trong hóa đơn để tặng".

### 5.4 Quy tắc áp dụng voucher (hàm `VoucherService.validate`, dùng chung cho kiểm mềm và áp dụng thật)
Thứ tự kiểm tra, trong một transaction khi áp dụng thật, khóa dòng `vouchers` và hóa đơn:
1. Voucher thuộc `bill.storeId` (không bao giờ dùng chéo quán); `status = ACTIVE`; `startsAt <= now <= endsAt`.
2. Nếu là mã riêng: `VoucherIssue` thuộc đúng khách của hóa đơn, `AVAILABLE`, chưa hết hạn. Nếu là mã công khai: so mã chuẩn hóa (in hoa, bỏ khoảng trắng).
3. Đối tượng: `requiresMember` hoặc `perCustomerLimit` có giá trị thì hóa đơn phải có khách xác minh; `audience = TIER` thì hạng khách >= hạng yêu cầu.
4. Giới hạn: tăng `usedCount` bằng `updateMany ... where usedCount < totalLimit` (nguyên tử); `perCustomerLimit`: đếm `VoucherRedemption` `RESERVED/CONSUMED` của khách. Hết lượt: lỗi.
5. Không cộng dồn: nếu `stackable = false` và hóa đơn đã có ưu đãi voucher khác thì từ chối. Một hóa đơn tối đa một voucher ở v1 (cộng với điểm và giảm tay có hạn mức).
6. Tối thiểu: `minSubtotal` so với tạm tính của hóa đơn (tạm tính, trước giảm giá, theo các món chưa hủy).
7. Tính giảm: `PERCENT`: `round(subtotal * value / 100)` bị chặn bởi `maxDiscount`; `AMOUNT`: `min(value, subtotal)`; `FREE_ITEM`: nếu hóa đơn có món `freeMenuItemId` (món chưa hủy) thì giảm bằng giá một phần của món đó, nếu không thì lỗi gợi ý thêm món. Luôn: tổng mọi khoản giảm không vượt tạm tính (cùng quy tắc ở `orders.service.ts:1020-1024`).
8. Thứ tự tính tiền: tạm tính -> giảm voucher -> giảm điểm -> giảm tay (nếu còn hạn mức) -> VAT trên (tạm tính - tổng giảm) -> làm tròn theo cấu hình quán (`calcTotals`, `orders.service.ts:84-91`).
9. Ngoại lệ (`override`): chỉ khi `approver` là MANAGER/OWNER của đúng quán, xác thực mật khẩu; bỏ qua được điều kiện "tối thiểu" và "hết hạn dưới 24 giờ"; KHÔNG bỏ qua được: chéo quán, đã dùng, hết lượt, trạng thái `ENDED`. Ghi audit.
Khi hóa đơn thay đổi (thêm/hủy món) sau khi áp dụng: hệ thống tính lại; nếu không còn đạt điều kiện (ví dụ tạm tính tụt dưới tối thiểu) thì khoản giảm bị gỡ và thu ngân được báo.

### 5.5 Tích điểm
Thời điểm: khi hóa đơn chuyển `PAID` (trong cùng đường `BillService.applyPayment` của Đặc tả 02, bước đóng hóa đơn).
- Điều kiện: hóa đơn có `customerId` thuộc thành viên đã xác minh và có consent `LOYALTY` đang hiệu lực; chương trình `enabled`.
- Tính: `base = tổng tiền khách thực trả (Bill.totalAmount, đã trừ giảm giá, gồm VAT)`; `points = floor(base / earnAmountPerPoint) * earnMultiplierPct / 100` làm tròn xuống; áp `minBillToEarn`, `maxPointsPerBill`. Tiền trả bằng điểm không sinh điểm (vì đã là giảm giá).
- Ghi: dòng `PointLedger(EARN, dedupeKey = earn:{billId})`, cập nhật `Customer.pointsBalance`, `totalSpent`, `totalOrders` (sửa lỗi hiện tại), `lastVisitAt`, và hạng (`tierId` theo `totalSpent`); toàn bộ trong transaction với việc đóng hóa đơn để số dư không lệch. Nếu logic tích điểm lỗi thì không được làm hỏng thanh toán: chạy sau khi hóa đơn đã đóng bằng cơ chế thử lại idempotent (`dedupeKey` chặn cộng đôi) và tác vụ bù mỗi 10 phút cho hóa đơn `PAID` chưa có dòng `EARN`.
- Nhận điểm trễ (`claim-points`): cùng công thức, cùng `dedupeKey` phía hóa đơn nên một hóa đơn chỉ sinh điểm một lần dù qua đường nào.
- Hoàn tiền (Đặc tả 01/02): sinh `REVERT` bằng số điểm đã cộng cho hóa đơn đó; trừ `totalSpent`; hoàn lại điểm đã dùng nếu hóa đơn hoàn toàn (quyết định voucher có được hoàn lượt không: mặc định không hoàn lượt dùng voucher trừ khi Manager chọn "khôi phục ưu đãi", ghi lý do, Q9); số dư có thể âm và hiển thị cho quản lý, không chặn hoàn tiền.
- Đổi điểm: hai kiểu: (1) đổi lấy voucher (`redeem`), (2) trừ trực tiếp vào hóa đơn ở POS. Cả hai đều ghi sổ `REDEEM` (âm điểm); kiểu (2) chỉ chốt khi hóa đơn đóng; nếu hóa đơn bị gỡ/hủy thì không trừ.
- Công thức ví dụ minh họa (không phải đề xuất giá trị): nếu `earnAmountPerPoint = 10.000` thì hóa đơn 245.000đ được 24 điểm.

### 5.6 Sửa lỗi dữ liệu khách liên quan
Trong đường đóng hóa đơn (Đặc tả 02): tăng `totalOrders` (hiện không tăng, `orders.service.ts:1082-1090`); sửa `refund` để trừ `totalSpent` (hiện không trừ, `orders.service.ts:1149-1212`); không ghi đè `consentDate` khi không có thay đổi consent (hiện ghi đè mỗi đơn, `orders.service.ts:411`).

### 5.7 Tác vụ nền (cần `@nestjs/schedule` hoặc cơ chế tương đương)
- 00:05 hằng ngày (giờ VN): phát voucher sinh nhật cho thành viên có `birthMonth/birthDay` trùng hôm nay, có consent `PROFILE_BIRTHDAY` và `LOYALTY`, quán có chiến dịch `BIRTHDAY` đang `ACTIVE` (dedupe `birthday:{customerId}:{year}`).
- 00:20 hằng ngày: chiến dịch `RETURNING`: thành viên có `lastVisitAt` cách đây đúng N ngày (từ `triggerConfig`) chưa nhận trong chu kỳ (dedupe theo tháng); chiến dịch `WELCOME`: phát sau hóa đơn đầu tiên.
- Mỗi giờ: chuyển `VoucherIssue` quá hạn sang `EXPIRED`; `Voucher` quá `endsAt` sang `ENDED`; giải phóng `VoucherRedemption RESERVED` của hóa đơn đã `VOID` hoặc treo quá 12 giờ.
- Mỗi 10 phút: tích điểm bù cho hóa đơn `PAID` chưa có sổ `EARN`.
- Hằng đêm: đối soát sổ điểm (tổng `PointLedger` = `pointsBalance`), `usedCount` khớp số `RESERVED/CONSUMED`, mỗi voucher "một lần/khách" không có hơn một `CONSUMED`; ghi cảnh báo nếu lệch.
Các tác vụ phải chạy được an toàn khi có nhiều instance API (khóa tư vấn Postgres) hoặc ghi rõ chỉ chạy một instance.

### 5.8 Realtime
POS nhận sự kiện khi khách khai báo voucher trong giỏ (chip "Khách muốn dùng ...") thông qua `order.created` kèm `requestedVoucherCode` (mở rộng `OrderEventPayload`, `apps/api/src/realtime/events.service.ts:6-19`; hiện chỉ có các trường đơn cơ bản). Không cần realtime cho khách (poll như hiện nay).

### 5.9 ZNS (giai đoạn 2, tùy chọn) và nguyên tắc kiểm soát chi phí
Chỉ ghi nguyên tắc; không có giá nào trong tài liệu này và không triển khai ở giai đoạn 1.
- Điều kiện kỹ thuật phải xác minh với tài liệu Zalo (GĐ-03): kết nối Official Account của quán, mẫu tin nhắn phải được Zalo duyệt trước, cách tính phí, hạn mức, quy định về nội dung quảng cáo/giao dịch. Mỗi quán có thể phải dùng OA riêng.
- Kênh mặc định để phát ưu đãi vẫn là "trong ứng dụng" (miễn phí): khách mở mini app là thấy voucher.
- Nếu bật ZNS: (1) chỉ gửi cho khách có consent `MARKETING_ZNS` hiệu lực; tin giao dịch (ví dụ xác nhận điểm) cần consent `TRANSACTIONAL`; (2) hạn mức ngân sách theo tháng do chủ quán đặt, hệ thống dừng cứng khi chạm trần; đơn giá do chủ quán nhập (hệ thống không tự điền giá) để ước tính trước khi gửi; (3) bản xem trước "sẽ gửi cho N khách, ước tính chi phí X" bắt buộc xác nhận; (4) giới hạn tần suất mỗi khách (ví dụ tối đa 1 tin tiếp thị/khách/N ngày); (5) khung giờ yên tĩnh; (6) nhật ký từng tin (khách, mẫu, thời điểm, kết quả, chi phí ghi nhận nếu có); (7) rút lại consent chặn ngay; (8) chạy thử trên danh sách nhỏ trước; (9) chỉ chạy cho chiến dịch có `ACTIVE` và do OWNER/MANAGER duyệt.
- Mô hình dữ liệu dự kiến (không làm ở giai đoạn 1): `ZnsCampaign`, `ZnsMessage`, `Store.settings.zns {enabled, monthlyBudgetVnd, unitCostVnd}`.

---

## 6. Thay đổi giao diện

### 6.1 Admin (`apps/admin`)
- Menu mới nhóm "KHÁCH HÀNG" (thêm vào mảng `NAV` ở `apps/admin/src/components/Layout.tsx:22-34`, vai trò MGMT) với các trang mới, route thêm ở `apps/admin/src/App.tsx:56-130`:
  - `pages/Loyalty.tsx`: cấu hình chương trình điểm, hạng.
  - `pages/Vouchers.tsx`: danh sách/tạo/sửa, xem trước thẻ ưu đãi đúng như mini app (dùng cùng bộ quy tắc sinh "Điều kiện áp dụng"), nút tạm dừng/kết thúc, tab "Lượt dùng", nút "Phát cho khách".
  - `pages/Customers.tsx`: danh sách, chi tiết, điều chỉnh điểm, trạng thái đồng ý, xử lý yêu cầu xóa.
  - `pages/Reports.tsx` (hiện có): thêm tab "Ưu đãi" (số phát, số dùng, tỷ lệ dùng, tổng tiền giảm, doanh thu các hóa đơn có voucher, theo chiến dịch/thu ngân) và "Thành viên" (số thành viên, thành viên hoạt động 30 ngày, tỷ lệ quay lại, điểm đã phát/đã dùng/còn lại và giá trị quy đổi còn nợ ở mức `pointValueVnd`, phân bố hạng). Ghi chú trên báo cáo: so sánh không phải quan hệ nhân quả.
- `apps/admin/src/pages/Pos.tsx` (trong `CheckoutModal` của Đặc tả 02; hiện `PayModal` ở dòng 34-137 chỉ có ô giảm giá tiền): khối "Khách hàng & ưu đãi": ô tìm khách, thẻ khách, chip ưu đãi khách yêu cầu, ô nhập/chọn mã, dòng giảm đã áp dụng (có nút gỡ), ô dùng điểm, nút "Áp dụng ngoại lệ (cần quản lý)". Dòng "Giảm giá thủ công" giữ nhưng có hạn mức theo vai trò (Đặc tả 02).
- `apps/admin/src/pages/Stores.tsx` (dòng ~280): thêm module `loyalty` vào danh sách bật/tắt (tự động qua `MODULE_DEFS`).
- `apps/admin/src/labels.ts`: nhãn loại voucher, trạng thái, loại bút toán điểm.
- Bill in (Đặc tả 02 Phần A): in dòng "Ưu đãi HENGAPLAI: -30.000đ", "Điểm thưởng: +24 (còn 130)" nếu có.

### 6.2 Mini app (`apps/miniapp`) - khớp thiết kế v2 màn 12-13
- `pages/Voucher.tsx` (hiện là trạng thái rỗng): thay khối rỗng bằng danh sách thẻ theo đúng thiết kế:
  - Tiêu đề trang "Ưu đãi của quán" (`PageTitle`, giữ nguyên).
  - Mỗi thẻ `<Link className="card offer">`: `<div className="offer-code">{badge}</div>`, `<span className="eyebrow">{tagline}</span>`, `<h2>{headline}</h2>`, `<p className="tiny muted mb0">{summary}</p>` và biểu tượng mũi tên `next`. `summary` = "Giảm 10% cho đơn từ 300.000đ." + "Xem đầy đủ điều kiện áp dụng." Thẻ ở trạng thái `USED/EXPIRED/LOCKED` làm mờ và ghi rõ lý do ("Đã dùng", "Hết hạn", "Dành cho thành viên hạng Bạc").
  - Dòng chú thích dưới cùng đúng nguyên văn thiết kế: "Ưu đãi chỉ áp dụng khi được quán xác nhận. Không tự động trừ vào giỏ món." (không còn hộp "dữ liệu minh họa").
  - Khi danh sách rỗng giữ trạng thái rỗng hiện có (`EmptyBody` icon `gift`, "Ưu đãi đang được chuẩn bị").
  - Nếu có ưu đãi chỉ dành thành viên mà khách chưa đăng nhập: thẻ gợi ý "Đăng nhập Zalo để xem ưu đãi dành riêng cho bạn" liên kết tới Cá nhân.
- Màn mới `pages/VoucherDetail.tsx`, route `/s/:storeSlug/voucher/:voucherId` thêm ở `apps/miniapp/src/components/layout.tsx:40`:
  - `PageTitle` "Chi tiết ưu đãi" quay về danh sách.
  - Thẻ `card status-card`: `big-status red` (biểu tượng `gift`), `eyebrow` = `tagline` (bỏ chữ "minh họa"), `h1` = `headline` (xuống dòng tự nhiên, có thể ngắt ý "Thêm một / bữa ngon."), `p.muted` = `subtitle`, ô `.coupon` = mã.
  - Thẻ "Điều kiện áp dụng": `<h3>` + `<ul>` các điều kiện sinh từ dữ liệu: (a) "Đơn từ {minSubtotal}; giảm tối đa {maxDiscount}." (b) "Áp dụng đến {ngày}." (c) "Không áp dụng đồng thời với ưu đãi khác." nếu không cộng dồn (d) dòng cố định "Nhờ nhân viên kiểm tra trước khi thanh toán." (e) các dòng `extraTerms`.
  - Nút "Sao chép mã ưu đãi": `navigator.clipboard.writeText` thành công thì toast "Đã sao chép mã {mã}"; thất bại thì hộp thoại "Mã ưu đãi: {mã} - Bạn có thể chọn và sao chép mã này." (đúng như `copyOffer` của thiết kế); thêm nút phụ "Dùng ưu đãi này" nếu đang có giỏ (đặt `requestedVoucherCode` vào giỏ). GĐ-04: kiểm tra tài liệu `zmp-sdk` có API sao chép chuẩn để thay `navigator.clipboard` trong WebView Zalo.
  - Mã riêng chỉ hiện đầy đủ khi đã đăng nhập; mã công khai hiện luôn.
- `pages/Cart.tsx` (dòng 258-269, dưới thẻ "Ghi chú cho quán"): thẻ "Ưu đãi" (hàng bấm mở bottom sheet dùng `.bottom-sheet` hiện có): danh sách ưu đãi của khách + ô nhập mã; sau khi chọn hiện chip `note-chip` "HENGAPLAI - Giảm dự kiến 30.000đ - Quán sẽ xác nhận khi thanh toán". Dock tổng (dòng 134-141) giữ "Tổng cộng" là giá chưa giảm và thêm dòng nhỏ "Chưa gồm ưu đãi". `clientRequestId` signature (dòng 101-104) cần bao gồm `voucherCode` để không tái sử dụng khóa khi đổi mã.
- `pages/Profile.tsx` (dòng 22-37 và khối thẻ Zalo): đổi hàm đăng nhập: gọi `zaloLogin()` rồi `POST members/login`, lưu `memberToken` vào `session.ts` (thêm trường `memberToken`, `memberExpiresAt`); hiển thị thẻ thành viên (tên, hạng, điểm) và các dòng "Điểm thành viên", "Ưu đãi của bạn", "Quyền riêng tư"; "Xóa dữ liệu trên thiết bị" (dòng 41-57) đổi câu chữ: "Chỉ xóa dữ liệu lưu trên thiết bị này. Để xóa tài khoản thành viên trên hệ thống, vào Quyền riêng tư."
- Màn mới (cần designer bổ sung, ngoài 16 màn của bộ thiết kế): `pages/Member.tsx` (điểm, hạng, lịch sử, đổi điểm), `pages/Privacy.tsx` (đồng ý, xuất, xóa), sheet "Đồng ý tham gia" lần đầu. Trong lúc chờ thiết kế dùng các lớp CSS hiện có (`card`, `info-list`, `chips`, `switch-tabs`).
- `pages/Tracking.tsx` (màn hoàn tất, dòng 113-180): khối "+{n} điểm" cho thành viên; hoặc lời mời đăng nhập để nhận điểm (thời hạn); cần `GET /public/orders/:id` trả `loyalty: {eligible, pointsEarned?, claimableUntil?, requiresLogin}` (mở rộng `getPublicOne`, `orders.service.ts:552-581`).
- `pages/Home.tsx`: thẻ `benefit` "Hẹn bạn một lần ghé sau" (có ở thiết kế màn 1) liên kết tới danh sách ưu đãi nếu quán có ưu đãi đang chạy.
- `apps/miniapp/src/api.ts`: thêm `listVouchers`, `getVoucher`, `checkVoucher`, `memberLogin`, `getMe`, `putConsent`, `getPoints`, `redeem`, `claimPoints`, `exportData`, `deleteMe`; thêm tiêu đề `X-Member-Token` vào hàm `request` (`api.ts:25-55`); xử lý 401/403 của token thành viên (đăng xuất cục bộ nhẹ nhàng).
- `apps/miniapp/src/types.ts`: kiểu mới tương ứng; `StoreBrand` (dòng ~22) thêm `loyaltyEnabled`.

---

## 7. Trường hợp biên và bảo mật

### 7.1 Chống gian lận voucher
- Mã riêng (`VoucherIssue`) là một lần: trạng thái chuyển `RESERVED -> REDEEMED` trong cùng transaction đóng hóa đơn; ràng buộc `@@unique([voucherId, billId])` ở `VoucherRedemption`; `updateMany` có điều kiện cho `totalLimit`; chống đua khi hai thu ngân dùng cùng mã cùng lúc (người sau nhận lỗi "Mã ưu đãi đã được sử dụng").
- Ràng buộc quán: voucher có `storeId`; mọi kiểm tra so `voucher.storeId == bill.storeId == user.storeId` (không dựa vào mã).
- Mã công khai dùng chung (như HENGAPLAI) chỉ giới hạn một lần/khách nếu khách xác minh được; nếu quán đặt `perCustomerLimit` thì bắt buộc `requiresMember`. Mã công khai không có `perCustomerLimit` thì rủi ro dùng lặp do quán chấp nhận (cảnh báo khi tạo).
- Dò mã: giới hạn tần suất `vouchers/check`, thông báo lỗi chung; mã riêng 8 ký tự Crockford (khoảng 40 bit) không đoán được; mã công khai do chủ quán đặt (4-20 ký tự), cảnh báo khi quá dễ đoán.
- Thu ngân gian lận (áp voucher cho người quen, áp ngoại lệ): ngoại lệ cần quản lý duyệt bằng mật khẩu; mọi lượt áp dụng ghi thu ngân; báo cáo "ưu đãi theo thu ngân" và cảnh báo bất thường (một thu ngân áp ngoại lệ hoặc voucher cao bất thường so với mặt bằng); gỡ khoản giảm sau khi áp dụng cũng audit.
- Khách gian lận (nhiều tài khoản Zalo để nhận nhiều quà chào mừng): giới hạn mỗi `zaloUserId` đã xác minh; mã giảm theo số điện thoại xác minh nếu có (GĐ-02); ngưỡng bất thường theo thiết bị/IP chỉ để cảnh báo, không để chặn tự động.
- Đơn khai báo mã trong giỏ nhưng không dùng: không phát sinh hậu quả (không trừ lượt khi chưa áp dụng).
- Hóa đơn bị hủy/hoàn: `RESERVED` giải phóng; `CONSUMED` theo Mục 5.5.
- Khuyến mãi vượt ngân sách: `totalLimit` và (tùy chọn) trần tổng tiền giảm của chiến dịch (cột `budgetAmount`, thêm khi PO yêu cầu).

### 7.2 Chống gian lận điểm
- Điểm chỉ cộng khi hóa đơn `PAID` của thành viên xác minh; `dedupeKey` duy nhất cho mỗi nguồn; sổ chỉ ghi thêm; điều chỉnh thủ công cần lý do và hạn mức; mọi điều chỉnh audit và báo cáo riêng.
- `claim-points` chống nhặt link đơn của người khác: giới hạn số lần mỗi ngày/khách, thời hạn ngắn, đơn phải `COMPLETED` và chưa gắn khách; ghi `zaloUserId` đã nhận.
- Đổi điểm lấy voucher và dùng điểm trên POS là hai đường: cả hai trừ qua cùng sổ, khóa dòng `Customer` trong transaction để không dùng quá số dư (kể cả khi hai thu ngân/hai thiết bị cùng thao tác).

### 7.3 Quyền riêng tư (Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân)
GĐ-05: PO cần xác nhận cách áp dụng với tư vấn pháp lý (vai trò của quán và InnoCom là bên kiểm soát hay bên xử lý dữ liệu, yêu cầu thông báo xử lý, đánh giá tác động, lưu trữ trong nước, trường hợp dữ liệu của khách nước ngoài...). Đặc tả này triển khai các nguyên tắc kỹ thuật:
- Đồng ý rõ ràng, cụ thể theo mục đích, tự nguyện, có thể chứng minh: lưu `ConsentRecord` (thời điểm, phạm vi, phiên bản văn bản, kênh); không chọn sẵn ô đồng ý; từ chối tùy chọn không ảnh hưởng quyền gọi món.
- Rút lại đồng ý dễ như khi đồng ý; có hiệu lực ngay cho gửi tin và phát tự động.
- Tối thiểu hóa dữ liệu: chỉ lưu mã Zalo, tên hiển thị (nếu khách cho phép), số điện thoại (tùy chọn, có xác minh), ngày/tháng sinh (tùy chọn); không lưu năm sinh; không lưu ảnh đại diện; không đọc danh bạ/vị trí.
- Tách bạch dữ liệu giao dịch (đơn, bill) khỏi dữ liệu định danh để có thể ẩn danh mà vẫn giữ sổ sách.
- Quyền xem/xuất và xóa của thành viên có ngay trong mini app (Mục 5.2).
- Ghi nhật ký truy cập dữ liệu khách của nhân viên (tra cứu, xuất), giới hạn vai trò, che bớt số điện thoại trên danh sách.
- Không bao giờ hiển thị cho khách bất kỳ dữ liệu của khách khác; token thành viên gắn với một quán.
- Mỗi quán có dữ liệu riêng (`storeId`); cùng một Zalo ở quán khác là bản ghi khác, không chia sẻ điểm, consent, dữ liệu giữa các quán (Q10).

### 7.4 Xóa dữ liệu (quyền xóa)
`DELETE /public/stores/:slug/members/me` hoặc yêu cầu qua quán (`anonymize`):
- Trong một transaction: `Customer` đặt `status = DELETED`, `anonymizedAt = now()`, xóa `name`, `phone`, `zaloUserId`, `birthMonth/Day`, `marketingConsent/transactionalConsent = false`; `Order.customerId` giữ liên kết tới bản ghi đã ẩn danh (để sổ sách không mất) hoặc đặt `NULL` (PO chọn); `PointLedger` giữ số liệu nhưng không còn định danh được; `VoucherIssue` `REVOKED`; `ConsentRecord` giữ lại dạng ẩn danh làm bằng chứng đã xử lý yêu cầu (đề xuất; GĐ-05).
- Đơn đang `PENDING` chưa thanh toán: cho xóa nhưng cảnh báo mất điểm của đơn đó.
- Số điện thoại trong `Order.customerNote`: hệ thống không phân tích chuỗi tự do; nếu khách nhập SĐT vào ghi chú thì không thuộc phạm vi tự động xóa (ghi chú trong chính sách).
- Thời hạn xử lý: tự động, tức thời (không phải thao tác thủ công của quán); quán xem được nhật ký xóa.

### 7.5 Trường hợp biên vận hành
- Voucher hết hạn lúc đang áp dụng (giữa ngày): kiểm tra tại thời điểm đóng hóa đơn lần cuối; nếu quá hạn trong lúc thao tác thì báo thu ngân; ngoại lệ do quản lý.
- Đổi cấu hình điểm giữa ngày: áp dụng cho hóa đơn đóng sau thời điểm lưu; điểm đã ghi không bị tính lại.
- Khách đăng nhập ở thiết bị khác: nhận cùng hồ sơ (theo `zaloUserId` đã xác minh).
- Hai khách cùng bàn đều muốn tích điểm cho một bill: v1 một hóa đơn gắn một khách; chia bill (Đặc tả 02) có thể gắn từng lượt thanh toán với từng khách ở phase sau (Q11).
- Mini app mất mạng khi sao chép mã: mã đã tải về ở trang chi tiết nên vẫn sao chép được.
- Zalo API lỗi/quá tải khi đăng nhập: thông báo thân thiện, vẫn gọi món bình thường; không chặn đơn.
- Quán tắt module `loyalty`: dữ liệu giữ nguyên, ẩn khỏi mini app; voucher đang `RESERVED` giải phóng.
- Gỡ voucher sau khi thanh toán một phần: không cho phép (hóa đơn đã có Payment).

---

## 8. Tiêu chí nghiệm thu (Cho / Khi / Thì)

1. Cho quán có module `loyalty` bật và voucher công khai HENGAPLAI (giảm 10%, tối thiểu 300.000đ, tối đa 50.000đ, hết hạn 30/11/2026), khi khách mở "Ưu đãi của quán", thì thấy một thẻ đúng cấu trúc thiết kế (ô "10%", nhãn, tiêu đề, mô tả "Giảm 10% cho đơn từ 300.000đ.") và dòng chú thích "Ưu đãi chỉ áp dụng khi được quán xác nhận. Không tự động trừ vào giỏ món."; không còn chữ "minh họa" hay "mẫu" nào.
2. Cho khách mở chi tiết ưu đãi trên, khi bấm "Sao chép mã ưu đãi", thì thấy toast "Đã sao chép mã HENGAPLAI" (hoặc hộp thoại chứa mã khi không sao chép được) và mục "Điều kiện áp dụng" liệt kê đủ: đơn tối thiểu và mức giảm tối đa, hạn dùng, không đồng thời với ưu đãi khác, nhờ nhân viên kiểm tra.
3. Cho quán chưa có ưu đãi nào, khi khách mở màn, thì thấy trạng thái rỗng "Ưu đãi đang được chuẩn bị".
4. Cho voucher HENGAPLAI, khi thu ngân áp dụng vào hóa đơn 280.000đ, thì bị từ chối "Ưu đãi chưa đạt đơn tối thiểu 300.000đ (còn thiếu 20.000đ)"; hóa đơn 600.000đ giảm đúng 50.000đ (bị chặn bởi mức tối đa); VAT và tổng tính sau giảm đúng như `calcTotals`.
5. Cho voucher một lần/khách, khi hai thu ngân dùng cùng một mã riêng cho hai hóa đơn khác nhau cùng lúc (test song song), thì đúng một lần thành công, lần kia nhận "Mã ưu đãi đã được sử dụng".
6. Cho voucher của quán A, khi thu ngân quán B nhập mã này, thì lỗi "Mã không hợp lệ hoặc đã hết hạn" (không tiết lộ quán khác), không có thay đổi nào.
7. Cho khách khai báo mã trong giỏ và gửi đơn, khi đơn tạo, thì giá đơn không đổi, POS hiện chip "Khách muốn dùng: HENGAPLAI", `Order.requestedVoucherCode` được lưu, lượt dùng chưa bị trừ.
8. Cho voucher đã áp dụng (`RESERVED`), khi thu ngân gỡ khoản giảm, thì `usedCount` giảm và voucher dùng lại được; khi đóng hóa đơn, thì `RESERVED` thành `CONSUMED`/`REDEEMED`.
9. Cho thành viên đã xác minh trong bill 245.000đ với `earnAmountPerPoint = 10.000`, khi thanh toán xong, thì có đúng một dòng `PointLedger EARN +24`, số dư tăng 24, `totalOrders` +1, `totalSpent` +245.000; gọi lại tích điểm cho cùng hóa đơn không cộng thêm.
10. Cho hóa đơn đã tích điểm, khi hoàn tiền, thì sinh `REVERT -24`, `totalSpent` giảm 245.000; số dư không lệch tổng sổ.
11. Cho khách chưa đăng nhập vừa thanh toán xong, khi đăng nhập Zalo và bấm nhận điểm trong thời hạn, thì nhận đúng điểm một lần; lần nhận thứ hai báo "Đơn này đã được nhận điểm"; sau thời hạn báo "Đã quá thời hạn nhận điểm".
12. Cho `zaloUserId` do client tự gửi không qua access token hợp lệ, khi gọi đăng nhập, thì 401, không tạo thành viên, không nhận điểm.
13. Cho khách đồng ý `LOYALTY` nhưng không chọn `MARKETING_ZNS`, khi chiến dịch tin nhắn (giai đoạn 2) chạy, thì khách không nằm trong danh sách gửi; khi khách rút lại một consent, thì có `ConsentRecord granted=false` và hiệu lực ngay.
14. Cho khách bấm "Xóa tài khoản thành viên", khi xác nhận, thì dữ liệu định danh bị xóa/ẩn danh, `VoucherIssue` bị thu hồi, đăng nhập lại tạo hồ sơ mới trống, số điện thoại không còn tìm thấy ở POS.
15. Cho đơn công khai có trường `customer.marketingConsent = true` không kèm token thành viên, khi tạo đơn, thì consent KHÔNG được ghi nhận.
16. Cho thu ngân (không phải quản lý), khi áp dụng ngoại lệ, thì 403; quản lý nhập đúng mật khẩu thì thành công, có `overrideReason` và `approvedByUserId` trong audit.
17. Cho mã dò liên tục từ một IP, khi vượt giới hạn, thì 429 "Bạn thao tác quá nhanh" và không lộ mã nào tồn tại.
18. Cho điều chỉnh điểm của quản lý, khi không nhập lý do, thì 400; có lý do thì ghi sổ `ADJUST` và audit.
19. Cho tác vụ sinh nhật chạy hai lần trong cùng ngày (mô phỏng lỗi), thì mỗi khách chỉ nhận một voucher (dedupe).
20. Cho đối soát đêm, khi chạy trên dữ liệu kiểm thử, thì tổng sổ điểm = số dư của từng khách và mỗi voucher "một lần/khách" không có hơn một lượt `CONSUMED`.
21. Cho quán A, khi nhân viên gọi API khách/voucher của quán B, thì 403.

---

## 9. Phân rã công việc (thứ tự làm)

Phụ thuộc chính: `BillService` và `BillDiscount` của Đặc tả 02 (cho áp dụng voucher/điểm và tích điểm khi đóng hóa đơn). Phần xem ưu đãi công khai (không thành viên) có thể làm trước và giao sớm.

| # | Công việc | Loại | Cỡ | Phụ thuộc |
|---|---|---|---|---|
| 1 | Migration + Prisma (bảng mới, cột Customer/Order, chỉ mục duy nhất `zaloUserId`, module `loyalty`); backfill và sửa `totalOrders/totalSpent` | BE | M | không |
| 2 | Voucher: `VoucherService` (validate, tính giảm, chống đua), CRUD admin, trạng thái, API công khai danh sách/chi tiết/check (chưa cần thành viên, mã công khai) | BE | L | 1 |
| 3 | Mini app: `Voucher.tsx` + `VoucherDetail.tsx` khớp thiết kế v2, sao chép mã, route mới, `api.ts`/`types.ts` | FE | M | 2 |
| 4 | Admin: trang `Vouchers.tsx` (tạo, xem trước, trạng thái, lượt dùng) + mục menu | FE | L | 2 |
| 5 | Gỡ xử lý consent giả ở `createOrderTx` (đặt cờ từ dữ liệu client), thay bằng tự khai không xác thực + `requestedVoucherCode` + kiểm mềm | BE | S | 1, 2 |
| 6 | Mini app giỏ hàng: thẻ "Ưu đãi" + bottom sheet + chip + chữ ký `clientRequestId` | FE | M | 5 |
| 7 | Định danh thành viên: xác minh Zalo phía máy chủ (sau khi GĐ-01 được xác minh), `memberToken`, consent, hồ sơ, xuất/xóa | BE | L | 1; GĐ-01 |
| 8 | Mini app: đăng nhập thật, màn đồng ý, thẻ thành viên, Quyền riêng tư (cần thiết kế) | FE | L | 7, thiết kế |
| 9 | Chương trình điểm: cấu hình, sổ điểm, tích điểm khi đóng hóa đơn, hoàn tiền, `claim-points`, hạng; đối soát đêm | BE | L | 7, Đặc tả 02 `BillService` |
| 10 | POS: gắn khách, áp dụng voucher, dùng điểm, ngoại lệ có duyệt (trong `CheckoutModal`) | FE+BE | L | 2, 9, Đặc tả 02 |
| 11 | Admin: Khách hàng, Chương trình thành viên, điều chỉnh điểm, xử lý xóa | FE | L | 9 |
| 12 | Đổi điểm lấy voucher (mini app + API) | FE+BE | M | 9 |
| 13 | Tác vụ nền: sinh nhật, quay lại sau N ngày, chào mừng, quá hạn, giải phóng treo, tích điểm bù (cần `@nestjs/schedule`) | BE + hạ tầng | M | 2, 9 |
| 14 | Báo cáo Ưu đãi và Thành viên | BE+FE | M | 10, 13 |
| 15 | Kiểm thử bảo mật/đua/riêng tư: bộ test mục 8 (4, 5, 6, 12, 15, 17), rà soát pháp lý consent | QA | M | 10 |
| 16 | Pilot 1 quán, đo các số đo ở Mục 1 | Vận hành | M | 15 |
| 17 | (Giai đoạn 2, tùy chọn) ZNS: điều kiện Zalo OA/mẫu tin, ngân sách, nhật ký, chiến dịch | BE+FE+hạ tầng | L | 7, 13; GĐ-03 |

Có thể giao theo mốc: Mốc A (bước 1-4, 6): ưu đãi công khai theo đúng thiết kế, thu ngân áp mã thủ công, không cần Zalo xác minh. Mốc B (bước 7-12): thành viên + điểm. Mốc C (13-16): tự động hóa + báo cáo + pilot.
Tổng ước lượng một developer: khoảng 7-9 tuần (không tính thiết kế các màn mới, thời gian xác minh với Zalo, tư vấn pháp lý).

---

## 10. Rủi ro, giả định cần xác minh, quyết định cần PO

Rủi ro:
- Không xác minh được danh tính Zalo ở phía máy chủ: toàn bộ điểm/voucher riêng bị mất tính tin cậy; dùng phương án mức tin cậy thấp hoặc OTP (tốn phí).
- Pháp lý bảo vệ dữ liệu cá nhân: sai lệch trong consent/xóa dữ liệu có thể gây rủi ro cho quán và InnoCom; cần tư vấn pháp lý trước pilot.
- Chi phí ưu đãi vượt kiểm soát (chiến dịch mã công khai bị lan truyền): `totalLimit`, hạn dùng, trần ngân sách.
- Nhân viên gian lận bằng ngoại lệ: duyệt quản lý, audit, báo cáo.
- Độ phức tạp phình (nhiều loại điều kiện): giữ v1 ở mức hóa đơn, một voucher mỗi hóa đơn.
- Phụ thuộc Đặc tả 02 (`BillService`) để áp dụng/tích điểm: nếu 02 chậm, mốc A vẫn giao được; áp dụng voucher/điểm cần `BillDiscount`.
- Điểm làm tăng "nợ" của quán (điểm chưa dùng quy đổi thành tiền): báo cáo giá trị còn nợ; quán quyết định chính sách hết hạn (Q4).

Giả định cần xác minh:
- GĐ-01: API Zalo xác minh `accessToken`/lấy số điện thoại phía máy chủ (endpoint, quyền, khóa, giới hạn tốc độ), và `idToken`.
- GĐ-02: xác thực số điện thoại bằng OTP SMS (nhà cung cấp, chi phí) nếu GĐ-01 không đủ.
- GĐ-03: toàn bộ điều kiện ZNS (OA, mẫu tin được duyệt, tính phí, hạn mức, nội dung quảng cáo).
- GĐ-04: API sao chép vào clipboard chuẩn trong WebView Zalo (`zmp-sdk`).
- GĐ-05: nghĩa vụ pháp lý theo Nghị định 13/2023/NĐ-CP đối với quán và InnoCom (vai trò, thông báo, lưu trữ, thời hạn).

Câu hỏi cho chủ sản phẩm:
- Q1: Voucher và điểm thuộc gói nào (Standard hay Pro; BRD ghi voucher cơ bản ở Standard, CRM + Zalo Mini App ở Pro) và module `loyalty` có tách thành hai module (`voucher`, `loyalty`) không? Chủ sản phẩm chốt giá gói.
- Q2: Có làm giai đoạn 1 chỉ gồm ưu đãi công khai + thu ngân áp mã thủ công (Mốc A) trước, rồi mới thành viên/điểm không?
- Q3: Có chấp nhận ở giai đoạn 1 chỉ hỗ trợ thành viên khi xác minh được Zalo phía máy chủ? Nếu không xác minh được thì chấp nhận mức tin cậy thấp (không đổi điểm) hay đầu tư OTP SMS?
- Q4: Điểm có hết hạn không (v1 không); nếu có, bao lâu và cách tính (lô FIFO)?
- Q5: Có bật tự động áp dụng voucher trong giỏ (trái với dòng chú thích thiết kế v2) hay giữ nguyên "quán xác nhận"?
- Q6: Mã thành viên 6 chữ số hiển thị trong mini app để thu ngân tra cứu có cần ở v1, hay thu ngân tra bằng số điện thoại?
- Q7: Có đặt lại consent tiếp thị cũ chưa xác thực về "chưa đồng ý" (đề xuất: có)?
- Q8: Quản lý có được thấy số điện thoại đầy đủ hay chỉ che bớt?
- Q9: Hoàn tiền một hóa đơn có hoàn lại lượt voucher và điểm đã dùng không (mặc định: hoàn điểm đã dùng, không hoàn lượt voucher, trừ khi quản lý chọn)?
- Q10: Điểm có dùng riêng từng quán (thiết kế này) hay dùng chung cho chuỗi (cần mô hình thương hiệu/chuỗi, ngoài phạm vi)?
- Q11: Hóa đơn chia nhiều người: tích điểm cho ai (v1: một khách mỗi hóa đơn)?
- Q12: Có cho quán tự đặt mức quy đổi điểm và tỷ lệ tích điểm tự do không, hay giới hạn trong khung do InnoOrder quy định để tránh quán đặt sai gây thua lỗ?
- Q13: Giai đoạn 2 ZNS: InnoCom chịu chi phí và tính lại cho quán, hay quán trả trực tiếp cho Zalo? (không có số liệu giá trong tài liệu này)
