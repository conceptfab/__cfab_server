import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  createHash,
  pbkdf2Sync,
} from "node:crypto";
import { getEnv } from "@/lib/config/env";

// --- Types ---

export interface SftpCredentialsPayload {
  host: string;
  port: number;
  protocol: "sftp" | "ftp";
  username: string;
  password: string;
  uploadPath: string;
  downloadPath: string;
  secure?: boolean; // FTP: czy FTPS (AUTH TLS). SFTP: undefined.
  fileEncryptionKey: string; // base64 key for encrypting files on storage
}

export interface EncryptedCredentials {
  encryptedPayload: string; // base64
  iv: string; // base64
  tag: string; // base64 (GCM auth tag)
}

// --- Key derivation ---

function deriveSessionKey(
  masterKey: string,
  sessionId: string,
  purpose: string,
): Buffer {
  // HMAC-based key derivation (simplified HKDF extract+expand)
  const prk = createHmac("sha256", masterKey).update(sessionId).digest();
  const okm = createHmac("sha256", prk).update(purpose).digest();
  return okm; // 32 bytes = AES-256 key
}

/**
 * Klucz grupy — IDENTYCZNY z klientem (`deriveGroupEncryptionKey` w demonie):
 * `hex(SHA-256("timeflow-online-sync-e2e-v1|" + groupId.trim()))`.
 *
 * Creds FTP są szyfrowane TYM kluczem (a nie globalnym SYNC_ENCRYPTION_KEY), więc
 * klient odszyfrowuje je swoim auto-wyprowadzanym kluczem grupy — bez żadnego
 * ręcznego sekretu wklejanego przez użytkownika.
 */
export function deriveGroupKey(groupId: string): string {
  return createHash("sha256")
    .update(`timeflow-online-sync-e2e-v1|${groupId.trim()}`)
    .digest("hex");
}

/** Wersjonowanie schematu klucza E2E (migracja i współistnienie v1/v2). */
export type E2eKeyScheme = "v1-groupid" | "v2-passphrase";

export const E2E_KEY_SCHEMES: readonly E2eKeyScheme[] = [
  "v1-groupid",
  "v2-passphrase",
];

export function isE2eKeyScheme(value: unknown): value is E2eKeyScheme {
  return typeof value === "string" && (E2E_KEY_SCHEMES as readonly string[]).includes(value);
}

// PBKDF2-SHA256 parameters. Wybrane zamiast scrypt dla parytetu cross-platform:
// WebCrypto (web-warstwa demona) nie ma scrypt, ma PBKDF2; Node i Rust też mają.
// Iteracje wg rekomendacji OWASP (PBKDF2-HMAC-SHA256). Wykonywane po stronie
// klienta przy parowaniu i cache'owane — nie per-żądanie.
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_DKLEN = 32;
const PBKDF2_DIGEST = "sha256";

/**
 * E2E v2: klucz pochodzi z sekretu klienta (`passphrase` grupy) — serwer go nie
 * zna, więc nie potrafi odtworzyć klucza (w przeciwieństwie do v1, gdzie sam
 * `groupId` wystarczał). `groupId` pełni rolę soli/kontekstu, NIE materiału klucza.
 * Separator domeny `-v2` rozdziela od kluczy v1.
 *
 * KDF: PBKDF2-HMAC-SHA256 (600k iteracji, dkLen 32) — parametry MUSZĄ być
 * identyczne w Node (serwer), WebCrypto (web demona) i Rust (demon), inaczej
 * klucze się rozjadą. Zmiana parametrów wymaga nowego separatora domeny (`-v3`).
 *
 * UWAGA: serwer NIE posiada `passphrase` w normalnym przepływie produkcyjnym —
 * funkcja parytetu, używana głównie po stronie klienta i w testach.
 */
export function deriveGroupKeyV2(passphrase: string, groupId: string): string {
  if (!passphrase || !groupId.trim()) {
    throw new Error("deriveGroupKeyV2 requires non-empty passphrase and groupId");
  }
  const salt = Buffer.from(`timeflow-online-sync-e2e-v2|${groupId.trim()}`, "utf8");
  const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_DKLEN, PBKDF2_DIGEST);
  return key.toString("hex");
}

// --- Encrypt/Decrypt ---

export function encryptCredentials(
  payload: SftpCredentialsPayload,
  sessionId: string,
  masterKey: string,
): EncryptedCredentials {
  if (!masterKey) {
    throw new Error("credential master key not provided");
  }

  const key = deriveSessionKey(
    masterKey,
    sessionId,
    "credential-encryption",
  );
  const iv = randomBytes(12); // 96-bit IV for GCM

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(payload);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    encryptedPayload: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptCredentials(
  encrypted: EncryptedCredentials,
  sessionId: string,
): SftpCredentialsPayload {
  const env = getEnv();
  if (!env.syncEncryptionKey) {
    throw new Error("SYNC_ENCRYPTION_KEY not configured");
  }

  const key = deriveSessionKey(
    env.syncEncryptionKey,
    sessionId,
    "credential-encryption",
  );
  const iv = Buffer.from(encrypted.iv, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  const ciphertext = Buffer.from(encrypted.encryptedPayload, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf-8")) as SftpCredentialsPayload;
}

// --- File encryption key derivation (internal) ---

function deriveFileEncryptionKey(sessionId: string, masterKey: string): string {
  const key = deriveSessionKey(
    masterKey,
    sessionId,
    "file-encryption",
  );
  return key.toString("base64");
}

// --- Build full credentials payload with file key included ---

export type SftpConnectionInfo = Omit<SftpCredentialsPayload, "fileEncryptionKey">;

export function encryptCredentialsWithFileKey(
  connection: SftpConnectionInfo,
  sessionId: string,
  masterKey: string,
): EncryptedCredentials {
  const fileEncryptionKey = deriveFileEncryptionKey(sessionId, masterKey);
  const payload: SftpCredentialsPayload = { ...connection, fileEncryptionKey };
  return encryptCredentials(payload, sessionId, masterKey);
}
