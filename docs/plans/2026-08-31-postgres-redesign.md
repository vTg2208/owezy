# PostgreSQL redesign implementation plan

## Goal

Replace the MongoDB persistence layer with PostgreSQL while preserving the existing frontend API, enforcing trip membership and role authorization, using exact minor-unit money arithmetic, moving receipt bytes behind a storage abstraction, and providing a safe MongoDB-to-PostgreSQL migration path.

## Global constraints

- Work directly on `main` as explicitly authorized by the user.
- Keep Firebase Authentication; map Firebase UIDs to internal PostgreSQL user UUIDs.
- Preserve current HTTP route paths and response field names unless a field is intentionally added.
- Store all monetary values as integer minor units in PostgreSQL and convert to major-unit numbers only at the HTTP boundary.
- Derive the acting membership from the verified Firebase user. Never authorize from a client-provided member ID.
- Every expense write, including its splits and receipt metadata, must be atomic.
- Every expense allocation must sum exactly to the expense total. Equal-split remainders are assigned deterministically.
- Never hard-delete financial participants. Use membership status and anonymization so historical ledgers remain valid.
- Receipt bytes must not be stored in PostgreSQL. Store only object metadata and keys.
- PostgreSQL is the only runtime database after the cutover; MongoDB remains only as the migration source.
- Use test-driven development for production behavior: write and run a failing test before implementation, then run it green.
- Do not require a live PostgreSQL instance for unit tests. Database integration tests may be conditional on `TEST_DATABASE_URL`.

## Task 1: Schema, money allocation, and database foundation

Create the PostgreSQL foundation and exact money behavior.

Files:

- Update `backend/package.json` and lockfile with `pg`, `zod`, `vitest`, and PostgreSQL typings.
- Replace `backend/src/database.ts` with a PostgreSQL pool, transaction helper, and shutdown helper.
- Add `backend/src/db/migrations/001_initial.sql` defining users, trips, trip_memberships, trip_invites, expenses, expense_splits, receipts, payments, and chat_messages.
- Add `backend/src/db/migrate.ts` and package scripts for migration and tests.
- Add `backend/src/domain/money.ts` plus tests.

Required behavior:

- `allocateEqual(totalMinor, memberIds)` rejects nonpositive totals and an empty or duplicate member list.
- Allocation is deterministic and sums exactly to `totalMinor`; for 10,000 across three IDs it returns 3,334, 3,333, 3,333 in input order.
- `majorToMinor` accepts a positive decimal with at most two fraction digits and rejects floating-point artifacts, zero, negatives, and excess precision.
- Migration constraints enforce same-trip composite foreign keys, positive amounts, unique members per split, membership uniqueness, one owner per trip, useful indexes, and an atomic/deferred split-total invariant.
- Database configuration requires `DATABASE_URL` and supports TLS configuration through `DATABASE_SSL`.

Verification:

- Money tests pass.
- TypeScript backend build passes.
- If `TEST_DATABASE_URL` exists, apply the migration to an empty test database and exercise its constraints.

## Task 2: PostgreSQL repositories and authorized API routes

Replace Mongoose models and route queries with a PostgreSQL service/repository layer while keeping the frontend contract stable.

Files:

- Add repository/service modules under `backend/src/repositories` and `backend/src/services`.
- Refactor `backend/src/routes/auth.ts` and `backend/src/routes/api.ts`.
- Remove runtime imports of `backend/src/models.ts`; delete it once unused.
- Add route/service tests using injected repositories or a test database.

Required behavior:

- User sync performs an upsert keyed by Firebase UID.
- Trip creation atomically creates the trip and owner membership.
- Join is idempotent for an existing active user membership, rejects locked trips, and enforces unique active names.
- Every trip read/write/message/balance route requires active membership.
- Lock/unlock and removing another member require owner/admin role.
- The server derives expense payer and message sender from the authenticated membership; client identifiers cannot impersonate another member.
- Expense creation validates split method, split membership, duplicates, totals, and selected equal-split members.
- Leaving/removal updates membership status rather than deleting historical data.
- Account deletion anonymizes the PostgreSQL user/memberships before deleting Firebase authentication, with retry-safe state.
- Balances include expenses and confirmed payments and sum to zero in minor units; settlement suggestions are derived.
- Cursor-friendly message ordering uses `(created_at, id)` and bounded limits.

Verification:

- Authorization, expense validation, equal-split selection, and balance tests pass.
- Backend TypeScript build passes.
- Existing frontend build passes against the preserved API types.

## Task 3: Receipt storage boundary and migration tooling

Stop sending Base64 receipts inside expense JSON and provide a practical migration path.

Files:

- Add a `ReceiptStorage` interface with a local filesystem implementation for development and a no-op/disabled mode when uploads are not configured.
- Add authenticated receipt upload/read endpoints that return metadata or signed/application URLs.
- Update frontend receipt upload flow to use the upload endpoint and send a receipt ID with expense creation.
- Add `backend/src/scripts/migrate-mongo-to-postgres.ts` and documentation/environment examples.
- Update README setup and deployment instructions.

Required behavior:

- Upload accepts only supported image MIME types, enforces a configurable size limit, and derives authorization from trip membership.
- Object keys are generated server-side; supplied filenames cannot control filesystem paths.
- Expense creation may attach only a receipt uploaded for the same trip by the acting membership.
- Migration is restartable/idempotent, preserves legacy IDs in mapping tables or columns, converts amounts to minor units, extracts data-URL receipts, and reports invalid/orphaned records without silently importing them.
- Migration supports dry-run and verifies counts, references, split totals, and zero-sum trip balances before cutover.

Verification:

- Receipt validation and path-safety tests pass.
- Migration transformation tests pass against fixtures.
- Backend and frontend builds pass.

## Task 4: Final integration, documentation, and full review

Review the complete branch against this plan and close integration gaps.

Required behavior:

- Remove Mongoose runtime dependencies and MongoDB keep-alive behavior.
- Add `.env.example` files without secrets.
- Ensure startup fails clearly when PostgreSQL configuration is absent and performs graceful pool shutdown.
- Run all backend tests, backend build, and frontend build.
- Review migrations for rollback/cutover guidance and document deployment order.
- Inspect the final diff for secrets, generated artifacts, stale MongoDB references, unsafe receipt paths, floating-point persistence, and routes missing membership checks.

