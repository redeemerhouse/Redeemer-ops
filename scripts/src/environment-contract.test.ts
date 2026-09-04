import assert from "node:assert/strict";
import test from "node:test";
import { assertEnvironmentContract } from "./environment-contract.js";

const testEnvironment = () => ({
  NODE_ENV: "test",
  APP_ENVIRONMENT: "test",
  DATABASE_TARGET: "disposable-test",
  DISPOSABLE_DATABASE_CONFIRMATION: "create-and-drop-disposable-database",
  PAYMENT_PROVIDER_MODE: "disabled",
  STORAGE_MODE: "synthetic",
  EMAIL_MODE: "disabled",
  DATABASE_URL: "postgresql://test@127.0.0.1:5432/critical_workflow_test",
});

test("accepts an explicitly confirmed disposable test contract", () => {
  const contract = assertEnvironmentContract(testEnvironment(), "test");
  assert.equal(contract.appEnvironment, "test");
  assert.equal(contract.databaseTarget, "disposable-test");
  assert.equal(contract.paymentProviderMode, "disabled");
});

test("rejects a missing disposable-target confirmation", () => {
  const { DISPOSABLE_DATABASE_CONFIRMATION: _confirmation, ...env } =
    testEnvironment();
  assert.throws(
    () => assertEnvironmentContract(env, "test"),
    /explicit disposable-target confirmation is required/,
  );
});

test("rejects production promotion with sandbox payment settings", () => {
  const env = {
    ...testEnvironment(),
    NODE_ENV: "production",
    APP_ENVIRONMENT: "production",
    DATABASE_TARGET: "production",
    PAYMENT_PROVIDER_MODE: "sandbox",
    STORAGE_MODE: "production",
    EMAIL_MODE: "disabled",
    DATABASE_URL: "postgresql://release@db.example:5432/redeemer",
  };
  assert.throws(
    () => assertEnvironmentContract(env, "production"),
    /sandbox\/test payment settings/,
  );
});

test("rejects a production declaration pointed at a disposable database", () => {
  const env = {
    ...testEnvironment(),
    NODE_ENV: "production",
    APP_ENVIRONMENT: "production",
    DATABASE_TARGET: "production",
    PAYMENT_PROVIDER_MODE: "disabled",
    STORAGE_MODE: "production",
    EMAIL_MODE: "disabled",
  };
  assert.throws(
    () => assertEnvironmentContract(env, "production"),
    /production cannot use a disposable or local database identity/,
  );
});