import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class ApproverDto {
  /** Quan ly/chu quan duyet: dinh danh bang userId HOAC email, kem mat khau */
  @IsOptional()
  @IsUUID('all', { message: 'Mã người duyệt không hợp lệ' })
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mật khẩu quản lý' })
  @MaxLength(200)
  password: string;
}

export class AddBillDiscountDto {
  @IsIn(['AMOUNT', 'PERCENT'], { message: 'Loại giảm giá phải là AMOUNT hoặc PERCENT' })
  type: 'AMOUNT' | 'PERCENT';

  // AMOUNT phai la so nguyen dong (kiem trong service); PERCENT cho phep toi 2 so le, ket qua lam tron dong
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Giá trị giảm giá không hợp lệ' })
  @Min(0.01, { message: 'Giá trị giảm giá phải lớn hơn 0' })
  @Max(10000000000)
  value: number;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lý do giảm giá' })
  @MaxLength(300)
  reason: string;

  /** Phien ban hoa don dang xem (tuy chon): lech thi 409 */
  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ApproverDto)
  approver?: ApproverDto;
}

export class ItemLineDto {
  @IsUUID('all', { message: 'Mã món trong đơn không hợp lệ' })
  orderItemId: string;

  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1)
  @Max(99)
  quantity: number;
}

export class SplitGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Mỗi nhóm cần ít nhất 1 món' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemLineDto)
  lines: ItemLineDto[];
}

/** Xem truoc chia bill */
export class SplitPreviewDto {
  @IsIn(['EVEN', 'ITEMS'])
  mode: 'EVEN' | 'ITEMS';

  /** EVEN: so phan (2..50) */
  @IsOptional()
  @IsInt()
  @Min(2, { message: 'Chia đều cần ít nhất 2 phần' })
  @Max(50)
  parts?: number;

  /** ITEMS: cac nhom nguoi tra */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SplitGroupDto)
  groups?: SplitGroupDto[];
}

/** Cach chia cua 1 lan thanh toan */
export class PaymentAllocationDto {
  @IsIn(['EVEN', 'ITEMS'])
  mode: 'EVEN' | 'ITEMS';

  /** EVEN: tong so phan va thu tu phan dang thu (1..parts) */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(50)
  parts?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  index?: number;

  /** ITEMS: cac mon nguoi nay tra */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemLineDto)
  lines?: ItemLineDto[];
}

export class PayBillDto {
  @IsIn([PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.QR_BANK, PaymentMethod.CARD], {
    message: 'Phương thức thanh toán không hợp lệ',
  })
  method: PaymentMethod;

  /** Mac dinh = con lai. Che do ITEMS: may chu tu tinh, khong tin so tien client */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'Số tiền phải là số nguyên đồng' })
  @Min(1, { message: 'Số tiền phải lớn hơn 0' })
  @Max(10000000000)
  amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'Tiền khách đưa phải là số nguyên đồng' })
  @Min(0)
  @Max(10000000000)
  cashReceived?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  payerLabel?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentAllocationDto)
  allocation?: PaymentAllocationDto;

  /** Khoa chong thanh toan trung (bat buoc): gui lai cung khoa thi tra lai Payment cu */
  @IsString({ message: 'Thiếu idempotencyKey' })
  @MinLength(8, { message: 'idempotencyKey tối thiểu 8 ký tự' })
  @MaxLength(64, { message: 'idempotencyKey tối đa 64 ký tự' })
  idempotencyKey: string;

  /** Phien ban hoa don dang xem (tuy chon): lech thi 409 */
  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  /** Dong y thanh toan du khi con mon chua ra (khi lan thu nay dong bill) */
  @IsOptional()
  @IsBoolean()
  confirmUnserved?: boolean;
}

export class MoveTableDto {
  @IsUUID('all', { message: 'Mã bàn đích không hợp lệ' })
  toTableId: string;

  /** Bat buoc khi phien da gop nhieu ban */
  @IsOptional()
  @IsUUID('all', { message: 'Mã bàn nguồn không hợp lệ' })
  fromTableId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class MergeSessionDto {
  @IsUUID('all', { message: 'Mã phiên nguồn không hợp lệ' })
  sourceSessionId: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ApplyOfferDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mã ưu đãi' })
  @MaxLength(40)
  code: string;

  /** Ap dung ngoai le khi chua dat toi thieu: can ly do + quan ly duyet */
  @IsOptional()
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ApproverDto)
  approver?: ApproverDto;
}

export class CheckOfferDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code: string;
}

export class PrintBillDto {
  @IsIn(['PRE_BILL', 'BILL'], { message: 'kind phải là PRE_BILL hoặc BILL' })
  kind: 'PRE_BILL' | 'BILL';
}

export class BillListQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID', 'REFUNDED'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
