import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export const ORGANIZATION_ID = "redeemer-house";
export const SESSION_COOKIE_NAME = "__Host-recovery-session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const roles = ["owner_admin", "program_director", "house_manager", "resident"] as const;
export type Role = (typeof roles)[number];

export type Principal = {
  sub: string;
  role: Role;
  organizationId: string;
  houseNames: string[];
  active: true;
  residentId?: number;
  iat: number;
  exp: number;
};

export type Permission =
  | "dashboard:read"
  | "activity:read"
  | "resident:list"
  | "resident:read"
  | "resident:create"
  | "resident:update"
  | "payment:list"
  | "payment:create"
  | "expense:list"
  | "expense:create"
  | "income:list"
  | "income:create"
  | "meeting:list"
  | "meeting:create"
  | "house:list"
  | "report:read"
  | "report:export"
  | "resident:import"
  | "assessment:read"
  | "assessment:create"
  | "assessment:update"
  | "assessment:submit"
  | "assessment:manage";

type AuthorizationContext = {
  houseName?: string;
  residentId?: number;
  targetHouseName?: string;
};

const TOKEN_ISSUER = "recovery-housing-operations";
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function secret(): string | null {
  const value = process.env.SESSION_SECRET;
  return value && value.length >= 32 ? value : null;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function signature(input: string, key: string): string {
  return createHmac("sha256", key).update(input).digest("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validPrincipal(payload: unknown, now = Math.floor(Date.now() / 1000)): payload is Principal {
  if (!isRecord(payload)) return false;
  if (payload.iss !== TOKEN_ISSUER) return false;
  if (typeof payload.sub !== "string" || payload.sub.length < 1 || payload.sub.length > 256) return false;
  if (!roles.includes(payload.role as Role)) return false;
  if (payload.organizationId !== ORGANIZATION_ID) return false;
  if (payload.active !== true) return false;
  if (!Array.isArray(payload.houseNames) || payload.houseNames.some((name) => typeof name !== "string" || name.length > 256)) return false;
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return false;
  if ((payload.exp as number) <= now || (payload.iat as number) > now + 60) return false;
  if ((payload.exp as number) - (payload.iat as number) > 30 * 24 * 60 * 60) return false;
  if (payload.role === "house_manager" && payload.houseNames.length === 0) return false;
  if (payload.role === "resident" && (!Number.isInteger(payload.residentId) || (payload.residentId as number) <= 0)) return false;
  return true;
}

/**
 * Creates the compact bearer token consumed by authenticate. The identity
 * service should call this after loading approved, server-managed role and
 * house assignments; callers must never build these claims from request data.
 */
export function createAccessToken(input: {
  sub: string;
  role: Role;
  organizationId?: string;
  houseNames?: string[];
  residentId?: number;
  now?: number;
  ttlSeconds?: number;
}, configuredSecret = secret()): string {
  if (!configuredSecret) throw new Error("SESSION_SECRET must be configured for authenticated access.");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload = {
    iss: TOKEN_ISSUER,
    sub: input.sub,
    role: input.role,
    organizationId: input.organizationId ?? ORGANIZATION_ID,
    houseNames: input.houseNames ?? [],
    active: true,
    ...(input.residentId === undefined ? {} : { residentId: input.residentId }),
    iat: now,
    exp: now + Math.min(input.ttlSeconds ?? TOKEN_TTL_SECONDS, 30 * 24 * 60 * 60),
  };
  if (!validPrincipal(payload, now - 1)) throw new Error("Invalid access token claims.");
  const encoded = encode(payload);
  return `${encoded}.${signature(encoded, configuredSecret)}`;
}

function verifyAccessToken(token: string, configuredSecret = secret()): Principal | null {
  if (!configuredSecret) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(signature(parts[0], configuredSecret));
  const received = Buffer.from(parts[1]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const payload = decode(parts[0]);
    return validPrincipal(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function getPrincipal(res: Response): Principal {
  const principal = res.locals.principal as Principal | undefined;
  if (!principal) throw new Error("Authenticated principal is missing.");
  return principal;
}

function authenticationFailure(res: Response): void {
  res.setHeader("WWW-Authenticate", "Bearer");
  res.status(401).json({ error: "Authentication required." });
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function accessTokenFromRequest(req: Request): string | null {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? cookieValue(req.header("cookie"), SESSION_COOKIE_NAME);
}

function requestOriginIsSameHost(req: Request): boolean {
  const origin = req.header("origin");
  const host = req.header("x-forwarded-host") ?? req.header("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.split(",", 1)[0].trim().toLowerCase();
  } catch {
    return false;
  }
}

export const authenticate: RequestHandler = (req, res, next) => {
  const authorization = req.header("authorization");
  const bearerMatch = authorization?.match(/^Bearer ([^\s]+)$/i);
  const cookieToken = cookieValue(req.header("cookie"), SESSION_COOKIE_NAME);
  const token = bearerMatch?.[1] ?? cookieToken;
  const principal = token ? verifyAccessToken(token) : null;
  if (!principal) {
    authenticationFailure(res);
    return;
  }
  if (!bearerMatch && cookieToken && !SAFE_METHODS.has(req.method) && !requestOriginIsSameHost(req)) {
    res.status(403).json({ error: "Request origin could not be verified." });
    return;
  }
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  res.locals.principal = principal;
  next();
};

export function requirePermission(permission: Permission, context: (req: Request, res: Response) => AuthorizationContext = () => ({})): RequestHandler {
  return (req, res, next) => {
    const principal = getPrincipal(res);
    if (!authorize(principal, permission, context(req, res))) {
      res.status(403).json({ error: "You do not have permission to perform this action." });
      return;
    }
    next();
  };
}

export function isAdministrator(principal: Principal): boolean {
  return principal.role === "owner_admin" || principal.role === "program_director";
}

export function hasHouseScope(principal: Principal, houseName: string): boolean {
  return isAdministrator(principal) || (principal.role === "house_manager" && principal.houseNames.includes(houseName));
}

export function canAccessResident(principal: Principal, resident: { id: number; home: string }, write = false): boolean {
  if (isAdministrator(principal)) return true;
  if (principal.role === "house_manager") return principal.houseNames.includes(resident.home);
  return !write && principal.role === "resident" && principal.residentId === resident.id;
}

export function authorize(principal: Principal, permission: Permission, context: AuthorizationContext = {}): boolean {
  if (principal.organizationId !== ORGANIZATION_ID) return false;
  const isResident = principal.role === "resident";
  const isManager = principal.role === "house_manager";
  const isAdmin = isAdministrator(principal);

  if (permission === "dashboard:read" || permission === "activity:read" || permission === "report:read") {
    return isAdmin || isManager;
  }
  if (permission === "report:export") return isAdmin;
  if (permission === "resident:import") return isAdmin || isManager;
  if (permission === "resident:list") return isAdmin || isManager || isResident;
  if (permission === "resident:create") {
    return (isAdmin || isManager) && (!context.targetHouseName || hasHouseScope(principal, context.targetHouseName));
  }
  if (permission === "resident:read" || permission === "resident:update") {
    if (context.houseName && !hasHouseScope(principal, context.houseName)) return false;
    if (context.residentId !== undefined && isResident && context.residentId !== principal.residentId) return false;
    return permission === "resident:read"
      ? isAdmin || isManager || isResident
      : isAdmin || isManager;
  }
  if (permission === "payment:list") {
    if (context.houseName && !hasHouseScope(principal, context.houseName)) return false;
    if (context.residentId !== undefined && isResident && context.residentId !== principal.residentId) return false;
    return isAdmin || isManager || isResident;
  }
  if (permission === "payment:create") {
    return (isAdmin || isManager) && (!context.houseName || hasHouseScope(principal, context.houseName));
  }
  if (permission === "expense:list" || permission === "expense:create" || permission === "income:list" || permission === "income:create") {
    return isAdmin;
  }
  if (permission === "meeting:list" || permission === "meeting:create") {
    return (isAdmin || isManager) && (!context.houseName || hasHouseScope(principal, context.houseName));
  }
  if (permission === "house:list") return isAdmin || isManager || isResident;
  if (permission === "assessment:read" || permission === "assessment:create" || permission === "assessment:update" || permission === "assessment:submit") {
    if (context.houseName && !hasHouseScope(principal, context.houseName)) return false;
    if (context.residentId !== undefined && isResident && context.residentId !== principal.residentId) return false;
    if (permission === "assessment:read") return isAdmin || isManager || isResident;
    return isAdmin || isManager || isResident;
  }
  if (permission === "assessment:manage") return isAdmin;
  return false;
}

export function denyNotFound(res: Response): void {
  res.status(404).json({ error: "Not found." });
}
