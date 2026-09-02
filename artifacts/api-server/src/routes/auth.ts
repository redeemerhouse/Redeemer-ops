import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  auditEventsTable,
  authAccountsTable,
  authAccountHousesTable,
  authActionTokensTable,
  authSessionsTable,
  db,
  housesTable,
  residentsTable,
} from "@workspace/db";
import {
  clearSessionCookie,
  createAccessToken,
  authenticate,
  getPrincipal,
  getSessionToken,
  hashSessionToken,
  isAdministrator,
  roles,
  setSessionCookie,
  type Role,
} from "../middlewares/auth";
import {
  hashActionToken,
  hashPassword,
  newActionToken,
  normalizeEmail,
  validEmail,
  validPassword,
  verifyPassword,
} from "../lib/account-security";
import { sendPasswordResetEmail, sendVerificationEmail } from "../lib/auth-email";
import { getConfiguredRateLimitStore } from "../middlewares/security";
import { unavailable } from "../lib/serviceFailures";
import { parsePositiveIntegerParam } from "../lib/domain-validation";
import { ensureRequestActive } from "../middlewares/security";

const router = Router();
const DUMMY_PASSWORD_HASH = "scrypt$cmVkZWVtZXItYXV0aC1kdW1teQ$B5ioDUzLuYirZubtantWbc7Dg7rYCv2kITy0zU6HesIk-yHNHjXaHGqxJVdNagllmobXJ68z_CaWisJbxg1v4A";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const BOOTSTRAP_LOCK_ID = 821_734_091;

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  next();
});

function safeBody(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
}

function failureKey(req: Request, email: string): string {
  return `auth-login:${createHash("sha256").update(`${req.socket.remoteAddress ?? "unknown"}:${email}`).digest("hex")}`;
}

async function audit(
  req: Request,
  action: string,
  accountId: number | null,
  outcome: "success" | "failure",
  actor = "anonymous",
  metadata?: Record<string, unknown>,
): Promise<void> {
  ensureRequestActive(req);
  await db.insert(auditEventsTable).values({
    action,
    entityType: "auth_account",
    entityId: accountId,
    actor,
    correlationId: req.res?.locals.correlationId,
    outcome,
    metadata,
  });
}

async function auditBestEffort(
  req: Request,
  action: string,
  accountId: number | null,
  outcome: "success" | "failure",
  actor = "anonymous",
): Promise<void> {
  try {
    await audit(req, action, accountId, outcome, actor);
  } catch (error) {
    req.log.error({
      action,
      errorType: error instanceof Error ? error.name : typeof error,
      correlationId: req.res?.locals.correlationId,
    }, "Optional notification audit could not be recorded");
  }
}

async function issueActionToken(req: Request, accountId: number, type: "email_verification" | "password_reset"): Promise<string> {
  const token = newActionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (type === "email_verification" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
  await db.transaction(async (tx) => {
    await tx.update(authActionTokensTable)
      .set({ usedAt: now })
      .where(and(
        eq(authActionTokensTable.accountId, accountId),
        eq(authActionTokensTable.type, type),
        isNull(authActionTokensTable.usedAt),
      ));
    ensureRequestActive(req);
    await tx.insert(authActionTokensTable).values({
      accountId,
      type,
      tokenHash: hashActionToken(token),
      expiresAt,
    });
  });
  return token;
}

async function loadAccountScope(accountId: number) {
  const [account] = await db.select().from(authAccountsTable).where(eq(authAccountsTable.id, accountId)).limit(1);
  if (!account) return null;
  const houses = await db
    .select({ id: housesTable.id, name: housesTable.name })
    .from(authAccountHousesTable)
    .innerJoin(housesTable, eq(authAccountHousesTable.houseId, housesTable.id))
    .where(eq(authAccountHousesTable.accountId, accountId));
  return { account, houses };
}

async function revokeAccountSessions(accountId: number): Promise<void> {
  await db.update(authSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessionsTable.accountId, accountId), isNull(authSessionsTable.revokedAt)));
}

