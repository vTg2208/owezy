# PostgreSQL redesign final-review fix report

Date: 2026-08-31
Base reviewed: `398c3239d0a99f2b0fc50f3bbc0d9d76c61623d8`
Production/test fix commit: `0062ccd2eda7c064b6d74e67ef601646341cb671`

## Outcome

The final-review findings were fixed in one coherent wave. Active trips now retain a reachable connected owner, authorization-sensitive writes recheck authority in the mutation transaction/statement, legacy migration reruns reject identity collisions, PostgreSQL TLS verifies the server, database and health operations are bounded and cleaned up, receipt publication and schema migration execution are crash/concurrency safe, malformed request bodies return controlled 400 responses, and the supported runtime is pinned to Node.js 20.19.0 or newer.

The frontend HTTP response contract is unchanged. The only response change is deliberate validation handling for malformed JSON/payloads.

## Changed behavior and files

### Owner reachability

- Added ordered forward migration `backend/src/db/migrations/005_owner_continuity.sql`; no previously applied migration was edited.
- Added `trips.archived_at` and made archived trips non-joinable.
- Centralized owner leave behavior in the transaction-safe `leave_trip_membership(id, archiveIfOwnerAlone)` function.
- Voluntary owner self-leave transfers ownership to the earliest active connected membership ordered by `(created_at, id)`. Anonymous memberships are not eligible. If no successor exists, voluntary leave returns a controlled 409 and changes nothing.
- Account deletion remains possible. An owned trip with no connected successor is locked and archived before its owner is anonymized; an owned trip with a successor transfers deterministically.
- The deferred owner invariant now requires every non-archived trip to have exactly one linked, active, connected owner. Archived trips retain one historical linked owner.
- The legacy transformer rejects an owner membership without a resolvable legacy user.
- Main files: `backend/src/db/migrations/005_owner_continuity.sql`, its integration test, `tripRepository.*`, `accountRepository.*`, `tripService.*`, and `accountService.test.ts`.

### Authorization and mutation races

- Lock/unlock is now one conditional PostgreSQL `UPDATE` joined to the current active Firebase user and active owner membership. `rowCount` determines success and an existence check preserves 404 versus 403 behavior.
- Member removal locks the trip, actor, and target in one transaction, checks current role/status, and invokes the centralized owner-continuity function.
- Message creation now uses `INSERT ... SELECT` from the still-active membership and active user, locks both authorization rows for the statement, and requires one returned row. A membership removed before insertion produces 403 and no message.
- Main files: `tripRepository.ts`, `messageRepository.ts`, their tests, `tripService.ts`, and `messageService.ts`.

### Legacy migration collision safety and verification

- `legacy_id_mappings` conflicts use `DO NOTHING`, then compare the existing target exactly. They never repoint silently.
- Preexisting trip, membership, expense, split, receipt, and message targets are accepted only if all immutable identity, source, and parent-reference fields match.
- Existing Firebase users are validated inside the user transaction, including immutable creation identity, so a conflict rolls back before partial user changes commit.
- Post-write verification checks every expected user, trip, membership, expense, split, receipt, and message row through mappings and parent references, in addition to counts, referential integrity, split totals, receipt bytes, and zero-sum balances.
- Added rerun fixtures for a misdirected mapping, a membership ID linked to another trip, a persisted linked-identity mismatch, and a conflicting preexisting Firebase user.
- Main files: `backend/src/scripts/migrate-mongo-to-postgres.ts` and its tests.

### TLS, liveness, cleanup, and migration runner

- `DATABASE_SSL=true` now produces `ssl.rejectUnauthorized: true`.
- Added optional `DATABASE_SSL_CA`; literal `\n` sequences are expanded to PEM newlines.
- Added validated bounded `DATABASE_CONNECTION_TIMEOUT_MS` and `DATABASE_QUERY_TIMEOUT_MS` configuration. Defaults are 5,000 ms and 10,000 ms; allowed values are positive integers no greater than 120,000.
- Pool configuration applies connection, client query, and server statement timeouts.
- Health checks use the node-postgres query timeout and destroy/release a failed client, so a response timeout does not leave an uncancelled server query accumulating in the pool.
- Initialization and listen failures close/reset the pool. A real TCP blackhole regression proves connection attempts are bounded and the pool ends.
- The migration runner holds a PostgreSQL advisory lock on one checked-out client across ledger creation/check/application, releases it in `finally`, and closes the CLI pool on success, migration failure, or client acquisition failure.
- Main files: `backend/src/database.*`, `backend/src/server.*`, `backend/src/db/migrate.*`, `.env.example`, and `README.md`.

