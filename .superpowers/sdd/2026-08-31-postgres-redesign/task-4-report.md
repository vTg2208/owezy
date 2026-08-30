# Task 4 — Final integration, runtime cleanup, documentation, and verification

## Result

Completed final PostgreSQL runtime integration. The backend no longer starts a MongoDB heartbeat or imports Mongoose at runtime. MongoDB remains only as the source driver for the explicit legacy migration command.

## TDD evidence

Lifecycle production behavior was implemented test-first in `backend/src/server.test.ts`.

1. **Startup ordering and one-time shutdown**
   - RED: `cd backend && npm test -- server.test.ts` exited `1`: three new lifecycle tests failed with `TypeError: startServer is not a function` / `createGracefulShutdown is not a function`. The pre-existing module side effect also attempted database startup and Vitest reported `process.exit unexpectedly called with "1"`.
   - GREEN: after extracting guarded startup and shutdown lifecycle functions, the same command exited `0`: `17 passed | 4 skipped` test files; `125 passed | 12 skipped` tests.
2. **SIGTERM/SIGINT registration**
   - RED: the focused command exited `1`: `TypeError: registerShutdownHandlers is not a function` for the signal lifecycle test.
   - GREEN: after registering both signals through the shared one-time shutdown function, it exited `0`: `126 passed | 12 skipped` tests.
3. **PostgreSQL health readiness**
   - RED: the focused command exited `1`: `TypeError: createApp is not a function` for the health readiness test.
   - GREEN: after extracting `createApp` with a readiness boundary, it exited `0`: `127 passed | 12 skipped` tests. A backend TypeScript build also exited `0`.

The tests exercise the observable contracts: rejected database initialization does not listen, initialization precedes listening, repeated shutdown signals close HTTP and PostgreSQL exactly once, and `/health` distinguishes unavailable PostgreSQL from ready PostgreSQL.

## Changed files

- `backend/src/server.ts` — guarded startup entry point; injectable/testable startup and shutdown lifecycle; PostgreSQL readiness health response; SIGTERM/SIGINT handlers.
- `backend/src/server.test.ts` — lifecycle and health contract coverage.
- `backend/src/cron/keepAlive.ts` — deleted obsolete HTTP/Mongoose heartbeat.
- `backend/package.json`, `backend/package-lock.json` — removed `mongoose` and `@types/mongoose`; retained `mongodb` solely for `migrate:mongo`.
- `package.json`, `package-lock.json` — removed obsolete root `node-cron` and `@types/node-cron`.
- `README.md` — explicitly states that ordered migrations are a release step before every backend start and are not automatic at runtime.

## Deployment and documentation review

- `backend/.env.example` and `frontend/.env.example` contain placeholders/path configuration only; no credentials or secrets.
- README documents Firebase client/Admin credential setup, PostgreSQL TLS (`DATABASE_SSL=true`), durable or disabled receipt storage, `TEST_DATABASE_URL`-gated integration tests, and MongoDB variables as migration-source-only.
- The deployment order is explicit: provision/back up PostgreSQL, configure Firebase/database/TLS/receipt storage, build, run `npm run migrate`, complete legacy migration verification when applicable, then start the backend and deploy the frontend.
- Cutover keeps legacy writes stopped/read-only until migration and smoke testing succeed. Rollback restores traffic to the legacy deployment/backup rather than reversing additive PostgreSQL schema changes in place.

## Verification evidence

| Check | Exact result |
| --- | --- |
| `cd backend && npm test` | exit `0`; `17 passed | 4 skipped` test files; `127 passed | 12 skipped` tests. |
| `cd backend && npm run build` | exit `0`; `tsc`. |
| `cd frontend && npm test` | exit `0`; `1 passed` test file; `3 passed` tests. |
| `cd frontend && npm run build` | exit `0`; `tsc && vite build`; `65 modules transformed`; build completed in `1.51s`. |
| Missing database runtime contract | `DATABASE_URL='' DOTENV_CONFIG_PATH=.env.missing node dist/server.js` exited `1` and printed `[DATABASE] Failed to initialize PostgreSQL: Error: DATABASE_URL is required`; no HTTP listener was created. |
| `git diff --check` | exit `0`; no output. |
| Runtime Mongo/Mongoose search | Outside `scripts/migrate-mongo-to-postgres.ts`, no runtime Mongo/Mongoose references. The only retained production Mongo import is `MongoClient` in that migration source command. |
| Dependency search | No `mongoose` or `node-cron` remains in root/backend package manifests or lockfiles. |
| Receipt/floating-money review | No production `data:image`, Base64 receipt persistence, `parseFloat`, `toFixed`, or `Math.round` paths found. Receipt keys are root-confined and membership authorization is enforced in trip, expense, message, and receipt services. |

## Rulings impact

- **Ledger ruling:** removed the Mongo/Mongoose keep-alive runtime path and the obsolete cron dependencies.
- **Runtime boundary:** routes, repositories, services, and server use PostgreSQL only; MongoDB is retained only for source reads during `npm run migrate:mongo`.
- **Operational lifecycle:** a successful PostgreSQL connectivity check occurs before listening; health is `503` until PostgreSQL is ready; shutdown signals close HTTP and the PostgreSQL pool through one idempotent lifecycle path.

## Checklist

- [x] Delete Mongoose heartbeat and startup call.
- [x] Remove Mongoose and obsolete cron packages while retaining MongoDB migration source driver.
- [x] Fail clearly without `DATABASE_URL`.
- [x] Keep migrations as explicit ordered pre-start release step and document it.
- [x] Add graceful SIGTERM/SIGINT close-once lifecycle coverage.
- [x] Keep health aligned with PostgreSQL readiness.
- [x] Review env examples, migration/cutover/rollback guidance, Firebase, TLS, receipt storage, test DB, and source-only Mongo variables.
- [x] Run full backend/frontend tests and builds plus static boundary checks.

## Concerns intentionally not changed

- PostgreSQL migration integration tests are skipped without `TEST_DATABASE_URL`; no test database was provisioned for this task.
- `npm uninstall` reported `22` dependency audit findings (`1 low`, `12 moderate`, `6 high`, `3 critical`). Per scope, no audit fixes were applied.
- The frontend build reports that `caniuse-lite`/Browserslist data is eight months old. This warning is unrelated to the PostgreSQL runtime cleanup and was not changed.