function publicPrincipal(scope: NonNullable<Awaited<ReturnType<typeof loadAccountScope>>>) {
  return {
    id: String(scope.account.id),
    email: scope.account.email,
    role: scope.account.role as Role,
    organizationId: scope.account.organizationId,
    houseNames: scope.houses.map((house) => house.name),
    residentId: scope.account.residentId,
  };
}

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    authenticate(req, res, () => {
      const principal = getPrincipal(res);
      if (!isAdministrator(principal)) {
        res.status(403).json({ error: "You do not have permission to manage accounts." });
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

async function canManageAccount(
  res: Response,
  accountId: number,
  requestedRole?: Role,
): Promise<boolean> {
  const principal = getPrincipal(res);
  if (accountId === Number(principal.sub)) {
    res.status(403).json({ error: "You cannot change your own account access." });
    return false;
  }
  const [target] = await db
    .select({ role: authAccountsTable.role })
    .from(authAccountsTable)
    .where(eq(authAccountsTable.id, accountId))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Not found." });
    return false;
  }
  if (principal.role !== "owner_admin"
    && (target.role === "owner_admin" || requestedRole === "owner_admin")) {
    res.status(403).json({ error: "Only an owner administrator can manage organization ownership." });
    return false;
  }
  return true;
}

function validBootstrapToken(value: string | undefined): boolean {
  const configured = process.env.SESSION_SECRET;
  if (!configured || configured.length < 32 || !value) return false;
  const expected = Buffer.from(configured);
  const received = Buffer.from(value);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

router.post("/auth/bootstrap", async (req, res) => {
  const { email, password } = safeBody(req);
  if (!validBootstrapToken(req.header("x-initial-admin-token"))
    || !validEmail(email)
    || !validPassword(password)) {
    res.status(403).json({ error: "Initial administrator provisioning is not available." });
    return;
  }
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const now = new Date();
  ensureRequestActive(req);
  const accountId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_ID})`);
    const [existing] = await tx.select({ id: authAccountsTable.id }).from(authAccountsTable).limit(1);
    if (existing) return null;
    const [created] = await tx.insert(authAccountsTable).values({
      email: normalized,
      passwordHash,
      role: "owner_admin",
      emailVerifiedAt: now,
      approvedAt: now,
    }).returning({ id: authAccountsTable.id });
    ensureRequestActive(req);
    return created.id;
  });
  if (!accountId) {
    res.status(409).json({ error: "Initial administrator provisioning is not available." });
    return;
  }
  await audit(req, "auth.initial_owner_provisioned", accountId, "success", String(accountId));
  res.status(201).json({ message: "Initial owner administrator provisioned. Sign in to continue." });
});

router.post("/auth/register", async (req, res) => {
  const { email, password } = safeBody(req);
  if (!validEmail(email) || !validPassword(password)) {
    res.status(400).json({ error: "Use a valid email and a password with at least 12 characters, upper and lower case letters, and a number." });
    return;
  }
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  let delivery: { accountId: number; token: string } | null = null;
  try {
    ensureRequestActive(req);
    delivery = await db.transaction(async (tx) => {
      const [account] = await tx.insert(authAccountsTable)
        .values({ email: normalized, passwordHash })
        .returning({ id: authAccountsTable.id });
      const token = newActionToken();
      ensureRequestActive(req);
      await tx.insert(authActionTokensTable).values({
        accountId: account.id,
        type: "email_verification",
        tokenHash: hashActionToken(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      ensureRequestActive(req);
      await tx.insert(auditEventsTable).values({
        action: "auth.account_registered",
        entityType: "auth_account",
        entityId: account.id,
        actor: "anonymous",
        correlationId: res.locals.correlationId,
        outcome: "success",
      });
      return { accountId: account.id, token };
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (code !== "23505") throw unavailable("database", "Account registration is temporarily unavailable.");
    await auditBestEffort(req, "auth.account_registered", null, "failure");
  }
  if (delivery) {
    try {
      await sendVerificationEmail(normalized, delivery.token);
      req.log.info({ accountId: delivery.accountId, actionTokenType: "email_verification" }, "Account verification delivered");
    } catch (error) {
      req.log.error({
        accountId: delivery.accountId,
        errorType: error instanceof Error ? error.name : typeof error,
        correlationId: res.locals.correlationId,
      }, "Account verification delivery failed; verification can be requested again");
      await auditBestEffort(req, "auth.email_verification_requested", delivery.accountId, "failure");
    }
  }
  res.status(202).json({
    message: "If the account can be created, verification and approval instructions will be sent.",
  });
});

router.post("/auth/verification/request", async (req, res) => {
  const { email } = safeBody(req);
  const normalized = validEmail(email) ? normalizeEmail(email) : "";
  const [account] = normalized
    ? await db.select().from(authAccountsTable).where(eq(authAccountsTable.email, normalized)).limit(1)
    : [];
  if (account && !account.emailVerifiedAt && !account.deactivatedAt) {
    try {
      ensureRequestActive(req);
      const token = await issueActionToken(req, account.id, "email_verification");
      await sendVerificationEmail(account.email, token);
      await audit(req, "auth.email_verification_requested", account.id, "success");
    } catch (error) {
      ensureRequestActive(req);
      req.log.error({ accountId: account.id, err: error }, "Account verification delivery failed");
      await auditBestEffort(req, "auth.email_verification_requested", account.id, "failure");
    }
  }
  res.status(202).json({ message: "If an eligible account exists, verification instructions will be sent." });
});

router.post("/auth/verify-email", async (req, res) => {
  const { token } = safeBody(req);
  if (typeof token !== "string" || token.length < 32 || token.length > 200) {
    res.status(400).json({ error: "The verification request is invalid or expired." });
    return;
  }
  const now = new Date();
  const [record] = await db.select().from(authActionTokensTable).where(and(
    eq(authActionTokensTable.tokenHash, hashActionToken(token)),
    eq(authActionTokensTable.type, "email_verification"),
    isNull(authActionTokensTable.usedAt),
    gt(authActionTokensTable.expiresAt, now),
  )).limit(1);
  if (!record) {
    res.status(400).json({ error: "The verification request is invalid or expired." });
    return;
  }
  ensureRequestActive(req);
  const consumed = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(authActionTokensTable).set({ usedAt: now }).where(and(
      eq(authActionTokensTable.id, record.id),
      isNull(authActionTokensTable.usedAt),
      gt(authActionTokensTable.expiresAt, now),
    )).returning({ id: authActionTokensTable.id });
    if (!claimed) return false;
    ensureRequestActive(req);
    await tx.update(authAccountsTable).set({ emailVerifiedAt: now, updatedAt: now }).where(eq(authAccountsTable.id, record.accountId));
    return true;
  });
  if (!consumed) {
    res.status(400).json({ error: "The verification request is invalid or expired." });
    return;
  }
  await audit(req, "auth.email_verified", record.accountId, "success");
  res.json({ message: "Email verified. An administrator must approve the account before sign-in." });
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = safeBody(req);
  const normalized = validEmail(email) ? normalizeEmail(email) : "";
  const key = failureKey(req, normalized || "invalid");
  const loginStore = await getConfiguredRateLimitStore();
  const attempt = await loginStore.increment(key, LOGIN_WINDOW_MS, Date.now());
  if (attempt.count > 5) {
    res.setHeader("Retry-After", Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 1000)));
    res.status(429).json({ error: "Unable to sign in with those credentials." });
    return;
  }

  const [account] = normalized
    ? await db.select().from(authAccountsTable).where(eq(authAccountsTable.email, normalized)).limit(1)
    : [];
  const passwordMatches = typeof password === "string"
    ? await verifyPassword(password, account?.passwordHash ?? DUMMY_PASSWORD_HASH)
    : await verifyPassword("", DUMMY_PASSWORD_HASH);
  const allowed = Boolean(
    account
    && passwordMatches
    && account.emailVerifiedAt
    && account.approvedAt
    && !account.deactivatedAt,
  );
  if (!allowed || !account) {
    await audit(req, "auth.login", account?.id ?? null, "failure");
    res.status(401).json({ error: "Unable to sign in with those credentials." });
    return;
  }

  const scope = await loadAccountScope(account.id);
  if (!scope || (account.role === "house_manager" && scope.houses.length === 0) || (account.role === "resident" && (!account.residentId || scope.houses.length === 0))) {
    await audit(req, "auth.login", account.id, "failure");
    res.status(401).json({ error: "Unable to sign in with those credentials." });
    return;
  }
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const sessionId = randomUUID();
  const token = createAccessToken({
    sub: String(account.id),
    role: account.role as Role,
    houseNames: scope.houses.map((house) => house.name),
    ...(account.residentId === null ? {} : { residentId: account.residentId }),
    sessionId,
    ttlSeconds: 30 * 24 * 60 * 60,
  });
  ensureRequestActive(req);
  await db.insert(authSessionsTable).values({
    accountId: account.id,
    tokenHash: hashSessionToken(token),
    expiresAt,
    absoluteExpiresAt,
    userAgent: req.header("user-agent")?.slice(0, 400) ?? null,
  });
  setSessionCookie(res, token);
  await loginStore.reset?.(key);
  await audit(req, "auth.login", account.id, "success", String(account.id));
  res.json({ user: publicPrincipal(scope), expiresAt: expiresAt.toISOString() });
});

router.post("/auth/logout", async (req, res) => {
  const token = getSessionToken(req);
  if (token) {
    ensureRequestActive(req);
    await db.update(authSessionsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessionsTable.tokenHash, hashSessionToken(token)), isNull(authSessionsTable.revokedAt)));
  }
  clearSessionCookie(res);
  res.status(204).end();
});

router.post("/auth/password-reset/request", async (req, res) => {
  const { email } = safeBody(req);
  const normalized = validEmail(email) ? normalizeEmail(email) : "";
  const [account] = normalized
    ? await db.select().from(authAccountsTable).where(eq(authAccountsTable.email, normalized)).limit(1)
    : [];
  if (account && !account.deactivatedAt) {
    try {
      ensureRequestActive(req);
      const token = await issueActionToken(req, account.id, "password_reset");
      await sendPasswordResetEmail(account.email, token);
      req.log.info({ accountId: account.id, actionTokenType: "password_reset" }, "Password reset delivered");
      await audit(req, "auth.password_reset_requested", account.id, "success");
    } catch (error) {
      ensureRequestActive(req);
      req.log.error({ accountId: account.id, err: error }, "Password reset delivery failed");
      await auditBestEffort(req, "auth.password_reset_requested", account.id, "failure");
    }
  }
  res.status(202).json({ message: "If an eligible account exists, password reset instructions will be sent." });
});

router.post("/auth/password-reset/complete", async (req, res) => {
  const { token, password } = safeBody(req);
  if (typeof token !== "string" || token.length < 32 || token.length > 200 || !validPassword(password)) {
    res.status(400).json({ error: "The reset request is invalid or expired." });
    return;
  }
  const now = new Date();
  const [record] = await db.select().from(authActionTokensTable).where(and(
    eq(authActionTokensTable.tokenHash, hashActionToken(token)),
    eq(authActionTokensTable.type, "password_reset"),
    isNull(authActionTokensTable.usedAt),
    gt(authActionTokensTable.expiresAt, now),
  )).limit(1);
  if (!record) {
    res.status(400).json({ error: "The reset request is invalid or expired." });
    return;
  }
  const passwordHash = await hashPassword(password);
  ensureRequestActive(req);
  const consumed = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(authActionTokensTable).set({ usedAt: now }).where(and(
      eq(authActionTokensTable.id, record.id),
      isNull(authActionTokensTable.usedAt),
      gt(authActionTokensTable.expiresAt, now),
    )).returning({ id: authActionTokensTable.id });
    if (!claimed) return false;
    ensureRequestActive(req);
    await tx.update(authAccountsTable).set({ passwordHash, updatedAt: now }).where(eq(authAccountsTable.id, record.accountId));
    ensureRequestActive(req);
    await tx.update(authSessionsTable).set({ revokedAt: now }).where(and(
      eq(authSessionsTable.accountId, record.accountId),
      isNull(authSessionsTable.revokedAt),
    ));
    return true;
  });
  if (!consumed) {
    res.status(400).json({ error: "The reset request is invalid or expired." });
    return;
  }
  await audit(req, "auth.password_reset_completed", record.accountId, "success");
  clearSessionCookie(res);
  res.json({ message: "Password updated. Sign in again on every device." });
});

router.get("/auth/admin/accounts", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const accounts = await db.select().from(authAccountsTable);
  const assignments = await db
    .select({ accountId: authAccountHousesTable.accountId, id: housesTable.id, name: housesTable.name })
    .from(authAccountHousesTable)
    .innerJoin(housesTable, eq(authAccountHousesTable.houseId, housesTable.id));
  res.json({
    accounts: accounts.map((account) => ({
      id: account.id,
      email: account.email,
      role: account.role,
      residentId: account.residentId,
      emailVerified: Boolean(account.emailVerifiedAt),
      approved: Boolean(account.approvedAt),
      active: !account.deactivatedAt,
      houses: assignments.filter((item) => item.accountId === account.id).map(({ id, name }) => ({ id, name })),
    })),
  });
});

router.post("/auth/admin/accounts/:id/approve", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const accountId = parsePositiveIntegerParam(req.params.id);
  const { role, houseIds, residentId } = safeBody(req);
  if (accountId === null || !roles.includes(role as Role) || !Array.isArray(houseIds) || houseIds.some((id) => !Number.isInteger(id) || Number(id) <= 0)) {
    res.status(400).json({ error: "Invalid account assignment." });
    return;
  }
  if (!await canManageAccount(res, accountId, role as Role)) return;
  const uniqueHouseIds = [...new Set(houseIds as number[])];
  if (role === "house_manager" && uniqueHouseIds.length === 0) {
    res.status(400).json({ error: "House managers require at least one house assignment." });
    return;
  }
  if (role === "resident" && (!Number.isInteger(residentId) || Number(residentId) <= 0 || uniqueHouseIds.length !== 1)) {
    res.status(400).json({ error: "Residents require one resident record and one house assignment." });
    return;
  }
  if (uniqueHouseIds.length) {
    const found = await db.select({ id: housesTable.id }).from(housesTable).where(inArray(housesTable.id, uniqueHouseIds));
    if (found.length !== uniqueHouseIds.length) {
      res.status(400).json({ error: "Invalid account assignment." });
      return;
    }
  }
  if (role === "resident") {
    const [resident] = await db.select({ id: residentsTable.id, home: residentsTable.home })
      .from(residentsTable)
      .where(eq(residentsTable.id, Number(residentId)))
      .limit(1);
    const [house] = await db.select({ name: housesTable.name }).from(housesTable).where(eq(housesTable.id, uniqueHouseIds[0])).limit(1);
    if (!resident || !house || resident.home !== house.name) {
      res.status(400).json({ error: "Resident and house assignments must match." });
      return;
    }
  }
  const now = new Date();
  ensureRequestActive(req);
  await db.transaction(async (tx) => {
    await tx.update(authAccountsTable).set({
      role: role as Role,
      residentId: role === "resident" ? Number(residentId) : null,
      approvedAt: now,
      deactivatedAt: null,
      updatedAt: now,
    }).where(eq(authAccountsTable.id, accountId));
    ensureRequestActive(req);
    await tx.delete(authAccountHousesTable).where(eq(authAccountHousesTable.accountId, accountId));
    if (uniqueHouseIds.length) {
      ensureRequestActive(req);
      await tx.insert(authAccountHousesTable).values(uniqueHouseIds.map((houseId) => ({ accountId, houseId })));
    }
    ensureRequestActive(req);
    await tx.update(authSessionsTable).set({ revokedAt: now }).where(and(
      eq(authSessionsTable.accountId, accountId),
      isNull(authSessionsTable.revokedAt),
    ));
  });
  await audit(req, "auth.account_approved_or_assigned", accountId, "success", getPrincipal(res).sub, { role, houseCount: uniqueHouseIds.length });
  const scope = await loadAccountScope(accountId);
  if (!scope) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  res.json({ account: publicPrincipal(scope) });
});

router.post("/auth/admin/accounts/:id/deactivate", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const accountId = parsePositiveIntegerParam(req.params.id);
  if (accountId === null) {
    res.status(400).json({ error: "Invalid account." });
    return;
  }
  if (!await canManageAccount(res, accountId)) return;
  const now = new Date();
  ensureRequestActive(req);
  await db.transaction(async (tx) => {
    await tx.update(authAccountsTable).set({ deactivatedAt: now, updatedAt: now }).where(eq(authAccountsTable.id, accountId));
    ensureRequestActive(req);
    await tx.update(authSessionsTable).set({ revokedAt: now }).where(and(
      eq(authSessionsTable.accountId, accountId),
      isNull(authSessionsTable.revokedAt),
    ));
  });
  await audit(req, "auth.account_deactivated", accountId, "success", getPrincipal(res).sub);
  res.json({ success: true });
});

router.post("/auth/admin/accounts/:id/reactivate", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const accountId = parsePositiveIntegerParam(req.params.id);
  if (accountId === null) {
    res.status(400).json({ error: "Invalid account." });
    return;
  }
  if (!await canManageAccount(res, accountId)) return;
  ensureRequestActive(req);
  await db.update(authAccountsTable).set({ deactivatedAt: null, updatedAt: new Date() }).where(eq(authAccountsTable.id, accountId));
  await audit(req, "auth.account_reactivated", accountId, "success", getPrincipal(res).sub);
  res.json({ success: true });
});

router.post("/auth/admin/accounts/:id/sessions/revoke", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const accountId = parsePositiveIntegerParam(req.params.id);
  if (accountId === null) {
    res.status(400).json({ error: "Invalid account." });
    return;
  }
  if (!await canManageAccount(res, accountId)) return;
  ensureRequestActive(req);
  await revokeAccountSessions(accountId);
  await audit(req, "auth.sessions_revoked", accountId, "success", getPrincipal(res).sub);
  res.json({ success: true });
});

export default router;