### Atomic local storage and request validation

- Local receipt writes use a unique same-directory file opened with `wx`, write and `fsync` it, close it, then atomically rename it to the deterministic final path. Failure cleanup removes only that operation's temporary file. Existing deterministic corrupt-object repair remains supported.
- Real filesystem tests cover temporary publication, cleanup on rename failure, and deterministic repair.
- Zod validation now covers trip create/join, message text, expense description/amount/split type, and every split entry. Null/non-string text and non-array/malformed splits produce controlled 400 responses rather than `TypeError`/500.
- Express JSON parser failures, including a primitive `null` body, map to `{ "error": "Invalid JSON request body" }` with HTTP 400.
- Main files: `backend/src/storage/receiptStorage.*`, `expenseService.*`, `messageService.*`, `tripService.*`, `routes/api.ts`, `routes/routes.test.ts`, and `server.*`.

### Runtime and dependencies

- Removed the unused browser `firebase` package from the backend.
- Pinned both packages to `engines.node >=20.19.0`; README prerequisites/deployment match MongoDB 7 and Vite 7.
- Backend direct upgrades include Express 4.22.2, Firebase Admin 13.10.0, MongoDB 7.6.0, cors 2.8.6, and dotenv 17.4.2.
- Compatible security overrides pin `@grpc/grpc-js` 1.14.4, `@protobufjs/utf8` 1.1.2, `@tootallnate/once` 2.0.1, `brace-expansion` 2.1.4, `form-data` 2.5.6, `minimatch` 9.0.7, `path-to-regexp` 0.1.13, `protobufjs` 7.6.5, and `websocket-driver` 0.7.5.
- Frontend upgrades include Firebase 12.18.0 and React Router DOM 7.18.3. The obsolete Router 7 future flags were removed because those behaviors are now defaults.
- Both lockfiles were regenerated and clean installs completed successfully.

## RED/GREEN evidence

Production behavior followed test-first changes. Captured RED results included:

- owner continuity/race/validation focused wave: 14 expected focused failures before repository/service implementations;
- migration identity wave: 3 expected failures for misdirected mapping, cross-trip target ID, and wrong linked identity;
- local storage wave: the filesystem watcher did not observe an exclusive `.tmp` publication before implementation;
- TLS/liveness/runner wave: 11 expected failures before verified TLS, bounded timeout, cleanup, and advisory-lock behavior;
- null JSON route: expected 400, received 500;
- migration client acquisition cleanup: expected `['connect', 'end']`, received `['connect']`;
- locked message authorization rows: expected SQL to contain `FOR UPDATE OF actor, u`, but it did not;
- immutable legacy-user collision: expected rejection, but the promise resolved;
- full expense identity verification: expected currency/update checks, but the verification SQL omitted them.

After each minimal implementation the associated focused test was rerun green. Notable captured GREEN results:

```text
PostgresMigrationTarget: 34 passed (34)
message still-active locking regression: 1 passed | 2 skipped (3)
migration connect-failure cleanup regression: 1 passed | 7 skipped (8)
blackhole connection cleanup regression: 1 passed | 9 skipped (10)
null router validation regression: 1 passed | 8 skipped (9)
JSON parser controlled-400 regression: 1 passed | 9 skipped (10)
```

## Exact final verification

Environment:

```text
node --version
v20.19.5
TEST_DATABASE_URL=unavailable
```

Backend full suite and build:

```text
Test Files  17 passed | 5 skipped (22)
Tests       159 passed | 15 skipped (174)
npm run build -> tsc -> exit 0
```

