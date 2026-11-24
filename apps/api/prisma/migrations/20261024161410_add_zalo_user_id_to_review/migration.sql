-- AlterTable
ALTER TABLE "order_reviews" ADD COLUMN     "zaloUserId" TEXT;

-- CreateIndex
CREATE INDEX "order_reviews_zaloUserId_idx" ON "order_reviews"("zaloUserId");
