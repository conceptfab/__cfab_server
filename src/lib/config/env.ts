type AuthMode = "token" | "session";
type EncryptionMode = "none" | "server" | "e2e";
type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppEnv {
  nodeEnv: string;
  isProduction: boolean;
  syncAuthMode: AuthMode;
  syncApiTokens: Map<string, string>;
  syncApiTokenSecret: string | null;
  syncMaxPayloadBytes: number;
  syncAllowedOrigins: string[];
  logLevel: LogLevel;
  encryptionMode: EncryptionMode;
  syncRateLimitWindowMs: number;
  syncRateLimitMaxRequests: number;
  syncAllowInsecureDevUserIdFallback: boolean;

  syncMaxArrayItems: number;
  syncMaxObjectKeys: number;
  syncMaxJsonDepth: number;
  databaseUrl: string | null;
  sftpHost: string | null;
  sftpPort: number;
  sftpUser: string | null;
  sftpPassword: string | null;
  sftpBasePath: string;
  sftpMaxFileSizeMb: number;
  syncEncryptionKey: string | null;
  adminApiToken: string | null;
  dashboardSessionSecret: string | null;
  kvRestApiUrl: string | null;
  kvRestApiToken: string | null;
  rateLimitFailureMode: "fail-open" | "fail-closed";
  syncAllowE2eV2: boolean;
}

let cachedEnv: AppEnv | null = null;

