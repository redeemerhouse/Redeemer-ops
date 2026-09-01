# Database reliability and integrity audit

Date: 2026-09-01  
Scope: PostgreSQL schema, checked-in Drizzle migrations, API write paths, retention, seeding, pool lifecycle, and release tooling.  
Method: read-only schema/code review plus the count-only `db:integrity-preflight`; no production data was queried and no record was deleted, rewritten, or deduplicated.

## Executive disposition

The development target returned zero constraint-breaking rows for every preflight check on 2026-09-01. Production remains **unknown until an authorized operator runs the same read-only preflight against the intended production target**. Migration `0008_tired_anita_blake.sql` is additive. It must not be applied unless the preflight passes, the target/backup/recovery point is confirmed, and the normal Replit publish migration review is approved.

Implemented:

- restrictive `NO ACTION` foreign keys for verified operational relationships;
- ownership, uniqueness, and lookup indexes for resident, document, import, assessment, account, house, and payment paths;
- atomic payment/balance/audit, document/history/audit, and resident-import business/audit writes;
- serialized import confirmation and unique batch row numbers;
- count-only, fail-closed migration preflight in release and post-merge paths;
- validated pool bounds, redacted idle-client error handling, guarded transactional seeding;
- disposable-database clean-chain and invalid-legacy regression coverage.

Deferred:

- payment correction, reversal, bank-return, reconciliation, and QuickBooks design;
- replacing the cached resident balance with a reconstructable immutable ledger;
- converting text `residents.home` to a stable house identifier;
- dedicated beds, admissions, discharges, UA results, medication, mobile check-in, and case/recovery-note models;
- automatic repair of any production violation.

## Data-model inventory

| Requested record | Representation | Retention/audit expectation | Finding |
|---|---|---|---|
| Residents | Dedicated `residents` table | Operational history must survive attempted parent deletion; retention uses quarantine snapshots | Present; house is stored as mutable text rather than `house_id` |
| Documents | Dedicated `documents` plus `document_history`; bytes remain object storage | Upload/access history is append-only; record changes now commit with history and audit | Present; exactly one resident or application owner is enforced by the additive migration |
| Check-ins | No dedicated mobile/resident check-in table | Future records need resident ownership and immutable timestamps | Not implemented; assessment submissions may contain check-in answers but are not a check-in ledger |
| Payments | Dedicated `payments` table plus cached `residents.balance` | Append-only ordinary flow; no ordinary update/delete route; correction/reversal requires separate audited design | Present; balance is not ledger-derived and create retries are not yet idempotent |
| UA logs/results | Generic `operations.type = 'ua'` can schedule a UA window | A future result model needs resident ownership, sensitivity controls, and audit history | No dedicated UA result/log table |
| Medications | Only assessment text/options may mention medication support | Future model requires category-scoped access and immutable change history | Not implemented |
| Recovery/case notes | `residents.notes`, `operations.notes`, and assessment answers are generic fields | Sensitive notes need dedicated category/author/share history before expansion | No dedicated recovery/case-note model |
| Assessments | Dedicated `assessment_templates` and `assessment_submissions` | Submission retains template snapshot and resident/template links | Present |
| Staff accounts | Dedicated `auth_accounts`, `auth_account_houses`, sessions, and action tokens | Assignment changes revoke sessions; account deletion may cascade ephemeral assignments/tokens/sessions | Present |
| Homes/beds | Dedicated `houses`; no bed/room table | Houses referenced by financial/attendance/auth/application records; resident home remains text | Houses present; beds absent |
| Admissions | Application conversion and resident lifecycle fields only | Future admission event must be append-only and tied to resident/application | No dedicated admission table |
| Discharges | Resident status/lifecycle changes and generic audit events only | Discharge reason/history must remain append-only | No dedicated discharge table |

## Relationship map

`NO ACTION` below means PostgreSQL rejects parent deletion while children remain. This intentionally avoids cascading deletion of resident or operational history. “Quarantine” is application-level retention behavior; it is not a database foreign key.

