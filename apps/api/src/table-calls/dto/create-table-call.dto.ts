import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const TABLE_CALL_REASONS = ['CALL_STAFF', 'WATER', 'TOOLS', 'BILL'] as const;
export type TableCallReason = (typeof TABLE_CALL_REASONS)[number];

export class CreateTableCallDto {
  @IsOptional()
  @IsIn(TABLE_CALL_REASONS as unknown as string[])
  reason?: TableCallReason;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
