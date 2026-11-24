-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "servedByUserId" UUID;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "enabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "order_reviews" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "staffId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_reviews_orderId_key" ON "order_reviews"("orderId");

-- CreateIndex
CREATE INDEX "order_reviews_storeId_createdAt_idx" ON "order_reviews"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "order_reviews_staffId_idx" ON "order_reviews"("staffId");

-- CreateIndex
CREATE INDEX "order_items_servedByUserId_idx" ON "order_items"("servedByUserId");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_servedByUserId_fkey" FOREIGN KEY ("servedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reviews" ADD CONSTRAINT "order_reviews_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reviews" ADD CONSTRAINT "order_reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_reviews" ADD CONSTRAINT "order_reviews_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
