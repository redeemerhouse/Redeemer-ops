import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  authAccountsTable,
  authAccountHousesTable,
  authSessionsTable,
  db,
  housesTable,
} from "@workspace/db";
import { corsOrigins, serverConfig } from "../lib/config";

export const ORGANIZATION_ID = "redeemer-house";
export const SESSION_COOKIE_NAME = "__Host-recovery-session";

export const roles = ["owner_admin", "program_director", "house_manager", "resident"] as const;
export type Role = (typeof roles)[number];

export type Principal = {
  sub: string;
  role: Role;
  organizationId: string;
  houseNames: string[];
  active: true;
  residentId?: number;
  sessionId?: string;
  sessionExpiresAt?: number;
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
  if (payload.sid !== undefined && (typeof payload.sid !== "string" || !/^[a-f0-9-]{20,80}$/.test(payload.sid))) return false;
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
  sessionId?: string;
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
    ...(input.sessionId === undefined ? {} : { sid: input.sessionId }),
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
    const rawPayload = decode(parts[0]);
    const sessionId = isRecord(rawPayload) && typeof rawPayload.sid === "string" ? rawPayload.sid : undefined;
    if (!validPrincipal(rawPayload)) return null;
    return {
      ...rawPayload,
      ...(sessionId ? { sessionId } : {}),
    };
  } catch {
    return null;
  }
}

export function hashSessionToken(token: string): string {
  return createHmac("sha256", "auth-session-token").update(token).digest("hex");
}

function sessionCookie(req: Request): string | null {
  const header = req.header("cookie");
  const match = header?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    // Replit preview and production are both HTTPS at the browser boundary.
    // A __Host- cookie must always carry Secure or standards-compliant browsers
    // reject it before any session request can be made.
    secure: true,
    sameSite: "lax" as const,
    path: "/",
  };
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions(),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function getSessionToken(req: Request): string | null {
  return sessionCookie(req);
}

async function principalFromSession(token: string): Promise<Principal | null> {
  const now = new Date();
  const [row] = await db
    .select({ session: authSessionsTable, account: authAccountsTable })
    .from(authSessionsTable)
    .innerJoin(authAccountsTable, eq(authSessionsTable.accountId, authAccountsTable.id))
    .where(and(
      eq(authSessionsTable.tokenHash, hashSessionToken(token)),
      isNull(authSessionsTable.revokedAt),
      gt(authSessionsTable.expiresAt, now),
      gt(authSessionsTable.absoluteExpiresAt, now),
    ))
    .limit(1);
  if (!row || row.account.deactivatedAt || !row.account.approvedAt || !row.account.emailVerifiedAt) return null;

  const assignments = await db
    .select({ houseName: housesTable.name })
    .from(authAccountHousesTable)
    .innerJoin(housesTable, eq(authAccountHousesTable.houseId, housesTable.id))
    .where(eq(authAccountHousesTable.accountId, row.account.id));
  const houseNames = assignments.map(({ houseName }) => houseName);
  const role = row.account.role as Role;
  if (!roles.includes(role) || row.account.organizationId !== ORGANIZATION_ID) return null;
  if (role === "house_manager" && houseNames.length === 0) return null;
  if (role === "resident" && (!row.account.residentId || houseNames.length === 0)) return null;

  const idleExpiry = new Date(Math.min(
    Date.now() + 12 * 60 * 60 * 1000,
    row.session.absoluteExpiresAt.getTime(),
  ));
  await db.update(authSessionsTable)
    .set({ lastSeenAt: now, expiresAt: idleExpiry })
    .where(eq(authSessionsTable.id, row.session.id));
  return {
    sub: String(row.account.id),
    role,
    organizationId: row.account.organizationId,
    houseNames,
    active: true,
    ...(row.account.residentId === null ? {} : { residentId: row.account.residentId }),
    sessionId: row.session.id.toString(),
    sessionExpiresAt: Math.floor(idleExpiry.getTime() / 1000),
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(row.session.absoluteExpiresAt.getTime() / 1000),
  };
}

export function getPrincipal(res: Response): Principal {
  const principal = res.locals.principal as Principal | undefined;
  if (!principal) throw new Error("Authenticated principal is missing.");
  return principal;
}

function authenticationFailure(res: Response): void {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("WWW-Authenticate", "Bearer");
  res.status(401).json({ error: "Authentication required." });
}

export const authenticate: RequestHandler = async (req, res, next) => {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  let principal: Principal | null = null;
  if (match) {
    const bearerPrincipal = verifyAccessToken(match[1]);
    if (bearerPrincipal?.sessionId) {
      try {
        principal = await principalFromSession(match[1]);
      } catch {
        principal = null;
      }
    } else if (!serverConfig.isProduction) {
      // Signed bearer principals remain available for local integration tests.
      // Production user access must always map to a revocable database session.
      principal = bearerPrincipal;
    }
  }
  const cookieToken = sessionCookie(req);
  if (!principal && cookieToken) {
    const cookiePrincipal = verifyAccessToken(cookieToken);
    if (cookiePrincipal?.sessionId) {
      try {
        principal = await principalFromSession(cookieToken);
      } catch {
        principal = null;
      }
    }
  }
  if (!principal) {
    if (cookieToken) clearSessionCookie(res);
    authenticationFailure(res);
    return;
  }
  res.locals.principal = principal;
  res.locals.actorId = principal.sub;
  next();
};

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.header("origin");
  if (sessionCookie(req) && !origin) {
    res.status(403).json({ error: "Request origin is required." });
    return;
  }
  if (!origin) {
    next();
    return;
  }
  const expected = `${req.protocol}://${req.get("host")}`;
  const allowed = corsOrigins.includes(origin)
    || (!serverConfig.isProduction && origin === expected);
  if (!allowed) {
    res.status(403).json({ error: "Request origin is not allowed." });
    return;
  }
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
