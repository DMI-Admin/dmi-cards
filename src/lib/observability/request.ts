import { randomUUID } from "node:crypto";

const requestIdPattern = /^[a-zA-Z0-9._:-]{8,100}$/;

export function requestIdFromRequest(request: Request) {
  const inbound =
    request.headers.get("x-request-id") ||
    request.headers.get("x-correlation-id") ||
    "";
  const trimmed = inbound.trim();

  if (requestIdPattern.test(trimmed)) {
    return trimmed;
  }

  return randomUUID();
}

export function withRequestIdHeader<T extends Response>(response: T, requestId: string) {
  response.headers.set("x-request-id", requestId);
  return response;
}
