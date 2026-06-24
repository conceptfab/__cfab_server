-- Full schema (Postgres / serverless). Regenerated for the Neon/Vercel migration.
-- Covers base sync tables + licensing, direct-sync history and feedback stores.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "public_user_id" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "display_name" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "last_client_revision" INTEGER,
    "last_client_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_heads" (
    "user_id" TEXT NOT NULL,
    "latest_revision" INTEGER NOT NULL DEFAULT 0,
    "latest_snapshot_id" TEXT,
    "latest_payload_sha256" TEXT,
    "latest_device_id" TEXT,
    "latest_table_hashes_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_heads_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sync_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payload_sha256" TEXT NOT NULL,
    "source_device_id" TEXT,
    "archive_json" JSONB,
    "table_hashes_json" JSONB,
    "blob_url" TEXT,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "device_id" TEXT,
    "endpoint" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "request_id" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_peer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "master_device_id" TEXT NOT NULL,
    "slave_device_id" TEXT,
    "sync_mode" TEXT,
    "master_marker_hash" TEXT,
    "slave_marker_hash" TEXT,
    "master_table_hashes" JSONB,
    "slave_table_hashes" JSONB,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "step_log" JSONB NOT NULL DEFAULT '[]',
    "storage_session_path" TEXT,
    "storage_credentials" JSONB,
    "storage_credentials_sent_at" TIMESTAMP(3),
    "result_marker_hash" TEXT,
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "sync_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_history_entries" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "master_device_id" TEXT NOT NULL,
    "slave_device_id" TEXT,
    "sync_mode" TEXT,
    "result_marker_hash" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "step_count" INTEGER NOT NULL,

    CONSTRAINT "sync_history_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "async_delta_packages" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "from_device_id" TEXT NOT NULL,
    "to_group_devices" BOOLEAN NOT NULL DEFAULT true,
    "base_marker_hash" TEXT,
    "new_marker_hash" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "storage_backend_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "file_size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "delivered_to_device_id" TEXT,

    CONSTRAINT "async_delta_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "license_key" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "max_devices" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "storage_backend_id" TEXT NOT NULL,
    "fixed_master_device_id" TEXT,
    "sync_priority" JSONB NOT NULL DEFAULT '{}',
    "max_sync_frequency_hours" DOUBLE PRECISION,
    "max_database_size_mb" INTEGER,

    CONSTRAINT "client_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_devices" (
    "device_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "api_token" TEXT NOT NULL,
    "registered_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "last_sync_at" TIMESTAMP(3),
    "last_marker_hash" TEXT,
    "is_fixed_master" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "license_devices_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "storage_backends" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_path" TEXT NOT NULL,
    "max_file_size_mb" INTEGER NOT NULL,
    "session_ttl_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "storage_backends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_sync_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "hash" TEXT,
    "size_bytes" INTEGER,
    "duration_ms" INTEGER,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_sync_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT,
    "version" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_public_user_id_key" ON "users"("public_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_device_id_key" ON "devices"("user_id", "device_id");

-- CreateIndex
CREATE INDEX "sync_snapshots_user_id_payload_sha256_idx" ON "sync_snapshots"("user_id", "payload_sha256");

-- CreateIndex
CREATE INDEX "sync_snapshots_user_id_created_at_idx" ON "sync_snapshots"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sync_snapshots_user_id_revision_key" ON "sync_snapshots"("user_id", "revision");

-- CreateIndex
CREATE INDEX "sync_events_created_at_idx" ON "sync_events"("created_at");

-- CreateIndex
CREATE INDEX "sync_events_user_id_created_at_idx" ON "sync_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "sync_sessions_user_id_status_idx" ON "sync_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "sync_sessions_status_expires_idx" ON "sync_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "sync_history_session_id_idx" ON "sync_history_entries"("session_id");

-- CreateIndex
CREATE INDEX "sync_history_completed_at_idx" ON "sync_history_entries"("completed_at");

-- CreateIndex
CREATE INDEX "async_packages_group_status_idx" ON "async_delta_packages"("group_id", "status");

-- CreateIndex
CREATE INDEX "async_packages_status_expires_idx" ON "async_delta_packages"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_license_key_key" ON "licenses"("license_key");

-- CreateIndex
CREATE INDEX "licenses_group_id_idx" ON "licenses"("group_id");

-- CreateIndex
CREATE INDEX "client_groups_owner_id_idx" ON "client_groups"("owner_id");

-- CreateIndex
CREATE INDEX "client_groups_license_id_idx" ON "client_groups"("license_id");

-- CreateIndex
CREATE UNIQUE INDEX "license_devices_api_token_key" ON "license_devices"("api_token");

-- CreateIndex
CREATE INDEX "license_devices_license_id_idx" ON "license_devices"("license_id");

-- CreateIndex
CREATE INDEX "license_devices_group_id_idx" ON "license_devices"("group_id");

-- CreateIndex
CREATE INDEX "direct_sync_history_timestamp_idx" ON "direct_sync_history"("timestamp");

-- CreateIndex
CREATE INDEX "feedback_created_at_idx" ON "feedback"("created_at");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_heads" ADD CONSTRAINT "sync_heads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_heads" ADD CONSTRAINT "sync_heads_latest_snapshot_id_fkey" FOREIGN KEY ("latest_snapshot_id") REFERENCES "sync_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_snapshots" ADD CONSTRAINT "sync_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_snapshots" ADD CONSTRAINT "sync_snapshots_source_device_id_fkey" FOREIGN KEY ("source_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_history_entries" ADD CONSTRAINT "sync_history_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sync_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

