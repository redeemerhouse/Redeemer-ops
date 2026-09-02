# Redeemer House Application Performance Audit

Date: 2026-09-02

Method: synthetic, non-resident data only. `pnpm --filter @workspace/scripts run performance:audit` creates connection-local temporary PostgreSQL tables at 100, 1,000, and 10,000 resident rows with four payment rows per resident, runs each scenario 20 times, and reports p50/p95 query-plus-JSON time, response bytes, CPU, RSS, heap delta, event-loop p99, pool occupancy, and `EXPLAIN (ANALYZE, BUFFERS)` output. Production bundles were measured with `pnpm run build:production`.

Thresholds used for this audit:

- Collection response: under 500 kB and 100 records by default.
- Synthetic query-plus-serialization p95: under 100 ms.
- Event-loop p99 during the benchmark: under 50 ms.
- Database pool waiting: zero in the single-client benchmark.
- Initial production JavaScript: reduce any measured monolithic route bundle before considering speculative caching or infrastructure changes.

## PERFORMANCE FINDINGS

| Residents | Related payments | Unbounded resident p95 | Unbounded bytes | Bounded resident p95 | Bounded bytes | Resident-payment p95 | Event-loop p99 | RSS | Heap delta | Pool total/idle/waiting |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 400 | 1.578 ms | 24,093 | 0.961 ms | 24,093 | 1.808 ms | 10.289 ms | 99.0 MiB | -0.80 MiB | 1/0/0 |
| 1,000 | 4,000 | 3.652 ms | 241,894 | 0.662 ms | 24,093 | 0.542 ms | 11.026 ms | 111.0 MiB | 10.58 MiB | 1/0/0 |
| 10,000 | 40,000 | 21.153 ms | 2,428,895 | 1.611 ms | 24,093 | 0.685 ms | 21.742 ms | 227.6 MiB | 59.55 MiB | 1/0/0 |

The 10,000-row unbounded response exceeded both the 500 kB response threshold and the API's existing 2 MB response limit. The bounded 100-row response stayed at 24,093 bytes at every larger scale and reduced p95 from 21.153 ms to 1.611 ms at 10,000 rows. This is a verified bottleneck and justified pagination.

The deepest continuation measurement used offset 9,900 at the 10,000-row scale and remained 24,302 bytes with 3.717 ms p95. The API deliberately caps offsets at 10,000, so offset traversal has a measured upper bound rather than accepting arbitrary history depth.

CPU for the complete 80-operation 10,000-row scenario was 307.01 ms user and 120.89 ms system. Event-loop p99 remained below the 50 ms threshold. No pool waiters were observed. These measurements do not justify pool-size changes, caching, queues, or framework replacement.

Production browser assets before the change were one 716,133-byte JavaScript chunk (211.78 kB gzip) and 108,382 bytes of CSS. After route lazy loading, the initial JavaScript chunk is 569,406 bytes (178.95 kB gzip); page chunks range from 1.52 kB to 29.53 kB. Initial minified JavaScript decreased 20.5% and initial gzip decreased 15.5%. CSS remained effectively unchanged at 108,424 bytes.

The Operations route previously started five collection requests on every entry: applications, houses, operations, report summary, and documents. Section gating now starts one request for applications, houses, operations, or documents; Reports starts its summary plus the required houses dependency. Other requests start only when selected. React Query already disables focus refetching and contains no polling interval, so no polling change was warranted.

## SCALABILITY RISKS

