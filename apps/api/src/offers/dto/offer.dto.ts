import { Type } from 'class-transformer';
import { CreateOrderItemDto } from '../../orders/dto/order.dto';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  ValidateNested,
  ArrayMinSize,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOfferDto {
  /** Ma cong khai 4-20 ky tu, chu in hoa/so/gach (tu dong in hoa) */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{4,20}$/, { message: 'Mã ưu đãi gồm 4-20 ký tự chữ, số, gạch' })
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  tagline?: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tiêu đề ưu đãi' })
  @MaxLength(120)
  headline: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsIn(['PERCENT', 'AMOUNT'], { message: 'Loại giảm phải là PERCENT hoặc AMOUNT' })
  discountType: 'PERCENT' | 'AMOUNT';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Giá trị giảm phải lớn hơn 0' })
  @Max(1000000000)
  value: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'Số tiền phải là số nguyên đồng' })
  @Min(0)
  @Max(1000000000)
  maxDiscount?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'Số tiền phải là số nguyên đồng' })
  @Min(0)
  @Max(1000000000)
  minSubtotal?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  totalLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @IsBoolean()
  listed?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  cashierCanApply?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  extraTerms?: string[];
}

export class UpdateOfferDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tagline?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn(['PERCENT', 'AMOUNT'])
  discountType?: 'PERCENT' | 'AMOUNT';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000000)
  value?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'Số tiền phải là số nguyên đồng' })
  @Min(0)
  @Max(1000000000)
  maxDiscount?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'Số tiền phải là số nguyên đồng' })
  @Min(0)
  @Max(1000000000)
  minSubtotal?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  totalLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @IsBoolean()
  listed?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  cashierCanApply?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  extraTerms?: string[];
}

export class PublicOfferCheckDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code: string;

  /** Tam tinh do client gui (cu). Bi BO QUA khi co items: may chu tu tinh */
  @ValidateIf((o: PublicOfferCheckDto) => !o.items)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'Tạm tính phải là số nguyên đồng' })
  @Min(0)
  @Max(1000000000)
  subtotal?: number;

  /** Gio hang (mon + so luong + option): may chu tinh tam tinh/VAT/giam bang dung ham tinh tien cua don */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items?: CreateOrderItemDto[];
}

/** Bao gia gio hang cho khach (khong luu gi). code tuy chon. */
export class PublicQuoteDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Giỏ hàng trống' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;
}
