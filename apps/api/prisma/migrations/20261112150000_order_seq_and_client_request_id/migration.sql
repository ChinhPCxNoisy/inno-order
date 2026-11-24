-- AlterTable: bo dem so don theo quan + khoa chong gui trung don
ALTER TABLE "stores" ADD COLUMN "orderSeq" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "orders" ADD COLUMN "clientRequestId" VARCHAR(64);

-- Giu nguyen so don hien co: bo dem bat dau tu so don lon nhat (so hoc) cua quan
UPDATE "stores" s
SET "orderSeq" = COALESCE(
  (SELECT MAX(o."orderNumber"::bigint)
   FROM "orders" o
   WHERE o."storeId" = s."id" AND o."orderNumber" ~ '^[0-9]{1,9}$'),
  1000
);

-- CreateIndex (NULL duoc phep lap lai trong Postgres)
CREATE UNIQUE INDEX "orders_storeId_clientRequestId_key" ON "orders"("storeId", "clientRequestId");
