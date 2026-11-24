import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateStoreDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug chi dung chu thuong, so, dau gach ngang',
  })
  @MaxLength(80)
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  /** Tai khoan owner moi taon khi tao quan (tu Super Admin) */
  @IsOptional()
  owner?: {
    name: string;
    email?: string;
    phone?: string;
    password: string;
  };
}

export class UpdateStoreDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateStoreStatusDto {
  @IsString()
  @IsNotEmpty()
  status: 'ACTIVE' | 'SUSPENDED';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class UpdateStoreModulesDto {
  @IsString()
  @IsNotEmpty()
  module: string;

  @IsBoolean()
  enabled: boolean;
}
