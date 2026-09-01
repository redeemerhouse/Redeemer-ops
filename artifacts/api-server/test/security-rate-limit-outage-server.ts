import { createApp } from "../src/app.ts";
import type { RateLimitStore } from "../src/lib/rateLimitStore.ts";

const retryMs = Number(process.env.API_RATE_LIMIT_STORE_RETRY_MS ?? 100);
let sharedStoreAvailable = false;
let readinessChecks = 0;

const outageStore: RateLimitStore = {
  async increment(_key, _windowMs, now) {
    if (!sharedStoreAvailable) {
      const error = new Error("simulated shared-store outage at postgresql://sensitive.example");
      Object.assign(error, { code: "ECONNREFUSED" });
      throw error;
    }
    return { count: 1, resetAt: now + 60_000 };
  },
  async check() {
    readinessChecks += 1;
    process.stdout.write(`OUTAGE_TEST_READINESS_CHECK ${readinessChecks}\n`);
    if (!sharedStoreAvailable) {
      const error = new Error("simulated shared-store outage at postgresql://sensitive.example");
      Object.assign(error, { code: "ECONNREFUSED" });
      throw error;
    }
  },
};

const server = createApp({
  rateLimitStore: outageStore,
  readinessChecks: {
    database: async () => undefined,
  },
}).listen(0, () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Outage test server did not receive an ephemeral port.");
  }
  process.stdout.write(`OUTAGE_TEST_READY ${address.port}\n`);
});

setTimeout(() => {
  sharedStoreAvailable = true;
  process.stdout.write("OUTAGE_TEST_STORE_RECOVERED\n");
}, retryMs + 25).unref();

const close = () => {
  server.close(() => process.exit(0));
};
process.once("SIGTERM", close);
process.once("SIGINT", close);