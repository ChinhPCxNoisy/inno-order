-- VietQR tang 1/2 (PaymentAccount, PaymentIntent, BankTransaction) + uu dai cong khai (Offer, OfferRedemption). Chi them, khong xoa du lieu.
-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PENDING', 'PAID', 'PARTIALLY_PAID', 'EXPIRED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BankTxnDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "BankTxnStatus" AS ENUM ('RECEIVED', 'MATCHED', 'PARTIAL', 'OVERPAID', 'UNMATCHED', 'DUPLICATE_PAYMENT', 'LATE_CLOSED', 'NEEDS_REVIEW', 'REFUND_PENDING', 'REFUNDED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "OfferRedemptionStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- AlterTable
ALTER TABLE "bill_discounts" ADD COLUMN     "offerId" UUID;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "voucherCode" VARCHAR(40);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bankTransactionId" UUID,
ADD COLUMN     "confirmedBy" TEXT NOT NULL DEFAULT 'CASHIER',
ADD COLUMN     "intentId" UUID,
ADD COLUMN     "refundNote" TEXT,
ADD COLUMN     "refundStatus" TEXT;

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "bankBin" VARCHAR(6) NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "providerConfigEnc" TEXT,
    "webhookToken" TEXT NOT NULL,
    "webhookSecretEnc" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
    "qrPayload" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdByCustomer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTxnId" TEXT NOT NULL,
    "direction" "BankTxnDirection" NOT NULL DEFAULT 'IN',
    "amount" DECIMAL(14,2) NOT NULL,
    "content" TEXT NOT NULL,
    "contentNormalized" TEXT NOT NULL,
    "bankReference" TEXT,
    "counterpartyName" TEXT,
    "counterpartyAccountMasked" TEXT,
    "transferredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB NOT NULL,
    "status" "BankTxnStatus" NOT NULL DEFAULT 'RECEIVED',
    "intentId" UUID,
    "billId" UUID,
    "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "excessAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "tagline" TEXT,
    "headline" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "discountType" "OfferType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "maxDiscount" DECIMAL(14,2),
    "minSubtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "totalLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cashierCanApply" BOOLEAN NOT NULL DEFAULT true,
    "extraTerms" JSONB NOT NULL DEFAULT '[]',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_redemptions" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "discountId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "OfferRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "appliedByUserId" UUID,
    "overrideReason" TEXT,
    "approvedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "offer_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_webhookToken_key" ON "payment_accounts"("webhookToken");

-- CreateIndex
CREATE INDEX "payment_accounts_storeId_isActive_idx" ON "payment_accounts"("storeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_storeId_bankBin_accountNumber_key" ON "payment_accounts"("storeId", "bankBin", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_code_key" ON "payment_intents"("code");

-- CreateIndex
CREATE INDEX "payment_intents_storeId_status_expiresAt_idx" ON "payment_intents"("storeId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "payment_intents_billId_status_idx" ON "payment_intents"("billId", "status");

-- CreateIndex
CREATE INDEX "bank_transactions_storeId_status_receivedAt_idx" ON "bank_transactions"("storeId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "bank_transactions_storeId_transferredAt_idx" ON "bank_transactions"("storeId", "transferredAt");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_accountId_providerTxnId_key" ON "bank_transactions"("accountId", "providerTxnId");

-- CreateIndex
CREATE INDEX "offers_storeId_active_endsAt_idx" ON "offers"("storeId", "active", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "offers_storeId_code_key" ON "offers"("storeId", "code");

-- CreateIndex
CREATE INDEX "offer_redemptions_storeId_offerId_status_idx" ON "offer_redemptions"("storeId", "offerId", "status");

-- CreateIndex
CREATE INDEX "offer_redemptions_billId_idx" ON "offer_redemptions"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "offer_redemptions_offerId_billId_key" ON "offer_redemptions"("offerId", "billId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_bankTransactionId_key" ON "payments"("bankTransactionId");

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "payment_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "payment_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_redemptions" ADD CONSTRAINT "offer_redemptions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_redemptions" ADD CONSTRAINT "offer_redemptions_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

