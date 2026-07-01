-- E2E v2 groundwork: additive, backwards-compatible columns. Defaults keep all
-- existing rows on the v1 scheme, so no behavior change until clients opt in.

-- AlterTable: async delta packages carry their key scheme + salt.
ALTER TABLE "async_delta_packages"
  ADD COLUMN "key_scheme" TEXT NOT NULL DEFAULT 'v1-groupid',
  ADD COLUMN "key_salt" TEXT;

-- AlterTable: sync sessions carry their key scheme + salt.
ALTER TABLE "sync_sessions"
  ADD COLUMN "key_scheme" TEXT NOT NULL DEFAULT 'v1-groupid',
  ADD COLUMN "key_salt" TEXT;

-- AlterTable: Option C (bring-your-own-storage) client-encrypted storage config.
ALTER TABLE "client_groups"
  ADD COLUMN "client_encrypted_storage_config" JSONB;
