import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePaymentAccountDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên gợi nhớ' })
  @MaxLength(100)
  label: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Mã BIN ngân hàng gồm 6 chữ số' })
  bankBin: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  bankName: string;

  @IsString()
  @Matches(/^[0-9A-Za-z]{4,19}$/, { message: 'Số tài khoản gồm 4-19 chữ hoặc số' })
  accountNumber: string;

  /** Viet hoa khong dau, dung nhu ngan hang */
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên chủ tài khoản' })
  @MaxLength(100)
  accountName: string;

  @IsIn(['MANUAL', 'MOCK'], { message: 'Nhà cung cấp chưa được hỗ trợ (MANUAL hoặc MOCK)' })
  provider: 'MANUAL' | 'MOCK';

  @IsOptional()
  @IsObject()
  providerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** Nhap lai mat khau cua nguoi dang thao tac (chong doi tai khoan nhan tien de chiem doat) */
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lại mật khẩu để xác nhận' })
  @MaxLength(200)
  password: string;
}

export class UpdatePaymentAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  // Doi ngan hang / so tai khoan / ten chu tk: can mat khau, dat lai trang thai da xac minh
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Mã BIN ngân hàng gồm 6 chữ số' })
  bankBin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Za-z]{4,19}$/, { message: 'Số tài khoản gồm 4-19 chữ hoặc số' })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

export class UpdatePaymentSettingsDto {
  @IsBoolean({ message: 'customerCanPayQr phải là true hoặc false' })
  customerCanPayQr: boolean;
}

export class ReauthDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lại mật khẩu để xác nhận' })
  @MaxLength(200)
  password: string;
}

export class CreateQrIntentDto {
  /** Mac dinh = con phai thu; khong duoc lon hon */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'Số tiền phải là số nguyên đồng' })
  @Min(1000, { message: 'Số tiền QR tối thiểu 1.000đ' })
  @Max(10000000000)
  amount?: number;
}

export class ManualConfirmDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ResolveBankTxnDto {
  @IsIn(['ATTACH_TO_BILL', 'MARK_REFUND_PENDING', 'MARK_REFUNDED', 'IGNORE'])
  action: 'ATTACH_TO_BILL' | 'MARK_REFUND_PENDING' | 'MARK_REFUNDED' | 'IGNORE';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  billId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class MockSimulateDto {
  @IsString()
  @MaxLength(60)
  accountId: string;

  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1)
  @Max(10000000000)
  amount: number;

  /** Noi dung chuyen khoan (thuong la ma doi soat cua intent) */
  @IsString()
  @MaxLength(300)
  content: string;

  /** Mac dinh sinh ngau nhien; gui lai cung ma de thu idempotent */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerTxnId?: string;

  @IsOptional()
  @IsIn(['IN', 'OUT'])
  direction?: 'IN' | 'OUT';
}

export class RefundCompleteDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập số tham chiếu chuyển trả' })
  @MaxLength(100)
  reference: string;
}
