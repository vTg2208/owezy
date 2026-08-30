# Receipt Storage and MongoDB Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This task must be executed inline because the task brief explicitly prohibits subagent dispatch. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Base64 receipt JSON with authenticated file-backed receipt upload/read behavior and add a restartable, verifiable MongoDB-to-PostgreSQL migration command.

**Architecture:** A receipt service authorizes through the existing trip membership repository, validates real image bytes, stores bytes behind a `ReceiptStorage` interface, and persists only metadata in PostgreSQL. Receipt attachment joins the existing expense/split transaction and locks a same-trip, same-uploader pending receipt. A separate migration-source script reads MongoDB, transforms fixtures through pure functions, writes PostgreSQL rows idempotently using legacy mappings, and runs verification before allowing cutover.

**Tech Stack:** TypeScript, Express 4, PostgreSQL/`pg`, Node filesystem/crypto, MongoDB Node driver, Vitest, React/Vite.

**Spec:** `.superpowers/sdd/2026-08-31-postgres-redesign/task-3-brief.md`

## Global Constraints

- Work directly on `main` at accepted Task 2 HEAD `e9c2408217acb7cfebc44cf31c59cc8bf86dcb87` as explicitly authorized.
- Use strict TDD: every production behavior starts with a test that is observed failing for the intended reason.
- Normal tests must not require live PostgreSQL, MongoDB, or Firebase; mock only those external I/O boundaries.
- Receipt bytes stay out of PostgreSQL; store a server-generated object key, MIME type, byte size, and SHA-256 checksum.
- Upload happens before expense creation, so an ordered forward migration must make `receipts.expense_id` nullable and model pending expiry/attachment state.
- Only active trip members may upload/read; expense attachment must verify the pending receipt has the same trip and uploader actor inside the expense PostgreSQL transaction.
- `receipt_url` remains the frontend response name but contains an authenticated application URL, never a storage key.
- Runtime routes use PostgreSQL only. The MongoDB driver is migration-source-only.
- Supported upload types are `image/jpeg`, `image/png`, and `image/webp`; default maximum size is 5 MiB (`5242880` bytes), configurable by `RECEIPT_MAX_BYTES`.
- Local receipt keys are generated server-side and every read/write/delete path must resolve under `RECEIPT_STORAGE_ROOT`.
- Run focused tests, the full backend suite/build, and the frontend build before committing.

---

### Task 1: Forward receipt schema

**Files:**
- Create: `backend/src/db/migrations/004_receipt_storage.sql`
- Create: `backend/src/db/migrations/004_receipt_storage.integration.test.ts`

**Interfaces:**
- Consumes: existing `receipts` table from `001_initial.sql` and ordered migration runner.
- Produces: nullable `expense_id`; `byte_size`, `checksum_sha256`, `status`, `pending_expires_at`, `attached_at`; `legacy_id_mappings(entity_type, legacy_id, postgres_id)`.

- [ ] Write an integration test that, when `TEST_DATABASE_URL` exists, applies migrations 001-004 and proves a metadata-complete pending receipt can exist without an expense, attachment state requires an expense, invalid checksums/sizes fail, and a legacy mapping is unique.
- [ ] Run `npm test -- src/db/migrations/004_receipt_storage.integration.test.ts` in `backend`; when no test database is configured, also add a migration-runner unit assertion that 004 is ordered after 003 and observe the missing migration fail.
- [ ] Add `004_receipt_storage.sql` with forward-only `ALTER TABLE` statements and state checks. Preserve already-attached rows from 001 by allowing metadata fields to remain nullable only for those legacy rows while requiring them for pending uploads.
- [ ] Re-run the focused migration tests and keep them green.

### Task 2: Real local receipt storage and validation

**Files:**
- Create: `backend/src/storage/receiptStorage.ts`
- Create: `backend/src/storage/receiptStorage.test.ts`
- Create: `backend/src/services/receiptService.ts`
- Create: `backend/src/services/receiptService.test.ts`
- Create: `backend/src/repositories/receiptRepository.ts`
- Create: `backend/src/repositories/receiptRepository.test.ts`

