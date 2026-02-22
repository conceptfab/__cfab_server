import { badRequest, payloadTooLarge, unsupportedMediaType } from "@/lib/http/error";

export interface ParsedJsonBody {
  body: unknown;
  rawBytes: number;
}

export async function parseJsonBody(
  request: Request,
  maxBytes: number,
): Promise<ParsedJsonBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw unsupportedMediaType("Content-Type must be application/json");
  }

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

