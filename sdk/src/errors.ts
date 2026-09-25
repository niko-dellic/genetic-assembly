export interface ErrorDetail {
  code: string;
  stage: string;
  message: string;
  candidateId?: string;
  seed?: number;
  asset?: string;
  cause?: string;
}
export class OptimizationError extends Error {
  constructor(readonly detail: ErrorDetail) {
    super(detail.message);
    this.name = "OptimizationError";
  }
  toJSON() {
    return this.detail;
  }
}
export function errorDetail(
  error: unknown,
  stage: string,
  context: Partial<ErrorDetail> = {},
): ErrorDetail {
  if (error instanceof OptimizationError)
    return { ...error.detail, ...context };
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "OPERATION_FAILED",
    stage,
    message:
      message && message !== "Error"
        ? message
        : `${stage} failed without an error message`,
    ...(error instanceof Error && error.cause !== undefined
      ? { cause: String(error.cause) }
      : {}),
    ...context,
  };
}
