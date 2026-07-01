import { gunzipSync } from "node:zlib";
import { badRequest, payloadTooLarge, unsupportedMediaType } from "@/lib/http/error";
import { assertJsonStructure, type JsonStructureLimits } from "@/lib/http/json-guard";

export interface ParsedJsonBody {
  body: unknown;
  rawBytes: number;
  compressedBytes?: number;
}

export async function parseJsonBody(
  request: Request,
  maxBytes: number,
  structureLimits?: JsonStructureLimits,
): Promise<ParsedJsonBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw unsupportedMediaType("Content-Type must be application/json");
  }

  const contentEncoding = (request.headers.get("content-encoding") ?? "").toLowerCase();
  const isGzip = contentEncoding === "gzip";

  if (isGzip) {
    // Read compressed bytes, decompress, then parse
    const compressedBuf = Buffer.from(await request.arrayBuffer());
    const compressedBytes = compressedBuf.length;

    // Limit compressed payload to 2x maxBytes (gzip can't expand more than ~1000x)
    if (compressedBytes > maxBytes * 2) {
      throw payloadTooLarge(
        `Compressed body exceeds limit (${compressedBytes} bytes)`,
      );
    }

    let decompressed: Buffer;
    try {
      decompressed = gunzipSync(compressedBuf);
    } catch {
      throw badRequest("Invalid gzip body", "invalid_gzip");
    }

    const rawBytes = decompressed.length;
    if (rawBytes > maxBytes) {
      throw payloadTooLarge(
        `Decompressed body exceeds limit (${rawBytes} > ${maxBytes} bytes)`,
      );
    }

    const raw = decompressed.toString("utf8");
    if (raw.trim().length === 0) {
      throw badRequest("Request body is empty");
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (structureLimits) assertJsonStructure(parsed, structureLimits);
      return { body: parsed, rawBytes, compressedBytes };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw badRequest("Invalid JSON body", "invalid_json");
      }
      throw error;
    }
  }

  // Uncompressed path (original logic)
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw payloadTooLarge(
        `Request body exceeds limit (${contentLength} > ${maxBytes} bytes)`,
      );
    }
  }

  const raw = await request.text();
  const rawBytes = new TextEncoder().encode(raw).length;
  if (rawBytes > maxBytes) {
    throw payloadTooLarge(
      `Request body exceeds limit (${rawBytes} > ${maxBytes} bytes)`,
    );
  }
  if (raw.trim().length === 0) {
    throw badRequest("Request body is empty");
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (structureLimits) assertJsonStructure(parsed, structureLimits);
    return { body: parsed, rawBytes };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw badRequest("Invalid JSON body", "invalid_json");
    }
    throw error;
  }
}

export function getClientIp(request: Request): string | null {
  // Trust the platform-injected header first (Vercel sets x-real-ip at the edge).
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  // Fallback: the LAST (right-most) XFF entry is the hop appended by the trusted
  // proxy. Left-most entries are client-controlled and MUST NOT be trusted.
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return null;
}

function getFirstForwardedHeaderValue(request: Request, header: string): string | null {
  const raw = request.headers.get(header);
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

export function getRequestOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedHost = getFirstForwardedHeaderValue(request, "x-forwarded-host");
  const forwardedProto = getFirstForwardedHeaderValue(request, "x-forwarded-proto");

  if (forwardedHost) {
    const proto = forwardedProto ?? requestUrl.protocol.replace(":", "");
    return `${proto}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.trim();
  if (host) {
    const proto = forwardedProto ?? requestUrl.protocol.replace(":", "");
    return `${proto}://${host}`;
  }

  return requestUrl.origin;
}

export function buildAbsoluteRequestUrl(request: Request, path: string): URL {
  return new URL(path, getRequestOrigin(request));
}