| Parent → child | Cardinality / child nullability | Duplicate policy | FK and delete behavior | Soft-delete / audit expectation |
|---|---|---|---|---|
| residents → payments | 1:N, required | Multiple payments allowed | Existing FK, `NO ACTION` | No ordinary edit/delete route; payment audit required |
| houses → applications.preferred_house_id | 1:N, optional | Multiple applications per house | Added FK, `NO ACTION` | Application updates audited |
| residents → applications.converted_resident_id | 1:0..1, optional | One conversion per resident | Added FK plus unique index, `NO ACTION` | Conversion history must not be erased |
| residents → documents | 1:N, optional branch | Multiple documents | Added FK, `NO ACTION` | Exactly one owner branch; document history retained |
| applications → documents | 1:N, optional branch | Multiple documents | Added FK, `NO ACTION` | Exactly one owner branch; document history retained |
| documents → document_history | 1:N, required | Multiple events allowed | Added FK, `NO ACTION` | History is append-only and blocks hard parent delete |
| residents → operations | 1:N, optional | Multiple operations allowed | Added FK, `NO ACTION` | Generic operational history retained |
| resident_import_batches → resident_import_rows | 1:N, required | `(batch_id,row_number)` unique | Added FK, `NO ACTION` | Preview/confirmation audit retained |
| residents → resident_import_rows | 1:N, optional until imported | A resident may be referenced by one import row per batch | Added FK, `NO ACTION` | Provenance blocks resident hard delete |
| assessment_templates → assessment_submissions | 1:N, required | Multiple submissions allowed | Added FK, `NO ACTION` | Snapshot plus template relationship retained |
| residents → assessment_submissions | 1:N, optional | Multiple submissions allowed | Added FK, `NO ACTION` | Sensitive submission history retained |
| houses → expenses | 1:N, optional | Multiple records allowed | Existing FK, `NO ACTION` | Financial history blocks house hard delete |
| houses → income_records | 1:N, optional | Multiple records allowed | Existing FK, `NO ACTION` | Financial history blocks house hard delete |
| houses → meeting_attendance | 1:N, optional | Multiple records allowed | Existing FK, `NO ACTION` | Attendance history blocks house hard delete |
| residents → auth_accounts | 1:N technically, optional | Email unique; resident-account multiplicity not yet constrained | Existing FK, `NO ACTION` | Deactivation is preferred to deletion |
| auth_accounts → auth_account_houses | 1:N, required | `(account_id,house_id)` unique | Existing FK, `CASCADE` | Assignment rows are derivative, not resident history |
| houses → auth_account_houses | 1:N, required | `(account_id,house_id)` unique | Existing FK, `CASCADE` | Assignment rows are derivative |
| auth_accounts → sessions/action tokens | 1:N, required | Token hashes unique | Existing FK, `CASCADE` | Ephemeral authentication material may be removed with account |
| retention target → quarantine/legal hold | Polymorphic 1:N | One active quarantine; holds may repeat | No FK by design | Opaque archive and audit survive ordinary application queries |

## DATABASE RISKS

| Severity | Evidence | Affected records | Recommended disposition |
|---|---|---|---|
| High | `residents.home` is text while house-scoped authorization and reporting compare names | Any resident whose house is renamed, misspelled, or duplicated; development violation count not derivable as an orphan | Defer additive `house_id` backfill until an approved data-mapping migration exists; retain the new lookup index |
| High | `residents.balance` is mutated with `GREATEST(balance - amount, 0)` and is not reconstructable from an adjustment ledger | Paid payments and resident balances; production count unknown | Do not broaden mutation; design corrections/reversals and immutable ledger separately |
| High | Production PostgreSQL clients previously disabled TLS peer verification | Resident, payment, session, and all other database traffic | Implemented `rejectUnauthorized: true` consistently for runtime, preflight, release, and baseline clients; `DB_SSL=true` is mandatory in production and uses the trusted CA store |
| Medium | Pool numbers previously accepted `NaN`, zero, or invalid min/max combinations; idle client errors had no listener | Whole API during configuration or idle-connection failure | Implemented strict positive bounds, min/max validation, and redacted error event |
| Medium | Seed inferred an empty installation from `houses` only and performed separate writes | Any partially restored or concurrently seeded development database | Implemented explicit non-production flag, advisory lock, all-or-nothing transaction, and conflict-safe template seeds |
| Low | Retention targets are polymorphic integers without FKs | Quarantine/legal-hold targets | Keep by design; validate target existence inside authorized retention transactions and preserve audit |