function parseIntEnv(
  value: string | undefined,
  fallback: number,
  field: string,
  min = 1,
): number {
  if (!value || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`${field} must be an integer >= ${min}`);
  }
  return parsed;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseEnumEnv<T extends string>(
  value: string | undefined,
  fallback: T,
  allowed: readonly T[],
  field: string,
): T {
  if (!value) return fallback;
  if (allowed.includes(value as T)) return value as T;
  throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseTokenMap(value: string | undefined): Map<string, string> {
  const tokens = new Map<string, string>();
  if (!value || value.trim() === "") {
    return tokens;
  }

  for (const pair of value.split(",")) {
    const [rawUserId, ...rest] = pair.split("=");
    const userId = rawUserId?.trim();
    const token = rest.join("=").trim();
    if (!userId || !token) {
      throw new Error(
        "SYNC_API_TOKENS must use 'userId=token' comma-separated pairs",
      );
    }
    tokens.set(userId, token);
  }

  return tokens;
}

function buildEnv(env: NodeJS.ProcessEnv): AppEnv {
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";

  const syncAuthMode = parseEnumEnv<AuthMode>(
    env.SYNC_AUTH_MODE,
    "token",
    ["token", "session"],
    "SYNC_AUTH_MODE",
  );
  const logLevel = parseEnumEnv<LogLevel>(
    env.LOG_LEVEL,
    "info",
    ["debug", "info", "warn", "error"],
    "LOG_LEVEL",
  );
  const encryptionMode = parseEnumEnv<EncryptionMode>(
    env.ENCRYPTION_MODE,
    "none",
    ["none", "server", "e2e"],
    "ENCRYPTION_MODE",
  );

  const syncApiTokens = parseTokenMap(env.SYNC_API_TOKENS);
  const syncApiTokenSecret = env.SYNC_API_TOKEN_SECRET?.trim() || null;

  const config: AppEnv = {
    nodeEnv,
    isProduction,
    syncAuthMode,
    syncApiTokens,
    syncApiTokenSecret,
    syncMaxPayloadBytes: parseIntEnv(
      env.SYNC_MAX_PAYLOAD_BYTES,
      20 * 1024 * 1024,
      "SYNC_MAX_PAYLOAD_BYTES",
    ),
    syncAllowedOrigins: parseCsv(env.SYNC_ALLOWED_ORIGINS),
    logLevel,
    encryptionMode,
    syncRateLimitWindowMs: parseIntEnv(
      env.SYNC_RATE_LIMIT_WINDOW_MS,
      60_000,
      "SYNC_RATE_LIMIT_WINDOW_MS",
    ),
    syncRateLimitMaxRequests: parseIntEnv(
      env.SYNC_RATE_LIMIT_MAX_REQUESTS,
      120,
      "SYNC_RATE_LIMIT_MAX_REQUESTS",
    ),
    // Bezpieczeństwo: w produkcji ten fallback NIGDY nie jest aktywny, niezależnie od flagi.
    syncAllowInsecureDevUserIdFallback: isProduction
      ? false
      : parseBoolEnv(env.SYNC_ALLOW_INSECURE_DEV_USERID_FALLBACK, true),

    syncMaxArrayItems: parseIntEnv(
      env.SYNC_MAX_ARRAY_ITEMS,
      100_000,
      "SYNC_MAX_ARRAY_ITEMS",
    ),
    syncMaxObjectKeys: parseIntEnv(
      env.SYNC_MAX_OBJECT_KEYS,
      10_000,
      "SYNC_MAX_OBJECT_KEYS",
    ),
    syncMaxJsonDepth: parseIntEnv(
      env.SYNC_MAX_JSON_DEPTH,
      32,
      "SYNC_MAX_JSON_DEPTH",
    ),
    databaseUrl: env.DATABASE_URL?.trim() || null,
    sftpHost: env.SFTP_HOST?.trim() || null,
    sftpPort: parseIntEnv(env.SFTP_PORT, 22, "SFTP_PORT"),
    sftpUser: env.SFTP_USER?.trim() || null,
    sftpPassword: env.SFTP_PASSWORD?.trim() || null,
    sftpBasePath: env.SFTP_BASE_PATH?.trim() || "/timeflow-sync/",
    sftpMaxFileSizeMb: parseIntEnv(env.SFTP_MAX_FILE_SIZE_MB, 100, "SFTP_MAX_FILE_SIZE_MB"),
    syncEncryptionKey: env.SYNC_ENCRYPTION_KEY?.trim() || null,
    adminApiToken: env.ADMIN_API_TOKEN?.trim() || null,
    dashboardSessionSecret: env.DASHBOARD_SESSION_SECRET?.trim() || null,
    kvRestApiUrl: env.KV_REST_API_URL?.trim() || env.UPSTASH_REDIS_REST_URL?.trim() || null,
    kvRestApiToken: env.KV_REST_API_TOKEN?.trim() || env.UPSTASH_REDIS_REST_TOKEN?.trim() || null,
    rateLimitFailureMode: parseEnumEnv<"fail-open" | "fail-closed">(
      env.RATE_LIMIT_FAILURE_MODE,
      "fail-open",
      ["fail-open", "fail-closed"],
      "RATE_LIMIT_FAILURE_MODE",
    ),
    // E2E v2 (passphrase) acceptance. Default false: v2 pushes are rejected until
    // a group's fleet is migrated (prevents v1 pullers failing on v2 packages).
    syncAllowE2eV2: parseBoolEnv(env.SYNC_ALLOW_E2E_V2, false),
  };

  if (
    isProduction &&
    config.syncAllowedOrigins.length === 1 &&
    config.syncAllowedOrigins[0] === "*"
  ) {
    // MUST use console.warn directly, NOT the structured logger: log() calls
    // getEnv() → buildEnv(), and emitting from inside buildEnv() (before
    // cachedEnv is assigned) caused infinite recursion (RangeError: Maximum
    // call stack size exceeded) on every request in production whenever
    // SYNC_ALLOWED_ORIGINS="*". Keep env.ts free of the logger dependency.
    console.warn('{"level":"warn","event":"cors.wildcard_in_prod"}');
  }

  if (config.syncEncryptionKey && config.syncEncryptionKey.length < 32) {
    throw new Error("SYNC_ENCRYPTION_KEY must be at least 32 characters");
  }

  if (config.isProduction && config.sftpHost && !config.syncEncryptionKey) {
    throw new Error("Production with SFTP requires SYNC_ENCRYPTION_KEY");
  }

  if (config.isProduction && config.syncAuthMode === "token") {
    if (config.syncApiTokens.size === 0) {
      throw new Error(
        "Production requires SYNC_API_TOKENS when SYNC_AUTH_MODE=token",
      );
    }
  }

  return config;
}

export function getEnv(): AppEnv {
  cachedEnv ??= buildEnv(process.env);
  return cachedEnv;
}

export function resetEnvForTests(): void {
  cachedEnv = null;
}
