import { gunzipSync } from "node:zlib";
import { badRequest, payloadTooLarge, unsupportedMediaType } from "@/lib/http/error";

export interface ParsedJsonBody {
  body: unknown;
  rawBytes: number;
  compressedBytes?: number;
}

export async function parseJsonBody(
  request: Request,
  maxBytes: number,
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
      return { body: JSON.parse(raw) as unknown, rawBytes, compressedBytes };
    } catch {
      throw badRequest("Invalid JSON body", "invalid_json");
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
    return { body: JSON.parse(raw) as unknown, rawBytes };
  } catch {
    throw badRequest("Invalid JSON body", "invalid_json");
  }
}

export function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
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