## INTEGRITY PROBLEMS

| Severity | Evidence | Affected records | Recommended disposition |
|---|---|---|---|
| Critical | Import confirmation read batch/rows before its transaction, allowing concurrent confirmations | Import batches, import rows, newly created residents, audit events | Implemented batch row lock, conditional state change, unique row numbers, and in-transaction audit |
| High | Document mutation, document history, and audit were separate commits | Documents and their history/audit rows | Implemented one transaction for each create/update workflow |
| High | Payment/balance committed before its audit event | Payments, resident balance, audit events | Implemented one transaction; payment-create retry idempotency remains deferred with ledger design |
| High | Most operational relationship columns had no FK despite being treated as references in routes | Applications, documents/history, operations, imports, assessments | Added restrictive FKs after count-only preflight |
| Medium | Documents could have no owner or both resident and application owners | Documents | Added exactly-one-owner check; dirty legacy rows block migration without repair |
| Medium | One resident could be the conversion result of multiple applications | Applications and converted residents | Added unique index; duplicates block migration |

Development preflight result: all listed orphan, duplicate, and owner-invariant counts were zero. Production affected counts: unknown until separately approved read-only execution.

## MISSING CONSTRAINTS

Implemented in migration 0008:

- application preferred-house and converted-resident FKs;
- document resident/application FKs and exactly-one-owner check;
- document-history document FK;
- operation resident FK;
- import-row batch/resident FKs and unique `(batch_id,row_number)`;
- assessment-submission template/resident FKs;
- unique non-null application converted resident;

Intentionally not added:

- a FK from `residents.home` to `houses.name`: mutable text is not a stable key and production duplicates/mismatches require an explicit mapping;
- a unique `auth_accounts.resident_id`: current account lifecycle does not prove one account per resident across all migration states;
- FKs from generic `audit_events.entity_id`, retention targets, or JSON scopes: they are polymorphic audit/retention records that must outlive source deletion;
- hard-delete cascades for resident history.

## INDEX RECOMMENDATIONS

Implemented supporting/common-query indexes:

- residents by home and email;
- payments by resident/due date and status/due date;
- applications by preferred house, status/created time, and converted resident;
- documents by resident/created time, application/created time, and object path;
- document history by document/created time;
- operations by resident/scheduled date;
- import batches by status/created time and rows by batch/row or resident;
- assessment submissions by template and resident/created time;
- expenses, income, and meeting attendance by house/date;
- auth accounts by resident and action tokens by account.

Residual recommendation: measure production query plans before adding broader text-search or report-specific indexes. Index creation in 0008 is ordinary blocking DDL; schedule a quiet window if tables are large. A future reviewed migration may use concurrent index creation outside a transaction if production size requires it.

## MIGRATION RISKS

| Severity | Evidence | Lock/availability implication | Rollback / approval |
|---|---|---|---|
| Critical | New FKs/check/unique indexes reject dirty legacy rows | `ALTER TABLE` validation scans tables and takes locks; ordinary index builds can block writes | Preflight must pass first. Do not remove/repair rows automatically. Stop writes, investigate identifiers under approved access, then use a reviewed forward plan |
| High | Direct `drizzle migrate` bypasses operator context | Running against the wrong target can change schema | Supported release path runs preflight, requires `DB_WRITES_FROZEN=true`, and holds an exclusive advisory migration guard respected by API mutations for existing targets; production application remains Replit Publish only. Confirm credential-free target, backup, recovery point, and Publish diff |
| High | Existing migration ledger may diverge | A corrupt prefix can apply changes to an unexpected shape | Release check validates exact hash/timestamp prefix before migration |
| Medium | Additive column/indexes/FKs cannot be “rolled back” safely once new writes depend on them | Old application remains compatible because the column is nullable and constraints only reject invalid writes | Roll application back without reversing migration; schema recovery requires PITR/restore or reviewed forward migration |
| Medium | Post-merge legacy no-ledger catalog may look current but remain unreleasable | No DDL occurs, but setup can be misunderstood | Existing warning retained; operator-confirmed baseline remains mandatory |

