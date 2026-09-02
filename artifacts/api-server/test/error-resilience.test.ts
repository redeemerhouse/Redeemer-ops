import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import {
  ApiError,
  NetworkError,
  ResponseParseError,
  customFetch,
} from "../../../lib/api-client-react/src/custom-fetch.ts";
import { classifyDependencyFailure } from "../src/lib/dependencyDiagnostics.ts";
import { ObjectStorageService } from "../src/lib/objectStorage.ts";
import { unavailable } from "../src/lib/serviceFailures.ts";
import { errorHandler } from "../src/middlewares/errors.ts";

test("unexpected and dependency failures use one privacy-safe API boundary", async () => {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.correlationId = "resilience-test-id";
    res.setHeader("X-Correlation-ID", "resilience-test-id");
    next();
  });
  app.get("/unexpected", async () => {
    throw new Error("resident@example.test password=secret SELECT * FROM residents");
  });
  app.get("/unavailable", async () => {
    throw unavailable("database", "postgres://user:password@private-host/database");
  });
  app.use(errorHandler);

  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const unexpected = await fetch(`http://127.0.0.1:${address.port}/unexpected`);
    assert.equal(unexpected.status, 500);
    assert.deepEqual(await unexpected.json(), {
      error: "An unexpected error occurred.",
      correlationId: "resilience-test-id",
    });

    const unavailableResponse = await fetch(`http://127.0.0.1:${address.port}/unavailable`);
    assert.equal(unavailableResponse.status, 503);
    const body = JSON.stringify(await unavailableResponse.json());
    assert.match(body, /temporarily unavailable/);
    assert.match(body, /resilience-test-id/);
    assert.doesNotMatch(body, /password|postgres|resident|SELECT/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("dependency classification emits categories without returning provider details", () => {
  assert.equal(classifyDependencyFailure({ code: "ECONNREFUSED" }), "connectivity");
  assert.equal(classifyDependencyFailure({ code: "42P01" }), "migration");
  assert.equal(classifyDependencyFailure({ code: "42501" }), "permissions");
  assert.equal(classifyDependencyFailure(new Error("certificate verify failed")), "tls");
});

test("client errors stay bounded and replace raw response or network details", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: "SQL failed for resident@example.test", stack: "secret stack" }),
      { status: 500, headers: { "content-type": "application/json", "x-correlation-id": "safe-ref" } },
    );
    await assert.rejects(
      customFetch("https://example.test/api/private", { responseType: "json" }),
      (error: unknown) => {
        assert(error instanceof ApiError);
        assert.match(error.message, /safe-ref/);
        assert.doesNotMatch(error.message, /SQL|resident|stack/i);
        return true;
      },
    );

    globalThis.fetch = async () => new Response("{not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      customFetch("https://example.test/api/malformed", { responseType: "json" }),
      ResponseParseError,
    );

    globalThis.fetch = async () => {
      throw new TypeError("connect ECONNREFUSED private-host:5432");
    };
    await assert.rejects(
      customFetch("https://example.test/api/network", { responseType: "json" }),
      (error: unknown) => {
        assert(error instanceof NetworkError);
        assert.equal(error.message, "The service could not be reached.");
        return true;
      },
    );

    globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    });
    await assert.rejects(
      customFetch("https://example.test/api/hung", { responseType: "json", timeoutMs: 10 }),
      (error: unknown) => {
        assert(error instanceof NetworkError);
        assert.equal(error.message, "The request timed out.");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("object-storage provider failures stay inside the affected workflow", async () => {
  const originalFetch = globalThis.fetch;
  const originalDir = process.env.PRIVATE_OBJECT_DIR;
  process.env.PRIVATE_OBJECT_DIR = "/test-bucket/private";
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ unexpected: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      new ObjectStorageService().uploadUrl(),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.equal(error.name, "ServiceFailure");
        assert.doesNotMatch(error.message, /signed_url|test-bucket/i);
        return true;
      },
    );

    globalThis.fetch = async () => new Response("provider details", { status: 503 });
    await assert.rejects(
      new ObjectStorageService().uploadUrl(),
      (error: unknown) => error instanceof Error && error.name === "ServiceFailure",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = originalDir;
  }
});