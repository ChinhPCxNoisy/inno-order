-- CreateTable
CREATE TABLE "table_call_requests" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,

    CONSTRAINT "table_call_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "table_call_requests_storeId_status_idx" ON "table_call_requests"("storeId", "status");

-- AddForeignKey
ALTER TABLE "table_call_requests" ADD CONSTRAINT "table_call_requests_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_call_requests" ADD CONSTRAINT "table_call_requests_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_call_requests" ADD CONSTRAINT "table_call_requests_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
