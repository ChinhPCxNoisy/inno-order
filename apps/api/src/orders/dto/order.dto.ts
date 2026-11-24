import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod, OrderSource } from '@prisma/client';
import { REFUND_REASONS } from '../../menu/dto/menu.dto';

export class CreateOrderItemDto {
  @IsUUID('all', { message: 'Mã món không hợp lệ' })
  menuItemId: string;

  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1, { message: 'Số lượng mỗi món tối thiểu là 1' })
  @Max(99, { message: 'Số lượng mỗi món tối đa là 99' })
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Ghi chú món tối đa 300 ký tự' })
  note?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemOptionDto)
  options?: CreateOrderItemOptionDto[];
}

export class CreateOrderItemOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  groupName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  optionName: string;
}

export class CustomerCaptureDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @IsOptional()
  @IsBoolean()
  transactionalConsent?: boolean;
}

export class CreateOrderDto {
  @IsOptional()
  @IsUUID('all', { message: 'Mã bàn không hợp lệ' })
  tableId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Mã bàn không hợp lệ' })
  tableCode?: string;

  @IsArray({ message: 'Đơn hàng chưa có món nào' })
  @ArrayMinSize(1, { message: 'Vui lòng chọn ít nhất 1 món' })
  @ArrayMaxSize(50, { message: 'Mỗi đơn tối đa 50 dòng món, vui lòng tách thành nhiều đơn' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Ghi chú đơn tối đa 500 ký tự' })
  customerNote?: string;

  /** Ma uu dai khach khai bao (chi LUU de quan xac nhan khi thanh toan, khong tu giam gia) */
  @IsOptional()
  @IsString()
  @MaxLength(40, { message: 'Mã ưu đãi tối đa 40 ký tự' })
  voucherCode?: string;

  /** Token phien ban (tra ve khi gui don truoc): giu dung ban sau khi nhan vien doi ban */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionToken?: string;

  /** Khoa chong gui trung: gui lai cung gia tri trong cung quan thi tra ve don da tao */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64, { message: 'Mã yêu cầu không hợp lệ' })
  clientRequestId?: string;

  @IsOptional()
  @IsIn([OrderSource.QR, OrderSource.POS, OrderSource.ADMIN])
  source?: OrderSource;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerCaptureDto)
  customer?: CustomerCaptureDto;
}

export class SetOrderStatusDto {
  @IsIn(['ACCEPTED', 'PREPARING', 'READY'])
  status: 'ACCEPTED' | 'PREPARING' | 'READY';
}

export class SetItemStatusDto {
  @IsIn(['ACCEPTED', 'PREPARING', 'READY', 'SERVED'])
  status: 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED';
}

export class CancelOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}

export class PayOrderDto {
  @IsIn([PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.QR_BANK])
  method: PaymentMethod;

  @IsOptional()
  @IsInt({ message: 'Giảm giá phải là số nguyên đồng' })
  @Min(0)
  @Max(1000000000)
  discountAmount?: number;

  @IsOptional()
  @IsInt({ message: 'Tiền khách đưa phải là số nguyên đồng' })
  @Min(0)
  @Max(10000000000)
  cashReceived?: number;
}

export class RefundOrderDto {
  @IsIn(REFUND_REASONS as unknown as string[])
  reason: (typeof REFUND_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