- **Measured problem, corrected:** resident directory, payment ledger, resident payment history, and resident assessment history were unbounded. They now default to at most 100 records, accept validated `limit`/`offset` with a measured 10,000-record maximum depth, use deterministic tie-break ordering, and expose `X-Page-Limit`, `X-Page-Offset`, and `X-Has-More` while preserving array response bodies.
- **Measured problem, corrected:** eager route imports produced a 716 kB single application chunk. Authenticated routes now load on navigation.
- **Measured problem, corrected:** hidden Operations sections issued requests at mount. Queries are now enabled only for the selected section and permitted role.
- **Bounded risk, unchanged:** documents and daily operations remain unbounded once their section is explicitly opened. They no longer load invisibly. Their existing resident/house authorization scope and document controls were not weakened. Add pagination only when representative document or operations volumes cross the stated response threshold.
- **Bounded risk, unchanged:** report preview/export still loads broad source tables and filters some data in application memory. Exports are explicit administrator actions, dates/house filters exist, and the API enforces a 2 MB response limit. A SQL rewrite was not shipped without representative report measurements and would risk changing authorization or audit behavior.
- **Bounded risk, unchanged:** dashboard and report summary aggregate complete resident/payment sets in application memory. At the measured 10,000-row synthetic scale the event loop remained under threshold, but response-independent CPU and heap growth should be watched.
- **Acceptable behavior:** import files are capped at 700 kB before parsing; base64 adds temporary browser/server allocation but remains bounded. Confirmation performs sequential, audited writes under advisory locks. No background queue or bulk rewrite was justified.
- **Acceptable behavior:** document bytes stream from object storage rather than being buffered in JSON or PostgreSQL. Stream and API deadlines remain enforced.
- **Not reproduced:** no leak or persistent-process growth was observed in the finite benchmark. Long-duration soak behavior was not claimed from this short audit.

## SLOW QUERIES

The development database contained only 3 residents, 3 payments, 3 operations, 42 audit events, 2 assessment submissions, and no documents, so its sub-millisecond plans were recorded as pilot baselines rather than scaling evidence.

The synthetic resident-payment plan at all scales was a bounded `Limit` over the temporary benchmark's resident/date index. At 10,000 residents and 40,000 payments, synthetic execution time was 0.019 ms. This plan is evidence about the benchmark shape only, not the production schema. The actual development schema's small pilot plans were sub-millisecond; its existing `payments_resident_due_date_idx` was therefore left unchanged rather than claiming a synthetic plan validated a production index.

The resident directory uses stable `name, id` ordering. No name index was added: the measured 10,000-row first-page p95 was 1.611 ms and deepest permitted page p95 was 3.717 ms, both below threshold, and `%term%` search cannot use a plain B-tree index. Adding a trigram extension/index is deferred until search measurements prove it necessary.

The report loader is the primary source-review query risk because it selects eight complete tables before filtering and contains repeated in-memory lookups. It is explicitly classified as a risk, not a measured slow query, and remains unchanged.

## MEMORY RISKS

At 10,000 synthetic residents the unbounded scenario produced a 2.43 MB JSON body, increased heap by 59.55 MiB across repeated runs, and reached 227.6 MiB RSS. The bounded response remained about 24 kB. Browser parsing and DOM rendering therefore scale with a maximum 100-row page instead of the entire history.

Resident payment and assessment histories now expose page controls. Inactive assessment content still does not mount until its resident-profile tab is selected. Payment rows, assessment summaries, case-note equivalents, and document metadata are not base64 encoded.

Import preview still necessarily holds the source buffer, parsed workbook/matrix, normalized rows, database preview rows, and JSON response at once. The 700 kB input cap bounds this behavior; no larger import limit was introduced.

The 765,567-byte logo remains the largest static asset. It is cached as a static file and is not record-volume dependent, so optimizing it was outside this data-growth audit.

## RECOMMENDED IMPROVEMENTS

1. Keep the new 100-record default and deterministic `name,id`, `due_date,id`, and `created_at,id` ordering. Roll back the pagination changes together with generated clients if a consumer cannot honor pages; do not remove authorization filters or response limits.
2. Re-run `pnpm --filter @workspace/scripts run performance:audit` after schema, query, or Node/PostgreSQL runtime changes. Compare the same p95, bytes, heap, event-loop, plan, and pool fields.
3. Measure document and daily-operation pages with representative records before adding more pagination. Hidden-section request gating already removes their cold-navigation cost.
4. Revisit report SQL only with a synthetic fixture matching real report relationships. Any rewrite must preserve administrator/house scope, audit events, date filters, retention, and export contents.
5. Do not change pool size, add caching, add queues, or add speculative indexes from this audit: pool waiting was zero and all bounded p95 values were below threshold.

Validation evidence:

- `pnpm run typecheck` passed.
- `pnpm run build:production` passed.
- `pnpm --filter @workspace/api-server run test:architecture` passed.
- `pnpm --filter @workspace/api-server run test:authorization` passed, including pagination bounds, stable page ordering, continuation headers, and house scope.
- `pnpm --filter @workspace/api-server run test:assessments` passed.
- `pnpm --filter @workspace/api-server run test:reports` passed.
- API contract code was regenerated from `lib/api-spec/openapi.yaml`.