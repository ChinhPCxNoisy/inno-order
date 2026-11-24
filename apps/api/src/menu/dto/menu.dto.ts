import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** Khu in phieu: KITCHEN | BAR | NONE (khong in) */
  @IsOptional()
  @IsIn(['KITCHEN', 'BAR', 'NONE'])
  station?: 'KITCHEN' | 'BAR' | 'NONE';

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['KITCHEN', 'BAR', 'NONE'])
  station?: 'KITCHEN' | 'BAR' | 'NONE';

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsIn(['KITCHEN', 'BAR', 'NONE'])
  printStation?: 'KITCHEN' | 'BAR' | 'NONE';

  @IsString()
  categoryId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsInt()
  @Min(0)
  @Max(1000000000)
  price: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  prepTimeMinutes?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  tags?: string;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  /** Ghi de khu in cua danh muc; null = theo danh muc */
  @IsOptional()
  @IsIn(['KITCHEN', 'BAR', 'NONE'])
  printStation?: 'KITCHEN' | 'BAR' | 'NONE' | null;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  prepTimeMinutes?: number | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  tags?: string;
}

export class CreateOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  groupName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  optionName: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  extraPrice?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateOptionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  groupName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  optionName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  extraPrice?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export const REFUND_REASONS = [
  'WRONG_ITEM',
  'CUSTOMER_REFUSED',
  'OPERATIONAL_ERROR',
  'OTHER',
] as const;
