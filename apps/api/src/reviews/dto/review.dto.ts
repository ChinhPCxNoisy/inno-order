import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  // Tag nhanh khach chon (vd: "Thân thiện", "Phục vụ chậm")
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  tags?: string[];

  // Dinh danh Zalo cua khach (zmp-sdk getUserID), neu da dang nhap Zalo trong mini app
  @IsOptional()
  @IsString()
  @MaxLength(100)
  zaloUserId?: string;
}
