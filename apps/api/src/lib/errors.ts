import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string) =>
  new ApiError(404, "not_found", `${what} not found`);
export const forbidden = (message = "You don't have access to this") =>
  new ApiError(403, "forbidden", message);
export const badRequest = (message: string) =>
  new ApiError(400, "invalid_request", message);
export const conflict = (message: string) =>
  new ApiError(409, "conflict", message);
