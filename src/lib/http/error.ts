export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly expose: boolean;
  readonly details?: Record<string, unknown>;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    expose?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "AppError";
    this.status = params.status;
    this.code = params.code;
    this.expose = params.expose ?? true;
    this.details = params.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function badRequest(
  message: string,
  code = "bad_request",
  details?: Record<string, unknown>,
): AppError {
  return new AppError({ status: 400, code, message, details });
}

export function unauthorized(
  message = "Unauthorized",
  code = "unauthorized",
): AppError {
  return new AppError({ status: 401, code, message });
}

export function forbidden(message = "Forbidden", code = "forbidden"): AppError {
  return new AppError({ status: 403, code, message });
}

export function payloadTooLarge(
  message = "Payload too large",
  code = "payload_too_large",
): AppError {
  return new AppError({ status: 413, code, message });
}

export function unsupportedMediaType(
  message = "Unsupported media type",
  code = "unsupported_media_type",
): AppError {
  return new AppError({ status: 415, code, message });
}

export function tooManyRequests(
  message = "Too many requests",
  code = "rate_limited",
  details?: Record<string, unknown>,
): AppError {
  return new AppError({ status: 429, code, message, details });
}

export function serviceUnavailable(
  message = "Service temporarily unavailable",
  code = "service_unavailable",
  details?: Record<string, unknown>,
): AppError {
  return new AppError({ status: 503, code, message, details });
}

export function internalServerError(): AppError {
  return new AppError({
    status: 500,
    code: "internal_error",
    message: "Internal server error",
    expose: false,
  });
}

