export type DependencyFailureCategory =
  | "configuration"
  | "connectivity"
  | "tls"
  | "permissions"
  | "migration"
  | "unknown";

type CodedError = {
  code?: unknown;
  message?: unknown;
};

function errorDetails(error: unknown): { code: string; message: string } {
  if (!error || typeof error !== "object") {
    return { code: "", message: "" };
  }
  const value = error as CodedError;
  return {
    code: typeof value.code === "string" ? value.code.toUpperCase() : "",
    message: typeof value.message === "string" ? value.message.toLowerCase() : "",
  };
}

export function classifyDependencyFailure(error: unknown): DependencyFailureCategory {
  const { code, message } = errorDetails(error);

  if (
    code === "42P01" ||
    code === "42703" ||
    /relation .* does not exist|undefined table|migration|schema/.test(message)
  ) {
    return "migration";
  }
  if (
    code === "42501" ||
    code === "28000" ||
    /permission denied|not owner|authentication failed|invalid authorization/.test(message)
  ) {
    return "permissions";
  }
  if (
    /tls|ssl|certificate|self-signed|secure connection/.test(message) ||
    code === "08004"
  ) {
    return "tls";
  }
  if (
    /database_url|connection string|configuration|password|missing.*(database|secret)|invalid.*(database|secret)/.test(
      message,
    )
  ) {
    return "configuration";
  }
  if (
    code.startsWith("08") ||
    ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT"].includes(code) ||
    /connect|connection|timeout|timed out|socket|econnrefused|enotfound|network/.test(message)
  ) {
    return "connectivity";
  }
  return "unknown";
}