-- Phien ban (TableSession), hoa don ban (Bill), giam gia cap ban, nhieu Payment cho 1 bill. Chi them, khong xoa du lieu.
-- CreateEnum
CREATE TYPE "TableSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('MANUAL', 'VOUCHER', 'POINTS');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "billId" UUID,
ADD COLUMN     "sessionId" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "allocation" JSONB,
ADD COLUMN     "billId" UUID,
ADD COLUMN     "cashReceived" DECIMAL(14,2),
ADD COLUMN     "idempotencyKey" VARCHAR(64),
ADD COLUMN     "payerLabel" TEXT,
ADD COLUMN     "refundOfPaymentId" UUID,
ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "billSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "table_sessions" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "primaryTableId" UUID NOT NULL,
    "status" "TableSessionStatus" NOT NULL DEFAULT 'OPEN',
    "publicToken" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openedByUserId" UUID,
    "openedVia" TEXT NOT NULL DEFAULT 'QR',
    "guestCount" INTEGER,
    "mergedIntoId" UUID,
    "note" TEXT,

    CONSTRAINT "table_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_session_tables" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PRIMARY',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "table_session_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "billNo" TEXT NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'OPEN',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "closedByUserId" UUID,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_discounts" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "kind" "DiscountKind" NOT NULL DEFAULT 'MANUAL',
    "amount" DECIMAL(14,2) NOT NULL,
    "percent" DECIMAL(5,2),
    "reason" TEXT,
    "createdByUserId" UUID,
    "approvedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "table_sessions_publicToken_key" ON "table_sessions"("publicToken");

-- CreateIndex
CREATE INDEX "table_sessions_storeId_status_idx" ON "table_sessions"("storeId", "status");

-- CreateIndex
CREATE INDEX "table_sessions_primaryTableId_status_idx" ON "table_sessions"("primaryTableId", "status");

-- CreateIndex
CREATE INDEX "table_session_tables_sessionId_idx" ON "table_session_tables"("sessionId");

-- CreateIndex
CREATE INDEX "table_session_tables_tableId_leftAt_idx" ON "table_session_tables"("tableId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "bills_sessionId_key" ON "bills"("sessionId");

-- CreateIndex
CREATE INDEX "bills_storeId_status_idx" ON "bills"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bills_storeId_billNo_key" ON "bills"("storeId", "billNo");

-- CreateIndex
CREATE INDEX "bill_discounts_billId_idx" ON "bill_discounts"("billId");

-- CreateIndex
CREATE INDEX "orders_sessionId_idx" ON "orders"("sessionId");

-- CreateIndex
CREATE INDEX "orders_billId_idx" ON "orders"("billId");

-- CreateIndex
CREATE INDEX "payments_billId_idx" ON "payments"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_storeId_idempotencyKey_key" ON "payments"("storeId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "table_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_primaryTableId_fkey" FOREIGN KEY ("primaryTableId") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_session_tables" ADD CONSTRAINT "table_session_tables_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "table_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_session_tables" ADD CONSTRAINT "table_session_tables_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "table_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill an toan: moi ban dang co don mo (PENDING/ACCEPTED/PREPARING/READY) thuoc 1 phien OPEN.
-- Khong tao Bill san (tao khi can). Don da dong (COMPLETED/CANCELLED/REFUNDED) giu sessionId = NULL (lich su).
-- Idempotent: bo qua don da co sessionId.
DO $$
DECLARE
  r RECORD;
  sid uuid;
BEGIN
  FOR r IN
    SELECT o."storeId", o."tableId", MIN(o."createdAt") AS opened_at
    FROM orders o
    WHERE o."sessionId" IS NULL
      AND o.status IN ('PENDING', 'ACCEPTED', 'PREPARING', 'READY')
    GROUP BY o."storeId", o."tableId"
  LOOP
    sid := gen_random_uuid();
    INSERT INTO table_sessions (id, "storeId", "primaryTableId", status, "publicToken", "openedAt", "openedVia", note)
    VALUES (
      sid, r."storeId", r."tableId", 'OPEN',
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
        || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
        || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      r.opened_at, 'BACKFILL', 'Tao tu dong khi nang cap len hoa don ban'
    );
    INSERT INTO table_session_tables (id, "sessionId", "tableId", role, "joinedAt")
    VALUES (gen_random_uuid(), sid, r."tableId", 'PRIMARY', r.opened_at);
    UPDATE orders SET "sessionId" = sid
    WHERE "storeId" = r."storeId" AND "tableId" = r."tableId" AND "sessionId" IS NULL
      AND status IN ('PENDING', 'ACCEPTED', 'PREPARING', 'READY');
  END LOOP;
END $$;
