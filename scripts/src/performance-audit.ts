import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import pg from "pg";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
  query_timeout: 20_000,
});

const scales = [100, 1_000, 10_000] as const;
const iterations = 20;
const pageSize = 100;

const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1))];

async function measure<T>(work: () => Promise<T>) {
  const timings: number[] = [];
  let value!: T;
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    value = await work();
    timings.push(performance.now() - started);
  }
  return {
    value,
    p50Ms: Number(percentile(timings, 0.5).toFixed(3)),
    p95Ms: Number(percentile(timings, 0.95).toFixed(3)),
  };
}

const client = await pool.connect();
const output: Record<string, unknown> = {
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    iterations,
    pageSize,
    databasePoolMax: pool.options.max,
  },
  scales: [],
};

try {
  await client.query(`
    CREATE TEMP TABLE perf_residents (
      id integer PRIMARY KEY,
      name text NOT NULL,
      home text NOT NULL,
      status text NOT NULL,
      notes text
    );
    CREATE TEMP TABLE perf_payments (
      id integer PRIMARY KEY,
      resident_id integer NOT NULL,
      amount numeric(10,2) NOT NULL,
      due_date date NOT NULL,
      status text NOT NULL,
      method text
    );
    CREATE INDEX perf_payments_resident_due_idx ON perf_payments (resident_id, due_date DESC, id DESC);
  `);

  for (const scale of scales) {
    await client.query("TRUNCATE perf_payments, perf_residents");
    await client.query(
      `INSERT INTO perf_residents
       SELECT value, 'Resident ' || lpad(value::text, 6, '0'), 'House ' || (value % 4), CASE WHEN value % 8 = 0 THEN 'exited' ELSE 'active' END, repeat('n', 160)
       FROM generate_series(1, $1) value`,
      [scale],
    );
    await client.query(
      `INSERT INTO perf_payments
       SELECT value, ((value - 1) % $1) + 1, 175.00, DATE '2020-01-01' + (value % 2500), CASE WHEN value % 3 = 0 THEN 'paid' ELSE 'due' END, 'Bank transfer'
       FROM generate_series(1, $2) value`,
      [scale, scale * 4],
    );
    await client.query("ANALYZE perf_residents; ANALYZE perf_payments");

    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const cpuStart = process.cpuUsage();
    const heapStart = process.memoryUsage();
    const unbounded = await measure(async () => {
      const result = await client.query("SELECT * FROM perf_residents ORDER BY name, id");
      return Buffer.byteLength(JSON.stringify(result.rows));
    });
    const bounded = await measure(async () => {
      const result = await client.query("SELECT * FROM perf_residents ORDER BY name, id LIMIT $1 OFFSET 0", [pageSize + 1]);
      return Buffer.byteLength(JSON.stringify(result.rows.slice(0, pageSize)));
    });
    const deepestOffset = Math.min(10_000, Math.max(0, scale - pageSize));
    const deepPage = await measure(async () => {
      const result = await client.query("SELECT * FROM perf_residents ORDER BY name, id LIMIT $1 OFFSET $2", [pageSize + 1, deepestOffset]);
      return Buffer.byteLength(JSON.stringify(result.rows.slice(0, pageSize)));
    });
    const residentPayments = await measure(async () => {
      const result = await client.query(
        "SELECT * FROM perf_payments WHERE resident_id = 1 ORDER BY due_date DESC, id DESC LIMIT $1 OFFSET 0",
        [pageSize + 1],
      );
      return Buffer.byteLength(JSON.stringify(result.rows.slice(0, pageSize)));
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    delay.disable();
    const cpu = process.cpuUsage(cpuStart);
    const heapEnd = process.memoryUsage();
    const plan = await client.query(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM perf_payments WHERE resident_id = 1 ORDER BY due_date DESC, id DESC LIMIT 101",
    );

    (output.scales as unknown[]).push({
      records: scale,
      relatedPayments: scale * 4,
      unboundedResidents: { p50Ms: unbounded.p50Ms, p95Ms: unbounded.p95Ms, responseBytes: unbounded.value },
      boundedResidents: { p50Ms: bounded.p50Ms, p95Ms: bounded.p95Ms, responseBytes: bounded.value },
      deepestBoundedResidents: { offset: deepestOffset, p50Ms: deepPage.p50Ms, p95Ms: deepPage.p95Ms, responseBytes: deepPage.value },
      boundedResidentPayments: { p50Ms: residentPayments.p50Ms, p95Ms: residentPayments.p95Ms, responseBytes: residentPayments.value },
      process: {
        cpuUserMs: Number((cpu.user / 1_000).toFixed(2)),
        cpuSystemMs: Number((cpu.system / 1_000).toFixed(2)),
        rssBytes: heapEnd.rss,
        heapUsedDeltaBytes: heapEnd.heapUsed - heapStart.heapUsed,
        eventLoopP99Ms: Number((delay.percentile(99) / 1e6).toFixed(3)),
      },
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      paymentPlan: plan.rows[0]["QUERY PLAN"][0],
    });
  }
} finally {
  client.release();
  await pool.end();
}

console.log(JSON.stringify(output, null, 2));