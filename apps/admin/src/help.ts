// Noi dung huong dan co ban hien trong nut "?" o Layout.tsx — chon theo duong dan hien tai
// (BRD section 7 - User Journeys, section 14 - Man hinh can thiet)

export interface HelpSection {
  title: string;
  subtitle: string;
  /** Tong quan dang "bo phan — viec can lam" (dung o man hinh chung, vd Dashboard) */
  rows?: [string, string][];
  /** Cac buoc thao tac theo thu tu (dung o man hinh nghiep vu cu the) */
  steps?: string[];
  tip?: string;
}

export const DEFAULT_HELP: HelpSection = {
  title: 'Công việc của từng bộ phận',
  subtitle: 'Luồng vận hành: Thu ngân → Bếp → Phục vụ → Thu tiền → Dọn bàn',
  rows: [
    ['Thu ngân / POS', 'Chọn bàn trống hoặc đang dùng, tạo đơn và ghi chú từng món.'],
    ['Bếp / Bar', 'Nhận món, chế biến, báo món xong. Món chờ từ 15 phút được đánh dấu cảnh báo.'],
    ['Phục vụ', 'Xem món đã sẵn sàng, xác nhận đã mang ra đúng bàn, dọn bàn sau khi thanh toán.'],
    ['Thu tiền', 'Mở bàn ở POS, chọn thanh toán khi mọi món đã được phục vụ.'],
    ['Dọn bàn', 'Thanh toán xong, bàn chuyển sang cần dọn. Phục vụ xác nhận đã dọn để mở lại bàn.'],
    ['Chủ quán', 'Doanh thu chỉ tăng từ đơn đã xác nhận nhận tiền. Theo dõi đơn chờ lâu và phiếu in lỗi.'],
  ],
};

