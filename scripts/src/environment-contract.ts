export type AppEnvironment =
  | "development"
  | "test"
  | "recovery"
  | "production";

export type DatabaseTarget =
  | "shared-development"
  | "disposable-test"
  | "disposable-recovery"
  | "production";

export type PaymentProviderMode = "disabled" | "sandbox" | "live";
export type StorageMode = "synthetic" | "production";
export type EmailMode = "disabled" | "sandbox" | "live";

const disposableConfirmation = "create-and-drop-disposable-database";

const fail = (message: string): never => {
  throw new Error(`Environment contract refused: ${message}`);
};

export const databaseIdentity = (databaseUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return fail("DATABASE_URL must be a PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return fail("DATABASE_URL must use PostgreSQL");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!parsed.hostname || !databaseName) {
    return fail("DATABASE_URL must identify a host and database name");
  }
  return {
    hostname: parsed.hostname,
    databaseName,
    display: `${parsed.hostname}:${parsed.port || "5432"}/${databaseName}`,
  };
};

const obviousLiveTarget = (hostname: string, databaseName: string): boolean =>
  /(^|[-_.\/])(prod|production|live|client)([-_.\/]|$)/i.test(
    `${hostname}/${databaseName}`,
  );

const disposableTarget = (hostname: string, databaseName: string): boolean =>
  !obviousLiveTarget(hostname, databaseName) &&
  (["127.0.0.1", "localhost", "::1"].includes(hostname) ||
    /(^|[-_.\/])(test|testing|critical|e2e|fixture|check|drill|recovery|restore|legacy|baseline|evidence|ledger|adopted|valid|malformed|later)([-_.\/]|$)/i.test(
      `${hostname}/${databaseName}`,
    ));

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim();
  if (!value) return fail(`${name} must be set`);
  return value;
};

export type EnvironmentContract = {
  appEnvironment: AppEnvironment;
  databaseTarget: DatabaseTarget;
  paymentProviderMode: PaymentProviderMode;
  storageMode: StorageMode;
  emailMode: EmailMode;
  databaseName: string;
};

export const assertEnvironmentContract = (
  env: NodeJS.ProcessEnv = process.env,
  promotion: "test" | "recovery" | "production" = "test",
): EnvironmentContract => {
  const appEnvironment = required(env, "APP_ENVIRONMENT") as AppEnvironment;
  if (!["development", "test", "recovery", "production"].includes(appEnvironment)) {
    return fail("APP_ENVIRONMENT is not recognized");
  }
  const databaseTarget = required(env, "DATABASE_TARGET") as DatabaseTarget;
  if (
    ![
      "shared-development",
      "disposable-test",
      "disposable-recovery",
      "production",
    ].includes(databaseTarget)
  ) {
    return fail("DATABASE_TARGET is not recognized");
  }
  const paymentProviderMode = required(
    env,
    "PAYMENT_PROVIDER_MODE",
  ) as PaymentProviderMode;
  if (!["disabled", "sandbox", "live"].includes(paymentProviderMode)) {
    return fail("PAYMENT_PROVIDER_MODE must be disabled, sandbox, or live");
  }
  const storageMode = required(env, "STORAGE_MODE") as StorageMode;
  if (!["synthetic", "production"].includes(storageMode)) {
    return fail("STORAGE_MODE must be synthetic or production");
  }
  const emailMode = required(env, "EMAIL_MODE") as EmailMode;
  if (!["disabled", "sandbox", "live"].includes(emailMode)) {
    return fail("EMAIL_MODE must be disabled, sandbox, or live");
  }

  const nodeEnvironment = env.NODE_ENV;
  if (
    (appEnvironment === "production" && nodeEnvironment !== "production") ||
    (appEnvironment === "development" && nodeEnvironment !== "development") ||
    (appEnvironment === "test" &&
      nodeEnvironment !== "test" &&
      nodeEnvironment !== "production") ||
    (appEnvironment === "recovery" &&
      nodeEnvironment !== "test" &&
      nodeEnvironment !== "production")
  ) {
    return fail("APP_ENVIRONMENT and NODE_ENV are contradictory");
  }

  const allowedTargets: Record<AppEnvironment, DatabaseTarget[]> = {
    development: ["shared-development", "disposable-test"],
    test: ["disposable-test"],
    recovery: ["disposable-recovery"],
    production: ["production"],
  };
  if (!allowedTargets[appEnvironment].includes(databaseTarget)) {
    return fail("APP_ENVIRONMENT cannot use the selected DATABASE_TARGET");
  }

  const identity = databaseIdentity(required(env, "DATABASE_URL"));
  if (
    databaseTarget !== "production" &&
    (obviousLiveTarget(identity.hostname, identity.databaseName) ||
      (databaseTarget !== "shared-development" &&
        !disposableTarget(identity.hostname, identity.databaseName)))
  ) {
    return fail(
      "non-production runtimes require a clearly disposable or development database identity",
    );
  }
  if (
    databaseTarget === "production" &&
    disposableTarget(identity.hostname, identity.databaseName)
  ) {
    return fail(
      "production cannot use a disposable or local database identity",
    );
  }
  if (
    (databaseTarget === "disposable-test" ||
      databaseTarget === "disposable-recovery") &&
    env.DISPOSABLE_DATABASE_CONFIRMATION !== disposableConfirmation
  ) {
    return fail("explicit disposable-target confirmation is required");
  }
  if (paymentProviderMode === "live" && appEnvironment !== "production") {
    return fail("live payment settings are production-only");
  }
  if (storageMode === "production" && appEnvironment !== "production") {
    return fail("production storage is production-only");
  }
  if (storageMode === "synthetic" && appEnvironment === "production") {
    return fail("production requires production storage mode");
  }
  if (emailMode === "live" && appEnvironment !== "production") {
    return fail("live email delivery is production-only");
  }
  if (appEnvironment === "production" && emailMode === "sandbox") {
    return fail("sandbox email delivery cannot promote to production");
  }
  const providerEnvironment = env.QUICKBOOKS_ENVIRONMENT?.trim().toLowerCase();
  if (
    appEnvironment === "production" &&
    (paymentProviderMode === "sandbox" ||
      providerEnvironment === "sandbox" ||
      providerEnvironment === "test")
  ) {
    return fail("sandbox/test payment settings cannot promote to production");
  }

  if (promotion === "production") {
    if (appEnvironment !== "production" || databaseTarget !== "production") {
      return fail(
        "production promotion requires APP_ENVIRONMENT=production and DATABASE_TARGET=production",
      );
    }
    if (paymentProviderMode === "sandbox" || providerEnvironment === "sandbox" || providerEnvironment === "test") {
      return fail("production promotion cannot use sandbox/test payment settings");
    }
  } else if (promotion === "recovery") {
    if (appEnvironment !== "recovery" || databaseTarget !== "disposable-recovery") {
      return fail("recovery verification requires a disposable recovery target");
    }
  } else if (appEnvironment === "production") {
    return fail("test verification cannot use a production environment");
  }

  return {
    appEnvironment,
    databaseTarget,
    paymentProviderMode,
    storageMode,
    emailMode,
    databaseName: identity.databaseName,
  };
};

export const DISPOSABLE_DATABASE_CONFIRMATION = disposableConfirmation;