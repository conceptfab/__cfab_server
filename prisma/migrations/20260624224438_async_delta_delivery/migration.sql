-- CreateTable
CREATE TABLE "async_delta_deliveries" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "acked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "async_delta_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "async_delivery_pkg_device_uq" ON "async_delta_deliveries"("package_id", "device_id");

-- CreateIndex
CREATE INDEX "async_delivery_pkg_idx" ON "async_delta_deliveries"("package_id");