**Interfaces:**
- Produces: `ReceiptStorage.write(bytes, contentType) -> { storageKey }`, `ReceiptStorage.read(storageKey)`, `ReceiptStorage.remove(storageKey)`; `LocalReceiptStorage`; `DisabledReceiptStorage`; `ReceiptService.uploadReceipt(firebaseUid, tripId, contentType, bytes)` and `ReceiptService.readReceipt(firebaseUid, tripId, receiptId)`.
- Consumes: `TripRepository.findActiveMembership` and PostgreSQL `QueryExecutor` for receipt metadata.

- [ ] Write storage tests using a real temporary directory. Prove a write/read round trip, server-generated keys that ignore hostile filenames by design, traversal/absolute keys rejected on reads/removes, disabled storage fails clearly, and configuration parses the 5 MiB default/positive overrides.
- [ ] Run `npm test -- src/storage/receiptStorage.test.ts`; observe module-not-found RED.
- [ ] Implement the minimal storage abstraction with `resolve(root, key)` containment checks, random UUID-derived keys, exclusive writes, and disabled mode.
- [ ] Re-run the storage tests GREEN.
- [ ] Write receipt service/repository tests proving active-membership authorization, MIME allow-list plus magic-byte validation, positive size limit, SHA-256/byte-size metadata, storage cleanup if metadata persistence fails, pending expiry, and authorized reads that never expose the storage key.
- [ ] Run `npm test -- src/services/receiptService.test.ts src/repositories/receiptRepository.test.ts`; observe missing behavior RED.
- [ ] Implement metadata models and PostgreSQL queries. `createPending` must use `INSERT ... SELECT` constrained to the still-active actor membership; `findForTrip` returns metadata only for the requested trip.
- [ ] Re-run service/repository tests GREEN, then refactor duplication without changing behavior.

### Task 3: Authenticated receipt HTTP boundary

**Files:**
- Modify: `backend/src/routes/api.ts`
- Modify: `backend/src/routes/routes.test.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Produces: `POST /api/trips/:tripId/receipts` with route-scoped `express.raw`; `GET /api/trips/:tripId/receipts/:receiptId`; upload JSON fields `receipt_id`, `receipt_url`, `content_type`, `byte_size`, `checksum_sha256`, `status`; byte response with exact content type/length and private cache policy.
- Consumes: `ReceiptService.uploadReceipt/readReceipt`, authentication middleware, `RECEIPT_MAX_BYTES`.

- [ ] Extend real HTTP route tests to send actual PNG bytes and prove auth-derived upload calls, raw body preservation, response contract, byte streaming, supported MIME rejection, and parser oversize errors map to HTTP 413.
- [ ] Run `npm test -- src/routes/routes.test.ts`; observe missing dependency/routes RED.
- [ ] Add receipt service dependency, route-scoped raw parser, route handlers, and entity-too-large error mapping. Reduce global JSON limit to a practical JSON-only value because Base64 receipts are no longer accepted.
- [ ] Re-run route tests GREEN.

### Task 4: Transactional attachment and receipt URLs in trip reads

**Files:**
- Modify: `backend/src/services/expenseService.ts`
- Modify: `backend/src/services/expenseService.test.ts`
- Modify: `backend/src/repositories/expenseRepository.ts`
- Modify: `backend/src/repositories/expenseRepository.test.ts`
- Modify: `backend/src/repositories/tripRepository.ts`
- Modify: `backend/src/repositories/tripRepository.test.ts`

**Interfaces:**
- Consumes: `ExpenseInput.receiptId`, `NewExpense.receiptId`, acting `paidByMembershipId`.
- Produces: expense + splits + optional receipt attachment in one transaction; trip expense `receiptUrl` as `/api/trips/{tripId}/receipts/{receiptId}`.

- [ ] Replace the temporary service rejection test with RED tests that a nonempty string `receiptId` is forwarded, malformed IDs are rejected, and legacy `receiptUrl`/data URLs are rejected without entering JSON persistence.
- [ ] Run focused expense service tests and observe RED against the Task 2 boundary.
- [ ] Remove the temporary rejection and forward `receiptId` into `NewExpense` while preserving `receiptUrl` rejection.
- [ ] Run service tests GREEN.
- [ ] Replace the repository rejection test with RED tests that the transaction locks exactly one pending, unexpired receipt matching `receiptId + tripId + paidByMembershipId`, attaches it after expense/splits, and rejects foreign/missing/already-attached receipts without any committed expense.
- [ ] Run focused repository tests RED, implement `SELECT ... FOR UPDATE` plus `UPDATE receipts SET expense_id, status='attached', attached_at=now(), pending_expires_at=NULL` inside the existing transaction, then run GREEN.
- [ ] Add a trip repository RED test for the receipt join/application URL, implement the left join, and run GREEN.

### Task 5: Frontend upload/read flow

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/AddExpense.tsx`
- Modify: `frontend/src/components/ExpenseList.tsx`

