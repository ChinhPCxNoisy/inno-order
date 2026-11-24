import {
  IsBoolean,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaperSize, PrinterConnection, PrinterEncoding, PrinterStation } from '@prisma/client';

export class CreatePrinterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsIn([PrinterStation.KITCHEN, PrinterStation.BAR, PrinterStation.CASHIER])
  station: PrinterStation;

  @IsIn([PrinterConnection.USB, PrinterConnection.LAN, PrinterConnection.WIFI, PrinterConnection.BLUETOOTH])
  connection: PrinterConnection;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  deviceName?: string;

  @IsOptional()
  @IsIn([PaperSize.P58, PaperSize.P80])
  paperSize?: PaperSize;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(80)
  charsPerLine?: number;

  @IsOptional()
  @IsBoolean()
  cutAtEnd?: boolean;

  @IsOptional()
  @IsUUID('all')
  agentId?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsIn([PrinterEncoding.RASTER, PrinterEncoding.CP1258, PrinterEncoding.ASCII])
  encoding?: PrinterEncoding;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(255)
  codePage?: number;

  @IsOptional()
  @IsBoolean()
  openDrawer?: boolean;
}

export class UpdatePrinterDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn([PrinterStation.KITCHEN, PrinterStation.BAR, PrinterStation.CASHIER])
  station?: PrinterStation;

  @IsOptional()
  @IsIn([PrinterConnection.USB, PrinterConnection.LAN, PrinterConnection.WIFI, PrinterConnection.BLUETOOTH])
  connection?: PrinterConnection;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  host?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  deviceName?: string | null;

  @IsOptional()
  @IsIn([PaperSize.P58, PaperSize.P80])
  paperSize?: PaperSize;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(80)
  charsPerLine?: number;

  @IsOptional()
  @IsBoolean()
  cutAtEnd?: boolean;

  /** null = bo gan agent */
  @IsOptional()
  @IsUUID('all')
  agentId?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsIn([PrinterEncoding.RASTER, PrinterEncoding.CP1258, PrinterEncoding.ASCII])
  encoding?: PrinterEncoding;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(255)
  codePage?: number | null;

  @IsOptional()
  @IsBoolean()
  openDrawer?: boolean;
}