The migration never drops a table/column, deletes a row, rewrites existing values, or enables a purge job.

## TRANSACTION RISKS

| Severity | Workflow | Finding / disposition |
|---|---|---|
| Critical | Resident import preview | Batch, rows, and audit were independent; now atomic |
| Critical | Resident import confirm | Concurrent confirmation could duplicate residents; now locks batch, validates exact distinct rows, conditionally transitions state, and audits in one transaction |
| High | Payment create | Payment and balance were atomic but audit was not; audit is now included. Create retries remain a documented residual risk pending an approved ledger/idempotency contract |
| High | Document create/update | Business row, immutable history, and audit are now one transaction |
| Medium | Resident/application/general operation updates | Business mutation and generic audit are still separate in several routes | Residual risk documented; migrate these only when semantics and regression tests are established, avoiding overlap with broader API reliability work |
| Low | Retention actions | Existing implementation already uses transactions and conditional claims | Preserve; permanent purge remains disabled/out of scope |

## DATA LOSS RISKS

| Severity | Evidence | Affected records | Disposition |
|---|---|---|---|
| Critical | Hard parent deletion could previously orphan unprotected history | Documents/history, operations, imports, assessments, applications | New `NO ACTION` FKs reject it |
| Critical | Automatic repair/deduplication would overwrite evidence | Any dirty production row | Explicitly prohibited; preflight reports counts only and leaves rows untouched |
| High | Cached balance floors overpayment at zero | Resident financial state | Deferred to immutable correction/reversal/credit design; no destructive “fix” |
| High | Generic notes combine sensitive concepts without dedicated history | Resident/operation notes and assessment answers | Do not build new medication/UA/case modules on generic notes |
| Medium | Retention archive can eventually purge data | Quarantined records | Purge job is not enabled by this work; legal holds and authorization remain mandatory |
| Medium | Seed against a partial restore could create synthetic data | Development business tables | Guarded and transactional; production execution refused |

## Migration execution gate

1. Stop application writes for an existing target and enter a controlled migration window. The release check refuses an existing target unless `DB_WRITES_FROZEN=true` explicitly acknowledges this condition, then holds the exclusive database migration guard through preflight, migration, and drift verification. API mutations take the matching shared guard or return `503`.
2. Run `pnpm run db:integrity-preflight` against the explicitly selected target. Save only check names/counts; duplicate findings count duplicate key groups, not every row in those groups. Do not copy sensitive rows into logs.
3. If any count is nonzero, stop. Do not migrate, delete, deduplicate, or overwrite. Obtain approved restricted access to inspect identifiers and prepare a separate forward repair plan.
4. Confirm target identity, restorable backup/recovery point, release freeze, and migration ledger prefix.
5. Review lock duration and table size. Schedule a quiet window where necessary.
6. Development uses post-merge migration checks. Production schema application uses Replit Publish review; API startup runs no DDL or seed.
7. After migration, run catalog drift and release verification. Roll back the application only; do not reverse schema or drop protections.

## Verification evidence

- Schema generation and `drizzle-kit check` pass with migration/snapshot 0008.
- Unit tests prove preflight issues only `SELECT` statements, skips unavailable older-prefix tables, and emits only names/counts.
- Disposable PostgreSQL release coverage applies the full clean chain and compares the catalog to the committed snapshot.
- Invalid legacy fixture coverage applies the prior prefix, inserts an ownerless synthetic document, proves release is blocked before migration, proves the row and ledger count are unchanged, and proves fixture values are absent from output.
- API typecheck/build verifies the transaction and migration-guard code compiles; focused concurrency tests verify import duplicate prevention.
- Development count-only preflight passed with zero findings on 2026-09-01.

## Residual approval boundaries

Separate explicit approval is required before:

- querying production row identifiers or repairing any detected violation;
- changing `residents.home` to a house ID;
- introducing financial correction/reversal/reconciliation or QuickBooks writes;
- creating missing clinical/operational modules;
- enabling retention purge;
- running any destructive migration or restoring over an existing database.