**Interfaces:**
- Produces: `api.uploadReceipt(tripId, File) -> { receipt_id, receipt_url, ... }`; `api.readReceipt(receiptUrl) -> Blob`; `api.addExpense(... receiptId?)`.
- Consumes: authenticated application `receipt_url`, selected browser `File` bytes.

- [ ] Add backend contract coverage first (Task 3/4) because the frontend has no test runner; use TypeScript build as the frontend verification boundary.
- [ ] Replace canvas/Base64 compression with an authenticated raw `fetch` using the file MIME and body; send only `receiptId` in expense JSON.
- [ ] Change receipt viewing to fetch the authenticated blob, create/revoke an object URL, and never place an authenticated URL directly in an unauthenticated `<img>` request.
- [ ] Run `npm run build` in `frontend`; fix type failures and retain the existing UX response names.

### Task 6: MongoDB migration transformations and runner

**Files:**
- Create: `backend/src/scripts/migrate-mongo-to-postgres.ts`
- Create: `backend/src/scripts/migrate-mongo-to-postgres.test.ts`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

**Interfaces:**
- Produces pure `transformLegacySnapshot(snapshot)` and `verifyMigration(snapshot)` functions plus CLI `npm run migrate:mongo -- [--dry-run]`; consumes MongoDB collections `users`, `trips`, `members`, `expenses`, `chatmessages` and PostgreSQL/mapping/storage boundaries.

- [ ] Write fixture transformation tests with literal expectations for Firebase-to-UUID mapping, unchanged text IDs, decimal-to-minor conversion, embedded splits, data-URL decoding/checksum/MIME, invalid Base64, orphan references, duplicate IDs, split-total mismatch, and non-zero balance reporting.
- [ ] Run `npm test -- src/scripts/migrate-mongo-to-postgres.test.ts`; observe missing module RED.
- [ ] Implement pure parsing/validation/transformation with structured `MigrationIssue` records and no silent dropping. Receipt bytes become storage write inputs, never SQL byte values.
- [ ] Re-run transformation tests GREEN.
- [ ] Add a MongoDB-driver CLI with explicit `MONGODB_URI`, `DATABASE_URL`, and receipt storage configuration. Use deterministic UUIDs for legacy Firebase UIDs, `legacy_id_mappings`, `ON CONFLICT`/mapping checks, per-trip transactions, dry-run no-write behavior, resumable writes, and final count/reference/split/zero-sum verification with nonzero exit on issues.
- [ ] Add unit tests around injected Mongo/PostgreSQL/storage boundaries for dry-run, restart, and failed verification, observe RED, implement, and run GREEN.

### Task 7: Configuration, documentation, verification, and commit

**Files:**
- Modify: `backend/.env.example`
- Modify: `README.md`
- Create: `.superpowers/sdd/2026-08-31-postgres-redesign/task-3-report.md`

**Interfaces:**
- Documents: `RECEIPT_STORAGE_ROOT`, `RECEIPT_MAX_BYTES=5242880`, `RECEIPT_PENDING_TTL_HOURS=24`, `MONGODB_URI` as migration-only, migration/dry-run/cutover order, cleanup query, local and hosted deployment storage expectations.

- [ ] Update examples and README for PostgreSQL setup, ordered migrations, local receipt storage, durable production storage requirement, migration dry-run/execute/verify sequence, backups, and rollback/cutover notes.
- [ ] Re-read the brief and inspect `git diff --check`, dependency/runtime imports, storage path logic, transaction SQL, and all changed files for secrets or generated artifacts.
- [ ] Run fresh verification: focused receipt/migration tests, `npm test` and `npm run build` in `backend`, then `npm run build` in `frontend`.
- [ ] Write the mandated report with RED/GREEN commands and outputs, changed files, self-review, exact verification evidence, and concerns.
- [ ] Commit all Task 3 files with a scoped message and verify `git status --short --branch` plus the commit diff.
