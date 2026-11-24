import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class AgentPrinterReportDto {
  @IsUUID('all')
  printerId: string;

  @IsBoolean()
  reachable: boolean;

  @IsOptional()
  @IsIn(['OK', 'PAPER_OUT', 'COVER_OPEN', 'ERROR'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  detail?: string;
}

export class AgentHeartbeatDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  version?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentPrinterReportDto)
  printers?: AgentPrinterReportDto[];
}

export class AgentResultDto {
  @IsBoolean()
  ok: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  error?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  errorCode?: string;

  @IsOptional()
  @IsBoolean()
  retryable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  printerStatus?: string;

  @IsOptional()
  @IsNumber()
  durationMs?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  note?: string;
}

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên Print Agent' })
  @MaxLength(100)
  name: string;
}

export class RetryJobDto {
  @IsOptional()
  @IsInt()
  copies?: number;
}
