import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
  };
};

type ApiSuccessBody<T> = {
  data: T;
};

export class ApiRouteError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500;
  code: ApiErrorCode;

  constructor(
    status: ApiRouteError["status"],
    code: ApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ApiRouteError";
    this.status = status;
    this.code = code;
  }
}

export function apiSuccess<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccessBody<T>>({ data }, init);
}

export function apiError(
  status: ApiRouteError["status"],
  code: ApiErrorCode,
  message: string
) {
  return NextResponse.json<ApiErrorBody>(
    {
      error: {
        code,
        message,
      },
    },
    { status }
  );
}

export function apiErrorFromUnknown(error: unknown) {
  if (error instanceof ApiRouteError) {
    return apiError(error.status, error.code, error.message);
  }

  console.error("[DMI api] unexpected error", {
    name: error instanceof Error ? error.name : "UnknownError",
  });

  return apiError(
    500,
    "INTERNAL_ERROR",
    "Something went wrong. Please try again."
  );
}