The five skipped files are exactly the conditional PostgreSQL migration integration suites (`001` through `005`). Each contains three tests and is gated only by `TEST_DATABASE_URL`, accounting for all 15 skipped tests.

Frontend full suite and production build:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
vite v7.3.0
73 modules transformed
built in 7.27s
exit 0
```

Production dependency audits:

```json
backend npm audit --omit=dev:
{"dependencies":175,"optional":190,"total_dependencies":410,"vulnerabilities":{"info":0,"low":0,"moderate":8,"high":0,"critical":0,"total":8}}

frontend npm audit --omit=dev:
{"dependencies":97,"optional":49,"total_dependencies":299,"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}}
```

Backend audit improved from the recorded baseline of 22 findings (1 low, 12 moderate, 6 high, 3 critical) to 8 moderate findings with no low/high/critical findings. The remaining package names are exactly:

```text
@google-cloud/firestore
@google-cloud/storage
firebase-admin
gaxios
google-gax
retry-request
teeny-request
uuid
```

These eight entries all propagate one underlying advisory: the optional chains retain `uuid@9`, whose v3/v5/v6 buffer API lacks a bounds check. The application uses Firebase Admin Auth only; it does not invoke the optional Firestore/Storage request stacks, and no route supplies a UUID output buffer. Compatible patch releases do not exist in the installed dependency ranges: the fixed UUID is 11.1.1, while these packages require UUID 9; fixed Firestore/Storage, google-gax, retry-request, teeny-request, and gaxios releases require major-chain changes. Firebase Admin 13.10.0 is the newest Node-20-supported line used here; Firebase Admin 14 requires Node 22. `npm audit` proposes an older/breaking Firebase Admin 12.1.0 change rather than a compatible patch. That downgrade was not applied. The residual moderate optional-path risk is accepted pending an upstream Firebase Admin release with compatible fixed optional dependencies.

Repository/diff/search checks:

```text
git diff --cached --check -> exit 0
runtime_mongo_files=0
backend_browser_firebase_entries=0
source_secret_pattern_files=0
direct_receipt_write_files=1
  backend/src/storage/receiptStorage.ts
float_money_files=0
legacy_split_authorization_files=0
```

The MongoDB driver is confined to the explicit offline migration script. The only production filesystem receipt writer is the storage abstraction. Money remains integer-minor-unit based. The removed split authorization/mutation method patterns are absent.

## Self-review of `398c323..0062ccd`

I reviewed the complete diff, not only the last edits, across all 34 changed files. The review checked:

- owner continuity, archive reachability, join exclusion, deterministic successor ordering, and deferred owner invariants;
- lock ordering and transaction/conditional-DML authority checks for lock, removal, deletion, and message insertion;
- exact 403/404/409/400 effect contracts and unchanged successful frontend response shapes;
- immutable mapping behavior, target-parent collision rejection, user-transaction rollback safety, per-row verification, receipt repair, and migration reruns;
- verified TLS/CA parsing, timeout validation, query cancellation by destroying timed-out clients, initialization/listen cleanup, advisory-lock lifetime, and CLI pool closure;
- exclusive temporary-file creation, sync-before-rename, operation-scoped cleanup, and deterministic final receipt keys;
- malformed payload handling at runtime boundaries;
- backend Mongo isolation, secret-pattern absence, receipt filesystem paths, integer money handling, membership authorization call sites, package/lockfile alignment, and Node runtime documentation.

No additional correctness defect was found after the final hardening tests.

## Remaining concerns

1. Live PostgreSQL integration execution was unavailable because `TEST_DATABASE_URL` was not configured. All five integration suites skipped accurately; migration 005 and its SQL concurrency/invariant behavior should be run against the deployment PostgreSQL version before release.
2. The backend production audit retains the eight moderate, optional Firebase Firestore/Storage-chain entries described above. There are no remaining low, high, or critical audit findings, and the vulnerable optional services are not used by this application.
3. Local filesystem receipts remain suitable only for development or a single durable-volume deployment, as already documented; horizontally scaled deployments still require a shared `ReceiptStorage` implementation.
