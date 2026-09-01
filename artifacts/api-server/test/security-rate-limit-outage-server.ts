import { createApp } from "../src/app.ts";
import type { RateLimitStore } from "../src/lib/rateLimitStore.ts";

const retryMs = Number(process.env.API_RATE_LIMIT_STORE_RETRY_MS ?? 100);
let sharedStoreAvailable = false;

const outageStore: RateLimitStore = {
  async increment(_key, _windowMs, now) {
    if (!sharedStoreAvailable) {
      throw new Error("simulated shared-store outage at postgresql://sensitive.example");
    }
    return { count: 1, resetAt: now + 60_000 };
  },
};

const server = createApp({ rateLimitStore: outageStore }).listen(0, () => {
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