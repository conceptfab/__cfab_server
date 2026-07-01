-- Fleet migration telemetry: per-device E2E v2 capability flag (additive, default
-- false so existing devices are treated as v1-only until they report otherwise).
ALTER TABLE "license_devices"
  ADD COLUMN "supports_v2" BOOLEAN NOT NULL DEFAULT false;
