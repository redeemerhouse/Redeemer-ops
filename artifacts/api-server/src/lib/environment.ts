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

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Environment contract is incomplete: ${name} must be set.`);
  }
  return value;
};

const databaseIdentity = (databaseUrl: string): {
  hostname: string;
  databaseName: string;
} => {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Environment contract is invalid: DATABASE_URL must be a PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Environment contract is invalid: DATABASE_URL must use PostgreSQL.");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!parsed.hostname || !databaseName) {
    throw new Error("Environment contract is invalid: DATABASE_URL must identify a database.");
  }
  return { hostname: parsed.hostname, databaseName };
};

const isObviousLiveTarget = (hostname: string, databaseName: string): boolean =>
  /(^|[-_.\/])(prod|production|live|client)([-_.\/]|$)/i.test(
    `${hostname}/${databaseName}`,
  );

const isDisposableTarget = (hostname: string, databaseName: string): boolean =>
  !isObviousLiveTarget(hostname, databaseName) &&
  (["127.0.0.1", "localhost", "::1"].includes(hostname) ||
    /(^|[-_.\/])(test|testing|critical|e2e|fixture|check|drill|recovery|restore|legacy|baseline|evidence|ledger|adopted|valid|malformed|later)([-_.\/]|$)/i.test(
      `${hostname}/${databaseName}`,
    ));

export type EnvironmentContract = {
  appEnvironment: AppEnvironment;
  databaseTarget: DatabaseTarget;
  paymentProviderMode: PaymentProviderMode;
  storageMode: StorageMode;
  emailMode: EmailMode;
  databaseName: string;
};

export function assertEnvironmentContract(): EnvironmentContract {
  const appEnvironment = required("APP_ENVIRONMENT") as AppEnvironment;
  if (!["development", "test", "recovery", "production"].includes(appEnvironment)) {
    throw new Error(
      "Environment contract is invalid: APP_ENVIRONMENT must be development, test, recovery, or production.",
    );
  }

  const databaseTarget = required("DATABASE_TARGET") as DatabaseTarget;
  if (
    ![
      "shared-development",
      "disposable-test",
      "disposable-recovery",
      "production",
    ].includes(databaseTarget)
  ) {
    throw new Error(
      "Environment contract is invalid: DATABASE_TARGET is not a recognized target.",
    );
  }

  const paymentProviderMode = required(
    "PAYMENT_PROVIDER_MODE",
  ) as PaymentProviderMode;
  if (!["disabled", "sandbox", "live"].includes(paymentProviderMode)) {
    throw new Error(
      "Environment contract is invalid: PAYMENT_PROVIDER_MODE must be disabled, sandbox, or live.",
    );
  }
  const storageMode = required("STORAGE_MODE") as StorageMode;
  if (!["synthetic", "production"].includes(storageMode)) {
    throw new Error(
      "Environment contract is invalid: STORAGE_MODE must be synthetic or production.",
    );
  }
  const emailMode = required("EMAIL_MODE") as EmailMode;
  if (!["disabled", "sandbox", "live"].includes(emailMode)) {
    throw new Error(
      "Environment contract is invalid: EMAIL_MODE must be disabled, sandbox, or live.",
    );
  }

  const nodeEnvironment = process.env.NODE_ENV;
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
    throw new Error(
      "Environment contract is contradictory: APP_ENVIRONMENT and NODE_ENV do not describe the same runtime.",
    );
  }

  const allowedTargets: Record<AppEnvironment, DatabaseTarget[]> = {
    development: ["shared-development", "disposable-test"],
    test: ["disposable-test"],
    recovery: ["disposable-recovery"],
    production: ["production"],
  };
  if (!allowedTargets[appEnvironment].includes(databaseTarget)) {
    throw new Error(
      "Environment contract is contradictory: APP_ENVIRONMENT cannot use the selected DATABASE_TARGET.",
    );
  }

  const databaseUrl = required("DATABASE_URL");
  const identity = databaseIdentity(databaseUrl);
  if (
    databaseTarget !== "production" &&
    (isObviousLiveTarget(identity.hostname, identity.databaseName) ||
      (databaseTarget !== "shared-development" &&
        !isDisposableTarget(identity.hostname, identity.databaseName)))
  ) {
    throw new Error(
      "Environment contract refused the database target: non-production runtimes require a clearly disposable or development database identity.",
    );
  }
  if (
    databaseTarget === "production" &&
    isDisposableTarget(identity.hostname, identity.databaseName)
  ) {
    throw new Error(
      "Environment contract refused the database target: production cannot use a disposable or local database identity.",
    );
  }

  if (databaseTarget === "disposable-test" || databaseTarget === "disposable-recovery") {
    if (process.env.DISPOSABLE_DATABASE_CONFIRMATION !== disposableConfirmation) {
      throw new Error(
        "Environment contract refused the database target: explicit disposable-target confirmation is required.",
      );
    }
  }
  if (databaseTarget === "shared-development" && process.env.ALLOW_PILOT_SEED === "true") {
    throw new Error(
      "Environment contract refused pilot seed: synthetic seed data requires a disposable database target.",
    );
  }

  if (paymentProviderMode === "live" && appEnvironment !== "production") {
    throw new Error(
      "Environment contract refused payment configuration: live payment settings are production-only.",
    );
  }
  if (storageMode === "production" && appEnvironment !== "production") {
    throw new Error(
      "Environment contract refused storage configuration: production storage is production-only.",
    );
  }
  if (storageMode === "synthetic" && appEnvironment === "production") {
    throw new Error(
      "Environment contract refused storage configuration: production requires production storage mode.",
    );
  }
  if (emailMode === "live" && appEnvironment !== "production") {
    throw new Error(
      "Environment contract refused email configuration: live email delivery is production-only.",
    );
  }
  if (
    appEnvironment === "production" &&
    emailMode === "sandbox"
  ) {
    throw new Error(
      "Environment contract refused email configuration: sandbox email delivery cannot promote to production.",
    );
  }
  if (
    appEnvironment === "production" &&
    (paymentProviderMode === "sandbox" ||
      process.env.QUICKBOOKS_ENVIRONMENT?.trim().toLowerCase() === "sandbox" ||
      process.env.QUICKBOOKS_ENVIRONMENT?.trim().toLowerCase() === "test")
  ) {
    throw new Error(
      "Environment contract refused payment configuration: sandbox/test payment settings cannot promote to production.",
    );
  }

  return {
    appEnvironment,
    databaseTarget,
    paymentProviderMode,
    storageMode,
    emailMode,
    databaseName: identity.databaseName,
  };
}

export const DISPOSABLE_DATABASE_CONFIRMATION = disposableConfirmation;