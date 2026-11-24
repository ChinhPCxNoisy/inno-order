import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { TableStatus } from '@prisma/client';

export class CreateAreaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateAreaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9]{1,20}$/, { message: 'code chi dung chu va so, toi da 20 ky tu' })
  code: string;

  @IsString()
  areaId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  seats?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  seats?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @IsString()
  areaId?: string;
}

export class TableStatusDto {
  @IsIn([
    TableStatus.AVAILABLE,
    TableStatus.OCCUPIED,
    TableStatus.NEED_CLEAN,
    TableStatus.LOCKED,
  ])
  status: TableStatus;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
