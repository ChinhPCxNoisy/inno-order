import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  beforeData?: Prisma.InputJsonValue;
  afterData?: Prisma.InputJsonValue;
  userId?: string;
  storeId?: string | null;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Ghi audit log - khong bao giom bat dong business (chua log error) */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          beforeData: entry.beforeData as Prisma.InputJsonValue | undefined,
          afterData: entry.afterData as Prisma.InputJsonValue | undefined,
          userId: entry.userId,
          storeId: entry.storeId ?? null,
          ipAddress: entry.ipAddress,
        },
      });
    } catch (e) {
      this.logger.error(`Khong ghi duoc audit log (${entry.action}):`, e as Error);
    }
  }
}
