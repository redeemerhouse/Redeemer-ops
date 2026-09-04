export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
  timeoutMs?: number;
  onResponse?: (response: Response) => void;
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;
export type UnauthorizedHandler = (request: {
  method: string;
  url: string;
}) => void;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for token-gated API calls when the token is held by an approved
 * session manager. Web apps must keep the value in memory and never place it
 * in localStorage, sessionStorage, URLs, or logs.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

/**
 * Register a callback for an expired or revoked session. The callback receives
 * only safe request metadata; response bodies are intentionally not exposed.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  _unauthorizedHandler = handler;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

const safeErrorMessages: Record<number, string> = {
  400: "The request could not be processed.",
  401: "Authentication is required.",
  403: "You are not allowed to perform this action.",
  404: "The requested resource was not found.",
  408: "The request timed out.",
  409: "The request conflicts with the current record.",
  413: "The request is too large.",
  429: "Too many requests. Please try again later.",
  500: "The service could not complete the request.",
  503: "The service is temporarily unavailable.",
};

function safeUrl(value: string): string {
  try {
    const url = new URL(value, typeof location === "undefined" ? "http://localhost" : location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] || "/";
  }
}

function correlationId(response: Response, data: unknown): string | undefined {
  const header = response.headers.get("x-correlation-id")?.trim();
  const candidate = header || getStringField(data, "correlationId");
  return candidate && /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate)
    ? candidate
    : undefined;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const supplied = response.status >= 400 && response.status < 500
    ? getStringField(data, "error")
    : undefined;
  const statusMessage = supplied && supplied.length <= 500 && !/[\r\n]/.test(supplied)
    ? supplied
    : safeErrorMessages[response.status] ?? "The request could not be completed.";
  const id = correlationId(response, data);
  return id ? `${statusMessage} Reference: ${id}` : statusMessage;
}

function safeErrorData(response: Response, data: unknown): { error: string; correlationId?: string } {
  const id = correlationId(response, data);
  const supplied = response.status >= 400 && response.status < 500
    ? getStringField(data, "error")
    : undefined;
  return {
    error: supplied && supplied.length <= 500 && !/[\r\n]/.test(supplied)
      ? supplied
      : safeErrorMessages[response.status] ?? "The request could not be completed.",
    ...(id ? { correlationId: id } : {}),
  };
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = safeErrorMessages[response.status] ?? "Request failed.";
    this.data = safeErrorData(response, data) as T;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = safeUrl(response.url || requestInfo.url);
    this.correlationId = correlationId(response, data);
  }
  readonly correlationId?: string;
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly correlationId?: string;

  constructor(
    response: Response,
    requestInfo: { method: string; url: string },
  ) {
    super(
      "The service returned an invalid response.",
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = "The service returned an invalid response.";
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = safeUrl(response.url || requestInfo.url);
    this.correlationId = response.headers.get("x-correlation-id")?.trim() || undefined;
  }
}

export class NetworkError extends Error {
  readonly name = "NetworkError";
  readonly method: string;
  readonly url: string;

  constructor(
    message: string,
    requestInfo: { method: string; url: string },
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.method = requestInfo.method;
    this.url = safeUrl(requestInfo.url);
  }
}

async function readResponseText(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new ResponseParseError(response, requestInfo);
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await readResponseText(response, requestInfo);
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch {
    throw new ResponseParseError(response, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return null;
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch {
    return null;
  }
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }

  return null;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await readResponseText(response, requestInfo);
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

type PreparedRequest = {
  input: RequestInfo | URL;
  init: RequestInit;
  method: string;
  requestInfo: { method: string; url: string };
  responseType: "json" | "text" | "blob" | "auto";
  timeoutMs: number;
  onResponse?: (response: Response) => void;
};

async function fetchWithTimeout(
  prepared: PreparedRequest,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;
  const callerSignal = prepared.init.signal;

  if (callerSignal) {
    if (callerSignal.aborted) {
      throw new NetworkError("The request was cancelled.", prepared.requestInfo);
    }
    const abort = () => controller.abort();
    callerSignal.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => callerSignal.removeEventListener("abort", abort);
  }

  timer = setTimeout(() => controller.abort(), prepared.timeoutMs);
  try {
    return await fetch(prepared.input, { ...prepared.init, signal: controller.signal });
  } catch (error) {
    if (callerSignal?.aborted) {
      throw new NetworkError("The request was cancelled.", prepared.requestInfo);
    }
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw new NetworkError("The request timed out.", prepared.requestInfo);
    }
    throw new NetworkError("The service could not be reached.", prepared.requestInfo);
  } finally {
    if (timer) clearTimeout(timer);
    removeAbortListener?.();
  }
}

async function prepareRequest(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<PreparedRequest> {
  input = applyBaseUrl(input);
  const {
    responseType = "auto",
    onResponse,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    headers: headersInit,
    ...init
  } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("customFetch: timeoutMs must be a positive number.");
  }

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };
  return {
    input,
    init: {
      ...init,
      method,
      headers,
      // The browser session is an HttpOnly cookie. Keep this default here so
      // generated calls and hand-written API helpers share the same boundary.
      credentials: init.credentials ?? "include",
      // Protected records must not survive an expired or changed user session
      // in the browser HTTP cache.
      cache: init.cache ?? "no-store",
    },
    method,
    requestInfo,
    responseType,
    onResponse,
    timeoutMs,
  };
}

async function notifyUnauthorized(requestInfo: { method: string; url: string }, response: Response): Promise<void> {
  if (response.status === 401) {
    _unauthorizedHandler?.(requestInfo);
  }
}

/**
 * Fetch an authenticated endpoint while preserving the raw Response. This is
 * used for downloads that need response headers and for upload flows.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<Response> {
  const prepared = await prepareRequest(input, options);
  const response = await fetchWithTimeout(prepared);
  await notifyUnauthorized(prepared.requestInfo, response);
  prepared.onResponse?.(response);
  return response;
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  const prepared = await prepareRequest(input, options);
  const response = await fetchWithTimeout(prepared);
  await notifyUnauthorized(prepared.requestInfo, response);
  prepared.onResponse?.(response);

  if (!response.ok) {
    const errorData = await parseErrorBody(response, prepared.method);
    throw new ApiError(response, errorData, prepared.requestInfo);
  }

  return (await parseSuccessBody(response, prepared.responseType, prepared.requestInfo)) as T;
}
