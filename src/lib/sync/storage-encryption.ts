import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
} from "node:crypto";
import { getEnv } from "@/lib/config/env";

// --- Types ---

export interface SftpCredentialsPayload {
  host: string;
  port: number;
  protocol: "sftp";
  username: string;
  password: string;
  uploadPath: string;
  downloadPath: string;
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

// --- Encrypt/Decrypt ---

export function encryptCredentials(
  payload: SftpCredentialsPayload,
  sessionId: string,
): EncryptedCredentials {
  const env = getEnv();
  if (!env.syncEncryptionKey) {
    throw new Error("SYNC_ENCRYPTION_KEY not configured");
  }

  const key = deriveSessionKey(
    env.syncEncryptionKey,
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

function deriveFileEncryptionKey(sessionId: string): string {
  const env = getEnv();
  if (!env.syncEncryptionKey) {
    throw new Error("SYNC_ENCRYPTION_KEY not configured");
  }

  const key = deriveSessionKey(
    env.syncEncryptionKey,
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
): EncryptedCredentials {
  const fileEncryptionKey = deriveFileEncryptionKey(sessionId);
  const payload: SftpCredentialsPayload = { ...connection, fileEncryptionKey };
  return encryptCredentials(payload, sessionId);
}
