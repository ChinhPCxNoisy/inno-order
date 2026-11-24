-- Hang doi in that: PrintAgent, lease/attempt/dedupe/payload tren PrintJob, khu in danh muc/mon, cot may in. Chi them, khong xoa du lieu.
-- CreateEnum
CREATE TYPE "TicketStation" AS ENUM ('KITCHEN', 'BAR', 'NONE');

-- CreateEnum
CREATE TYPE "PrinterEncoding" AS ENUM ('RASTER', 'CP1258', 'ASCII');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PrintJobType" ADD VALUE 'PRE_BILL';
ALTER TYPE "PrintJobType" ADD VALUE 'TABLE_MOVE';
ALTER TYPE "PrintJobType" ADD VALUE 'DRAWER';

-- AlterTable
ALTER TABLE "menu_categories" ADD COLUMN     "station" "TicketStation" NOT NULL DEFAULT 'KITCHEN';

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "printStation" "TicketStation";

-- AlterTable
ALTER TABLE "print_jobs" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedByUserId" UUID,
ADD COLUMN     "agentId" UUID,
ADD COLUMN     "billId" UUID,
ADD COLUMN     "copies" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "openDrawer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payload" JSONB;

-- AlterTable
ALTER TABLE "printers" ADD COLUMN     "agentId" UUID,
ADD COLUMN     "codePage" INTEGER,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "encoding" "PrinterEncoding" NOT NULL DEFAULT 'RASTER',
ADD COLUMN     "openDrawer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "statusDetail" TEXT;

-- CreateTable
CREATE TABLE "print_agents" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "version" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "print_agents_tokenHash_key" ON "print_agents"("tokenHash");

-- CreateIndex
CREATE INDEX "print_agents_storeId_idx" ON "print_agents"("storeId");

-- CreateIndex
CREATE INDEX "print_jobs_status_nextAttemptAt_idx" ON "print_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "print_jobs_storeId_dedupeKey_key" ON "print_jobs"("storeId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "print_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "print_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_agents" ADD CONSTRAINT "print_agents_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

