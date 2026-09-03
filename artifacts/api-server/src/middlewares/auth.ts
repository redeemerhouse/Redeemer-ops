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
import {
  authorize,
  canAccessResident,
  hasHouseScope,
  isAdministrator,
  ORGANIZATION_ID,
  roles,
  type AuthorizationContext,
  type Permission,
  type Role,
  type AccountStatus,
} from "../lib/access-policy";
import { unavailable } from "../lib/serviceFailures";
import { problem } from "./errors";

export {
  authorize,
  canAccessResident,
  hasHouseScope,
  isAdministrator,
  roles,
  type AuthorizationContext,
  type Permission,
  type Role,
  type AccountStatus,
} from "../lib/access-policy";

export const SESSION_COOKIE_NAME = "__Host-recovery-session";
export type Principal = {
  sub: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role: Role | null;
  accountStatus: AccountStatus;
  organizationId: string;
  houseNames: string[];
  active: true;
  residentId?: number;
  sessionId?: string;
  sessionExpiresAt?: number;
  iat: number;
  exp: number;
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
  if (payload.role !== null && !roles.includes(payload.role as Role)) return false;
  if (!["pending", "active", "suspended", "disabled"].includes(payload.accountStatus as string)) return false;
  if (payload.organizationId !== ORGANIZATION_ID) return false;
  if (payload.active !== true) return false;
  if (!Array.isArray(payload.houseNames) || payload.houseNames.some((name) => typeof name !== "string" || name.length > 256)) return false;
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return false;
  if ((payload.exp as number) <= now || (payload.iat as number) > now + 60) return false;
  if ((payload.exp as number) - (payload.iat as number) > 30 * 24 * 60 * 60) return false;
  if (payload.accountStatus === "pending" && (payload.role !== null || payload.houseNames.length > 0 || payload.residentId !== undefined)) return false;
  if (payload.accountStatus === "active" && payload.role === null) return false;
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
  role: Role | null;
  accountStatus?: AccountStatus;
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
    accountStatus: input.accountStatus ?? "active",
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
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
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
  if (!row || row.account.deactivatedAt || !row.account.emailVerifiedAt) return null;

  const assignments = await db
    .select({ houseName: housesTable.name })
    .from(authAccountHousesTable)
    .innerJoin(housesTable, eq(authAccountHousesTable.houseId, housesTable.id))
    .where(eq(authAccountHousesTable.accountId, row.account.id));
  const houseNames = assignments.map(({ houseName }) => houseName);
  const role = row.account.role as Role | null;
  const accountStatus = row.account.accountStatus as AccountStatus;
  if (role !== null && !roles.includes(role) || row.account.organizationId !== ORGANIZATION_ID) return null;
  if (!["pending", "active", "suspended", "disabled"].includes(accountStatus)) return null;
  if (accountStatus !== "pending" && !row.account.approvedAt) return null;
  if (accountStatus === "pending") {
    if (role !== null || row.account.residentId !== null || houseNames.length > 0) return null;
  } else if (accountStatus !== "active") {
    return null;
  } else {
    if (role === null) return null;
    if (role === "house_manager" && houseNames.length === 0) return null;
    if (role === "resident" && (!row.account.residentId || houseNames.length === 0)) return null;
  }

  const idleExpiry = new Date(Math.min(
    Date.now() + 12 * 60 * 60 * 1000,
    row.session.absoluteExpiresAt.getTime(),
  ));
  await db.update(authSessionsTable)
    .set({ lastSeenAt: now, expiresAt: idleExpiry })
    .where(eq(authSessionsTable.id, row.session.id));
  return {
    sub: String(row.account.id),
    email: row.account.email,
    firstName: row.account.firstName,
    lastName: row.account.lastName,
    role,
    accountStatus,
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

function authenticationFailure(req: Request, res: Response): void {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("WWW-Authenticate", "Bearer");
  problem(req, res, 401);
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
      } catch (error) {
        req.log.error({ errorType: error instanceof Error ? error.name : typeof error, correlationId: res.locals.correlationId }, "Session lookup failed");
        next(unavailable("session", "Session verification is temporarily unavailable."));
        return;
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
      } catch (error) {
        req.log.error({ errorType: error instanceof Error ? error.name : typeof error, correlationId: res.locals.correlationId }, "Session lookup failed");
        next(unavailable("session", "Session verification is temporarily unavailable."));
        return;
      }
    }
  }
  if (!principal) {
    if (cookieToken) clearSessionCookie(res);
    authenticationFailure(req, res);
    return;
  }
  res.locals.principal = principal;
  res.locals.actorId = principal.sub;
  next();
};

/** Authentication for the minimal pending session is intentionally separate
 * from authorization to operational data. */
export const requireActiveAccount: RequestHandler = (req, res, next) => {
  authenticate(req, res, () => {
    const principal = getPrincipal(res);
    if (principal.accountStatus !== "active" || principal.role === null) {
      problem(req, res, 403);
      return;
    }
    next();
  });
};

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.header("origin");
  if (sessionCookie(req) && !origin) {
    problem(req, res, 403);
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
    problem(req, res, 403);
    return;
  }
  next();
};

export function requirePermission(permission: Permission, context: (req: Request, res: Response) => AuthorizationContext = () => ({})): RequestHandler {
  return (req, res, next) => {
    const principal = getPrincipal(res);
    if (!authorize(principal, permission, context(req, res))) {
      problem(req, res, 403);
      return;
    }
    next();
  };
}
export function denyNotFound(res: Response): void {
  res.status(404).json({ error: "Not found." });
}