export const HELP_CONTENT: Record<string, HelpSection> = {
  '/pos': {
    title: 'Hướng dẫn: Bán hàng / Thu ngân',
    subtitle: 'Luồng: chọn bàn → gọi món → thanh toán → in bill',
    steps: [
      'Bấm vào 1 bàn bên trái để xem đơn đang mở của bàn đó ở khung bên phải.',
      'Bàn trống hoặc đang dùng: bấm "Tạo đơn tại bàn" (hoặc "Gọi thêm món" nếu bàn đã có đơn).',
      'Chạm vào món để thêm vào đơn, ghi chú riêng từng món nếu khách yêu cầu (ít cay, không hành...).',
      'Bấm "Gửi đơn đến bếp →" — đơn sẽ hiện ngay ở màn hình Bếp.',
      'Khi khách muốn trả tiền: bấm "Thanh toán" trên đơn, chọn phương thức (tiền mặt / chuyển khoản / QR ngân hàng), nhập giảm giá nếu có rồi xác nhận.',
      'Cần in lại hóa đơn thì bấm "In bill" ở đơn đó.',
      'Sau thanh toán, bàn chuyển "Cần dọn". Khi nhân viên dọn xong, bấm "Đã dọn · Mở bàn" để đón khách mới.',
    ],
    tip: 'Chỉ bấm xác nhận thanh toán SAU KHI đã nhận đủ tiền từ khách — thao tác này không thể hoàn tác.',
  },
  '/kitchen': {
    title: 'Hướng dẫn: Bếp / Pha chế',
    subtitle: 'Luồng: chờ nhận → đang chế biến → chờ mang ra',
    steps: [
      'Đơn mới hiện ở cột "01 · Chờ nhận" — bấm "Nhận đơn" để bắt đầu xử lý.',
      'Mỗi món có nút chuyển trạng thái riêng: Nhận → Làm → Xong. Bấm đúng món đang thao tác.',
      'Thẻ đơn viền đỏ + chữ "Chờ lâu" là đơn quá 15 phút chưa xong — ưu tiên làm trước.',
      'Đọc kỹ ghi chú món (hiện ngay dưới tên món, ví dụ: không hành, ít cay) trước khi chế biến.',
      'Khi tất cả món trong đơn đã xong, đơn tự chuyển sang cột "03 · Chờ mang ra" — bấm "Gọi phục vụ" để báo nhân viên ra lấy món.',
      'Bấm "Toàn màn hình" nếu muốn chữ to hơn, dễ thao tác khi đứng xa màn hình.',
    ],
    tip: 'Món hết hoặc làm không được: báo quản lý huỷ món ngay trên đơn thay vì để khách chờ.',
  },
  '/service': {
    title: 'Hướng dẫn: Phục vụ tại bàn',
    subtitle: 'Mang đúng món, đúng bàn và mở lại bàn sau khi dọn',
    steps: [
      'Mục "Món đã sẵn sàng" hiện các món bếp đã làm xong, kèm số bàn.',
      'Mang món tới đúng bàn rồi bấm "Đã mang ra bàn" để xác nhận — món sẽ biến mất khỏi danh sách chờ.',
      'Mục "Dọn bàn & đón khách" hiện các bàn khách vừa thanh toán xong, cần dọn.',
      'Dọn xong bàn nào thì bấm "Đã dọn bàn" ở bàn đó để bàn sẵn sàng đón khách mới.',
      'Muốn gọi thêm món giúp khách thì bấm "Gọi món giúp khách" để sang màn hình Bán hàng.',
    ],
  },
  '/orders': {
    title: 'Hướng dẫn: Lịch sử đơn hàng',
    subtitle: 'Tra cứu đơn cũ, in lại, xử lý huỷ/hoàn tiền',
    steps: [
      'Dùng ô tìm kiếm để tra theo số đơn hoặc mã bàn.',
      'Bấm vào 1 đơn để xem chi tiết món, trạng thái và lịch sử thanh toán.',
      'Cần huỷ món/đơn hoặc hoàn tiền: chọn lý do rõ ràng — hệ thống lưu lại ai thao tác và lúc nào.',
      'Có thể in lại phiếu bếp hoặc bill ngay từ đơn cũ nếu máy in bị lỗi lúc đầu.',
    ],
    tip: 'Huỷ món sau khi bếp đã làm cần quản lý duyệt — không tự ý huỷ để tránh thất thoát.',
  },
  '/menu': {
    title: 'Hướng dẫn: Thực đơn',
    subtitle: 'Thêm món, sửa giá, bật/tắt món còn hay hết',
    steps: [
      'Bấm "Danh mục" để tạo nhóm món (vd: Bún, Phở, Đồ uống) trước khi thêm món.',
      'Bấm "Thêm món", nhập tên, giá, chọn danh mục.',
      'Bấm "Tải ảnh từ máy" để chụp hoặc chọn ảnh món ngay từ điện thoại/máy tính — ảnh tự động được nén gọn.',
      'Dùng công tắc bật/tắt trên từng món để báo hết món — khách và POS sẽ không gọi được món đã tắt.',
      'Bấm icon bút chì trên món để thêm tuỳ chọn: cỡ, độ ngọt, độ cay, topping...',
    ],
    tip: 'Tắt món khi hết hàng thay vì xoá — giữ nguyên lịch sử giá và tuỳ chọn để dùng lại sau.',
  },
  '/tables': {
    title: 'Hướng dẫn: Khu vực & bàn',
    subtitle: 'Tạo khu vực, thêm bàn, lấy link QR cho từng bàn',
    steps: [
      'Bấm "Khu vực" để tạo nhóm bàn (vd: Tầng 1, Sân vườn).',
      'Bấm "Thêm bàn", nhập mã bàn (vd: B07) và chọn khu vực.',
      'Bấm icon QR trên từng bàn để copy link — dán vào công cụ tạo mã QR rồi in dán lên bàn.',
      'Có thể đổi trạng thái bàn thủ công (trống/đang dùng/cần dọn/tạm khoá) ở cột Trạng thái nếu cần.',
    ],
    tip: 'Mỗi bàn phải có 1 mã QR dán cố định — khách quét sai bàn sẽ bị nhầm đơn.',
  },
  '/printers': {
    title: 'Hướng dẫn: Máy in & hàng đợi',
    subtitle: 'Cấu hình máy in, kiểm tra lỗi in',
    steps: [
      'Bấm "Thêm máy in", chọn vị trí in (bếp/bar/quầy) và kiểu kết nối (USB/LAN/WiFi).',
      'Với máy in LAN/WiFi cần nhập đúng địa chỉ IP máy in (hỏi người lắp mạng nếu không rõ).',
      'Sau khi lưu, bấm "In thử" để kiểm tra máy in hoạt động trước khi dùng thật.',
      'Mục "Hàng đợi in & lịch sử" cho biết job nào bị lỗi và lý do — dùng để báo kỹ thuật khi máy in không ra giấy.',
    ],
    tip: 'Máy in báo "Lỗi"/"Ngoại tuyến": kiểm tra nguồn điện, giấy, cáp mạng rồi bấm "In thử" lại.',
  },
  '/reports': {
    title: 'Hướng dẫn: Báo cáo kinh doanh',
    subtitle: 'Xem doanh thu, món bán chạy, đơn huỷ/hoàn',
    steps: [
      'Chọn khoảng thời gian cần xem (hôm nay / theo ngày).',
      'Xem tổng doanh thu, số đơn, và doanh thu theo từng phương thức thanh toán.',
      'Xem danh sách món bán chạy để biết nên chuẩn bị nguyên liệu gì nhiều hơn.',
      'Theo dõi số đơn huỷ/hoàn tiền — tăng bất thường thì nên kiểm tra lại quy trình phục vụ.',
    ],
  },
  '/users': {
    title: 'Hướng dẫn: Nhân sự & vai trò',
    subtitle: 'Tạo tài khoản, phân quyền nhân viên',
    steps: [
      'Bấm "Thêm nhân viên", nhập tên và chọn vai trò (Quản lý/Thu ngân/Phục vụ/Bếp...).',
      'Mỗi vai trò chỉ thấy đúng những màn hình cần dùng — không cấp quyền Quản lý nếu không cần thiết.',
      'Nhân viên nghỉ việc: đổi trạng thái tài khoản sang khoá thay vì xoá, để vẫn tra cứu được lịch sử thao tác của họ.',
    ],
    tip: 'Hãy để từng nhân viên tự đổi mật khẩu lần đầu đăng nhập — tránh dùng chung 1 tài khoản cho nhiều người.',
  },
  '/stores': {
    title: 'Hướng dẫn: Quán trên nền tảng (Super Admin)',
    subtitle: 'Tạo quán mới, tạm khoá/mở quán',
    steps: [
      'Bấm "Thêm quán", nhập tên, slug (dùng cho link QR) và thông tin chủ quán đầu tiên.',
      'Sau khi tạo, chuyển sang quán đó (chọn ở ô "Không gian làm việc") để vào cấu hình menu, bàn, máy in giúp quán.',
      'Quán quá hạn thanh toán hoặc vi phạm: đổi trạng thái sang "Tạm khoá" — nhân viên quán đó sẽ không thao tác được.',
    ],
    tip: 'Hiện hệ thống chưa tự động khoá quán theo hạn thanh toán — cần tự theo dõi và khoá bằng tay.',
  },
};
