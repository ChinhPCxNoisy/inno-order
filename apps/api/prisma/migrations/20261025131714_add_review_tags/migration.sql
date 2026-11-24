-- AlterTable
ALTER TABLE "order_reviews" ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '[]';
