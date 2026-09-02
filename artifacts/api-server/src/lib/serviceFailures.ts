export type ServiceFailureKind = "unavailable" | "invalid" | "not_found" | "unexpected";

export type ServiceFailureDependency =
  | "database"
  | "session"
  | "email"
  | "object_storage"
  | "rate_limit";

export class ServiceFailure extends Error {
  readonly name = "ServiceFailure";

  constructor(
    readonly dependency: ServiceFailureDependency,
    readonly kind: ServiceFailureKind,
    message = "A required service is unavailable.",
    readonly status = kind === "not_found" ? 404 : kind === "invalid" ? 400 : 503,
    readonly retryable = kind === "unavailable",
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function unavailable(
  dependency: ServiceFailureDependency,
  message = "A required service is unavailable.",
): ServiceFailure {
  return new ServiceFailure(dependency, "unavailable", message, 503, true);
}

export function notFound(
  dependency: ServiceFailureDependency,
  message = "The requested resource was not found.",
): ServiceFailure {
  return new ServiceFailure(dependency, "not_found", message, 404, false);
}