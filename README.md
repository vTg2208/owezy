# Owezy

Owezy is an India-first React and Express application for shared trip expenses, exact balance calculations, recipient-confirmed settlements, chat, and private receipt images.

## Features

- Create or join trips with a room code.
- Equal, custom, and percentage expense splits.
- Exact integer-minor-unit money persistence and zero-sum balance verification.
- Firebase Authentication with trip membership and owner authorization.
- Authenticated JPEG, PNG, and WebP receipt upload/read endpoints.
- Pending receipt state so an upload can occur before its expense is created.
- PostgreSQL application persistence and a restartable MongoDB migration command.
- Recipient-confirmed settlements; pending, rejected, and cancelled payments never change balances.
- Append-only expense corrections and voids with immutable audit history.
- Hashed, expiring trip invitations and transactional idempotency for financial writes.

Receipt bytes are never stored in PostgreSQL or expense JSON. PostgreSQL stores only a server-generated storage key, MIME type, byte size, and SHA-256 checksum. `receipt_url` remains the frontend response field, but it now contains an authenticated application URL rather than Base64 data or an opaque storage key.

## Stack and prerequisites

- Node.js 20.19.0 or newer
- PostgreSQL
- Firebase project and Admin credentials
- MongoDB access only while migrating a legacy deployment

The frontend uses React 18, Vite, TypeScript, and Tailwind CSS. The backend API routes use Express, TypeScript, and PostgreSQL through `pg`; the migration command uses the MongoDB Node driver for source reads.

## Local setup

Install the npm workspace from the repository root:

```bash
npm ci
```

Create `backend/.env` from `backend/.env.example`:

```env
PORT=3000
CORS_ALLOWED_ORIGINS=http://localhost:5173
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=300
SHUTDOWN_TIMEOUT_MS=10000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/owezy
DATABASE_SSL=false
DATABASE_CONNECTION_TIMEOUT_MS=5000
DATABASE_QUERY_TIMEOUT_MS=10000
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
RECEIPT_STORAGE_DRIVER=local
RECEIPT_STORAGE_ROOT=./var/receipts
RECEIPT_MAX_BYTES=5242880
RECEIPT_PENDING_TTL_HOURS=24
```

`CORS_ALLOWED_ORIGINS` is a comma-separated exact allowlist and is mandatory in production. API responses include security headers and request IDs; the default rate limit is 300 requests per 15 minutes per client. `SHUTDOWN_TIMEOUT_MS` bounds graceful HTTP shutdown before lingering connections are forced closed. `/live` reports process liveness, while `/ready` (and the backward-compatible `/health`) verifies PostgreSQL readiness.

`DATABASE_SSL=true` always verifies the PostgreSQL server certificate. Set `DATABASE_SSL_CA` to a PEM trust root when the platform CA is not sufficient; literal `\n` sequences are expanded. Connection and query timeouts are bounded positive millisecond values (defaults: 5,000 and 10,000). `RECEIPT_STORAGE_DRIVER` is `disabled`, `local`, or `r2`. Local storage requires `RECEIPT_STORAGE_ROOT`; paths are confined under that root and publication uses an exclusive temporary file plus atomic rename. R2 requires `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`; incomplete configuration stops startup. The default upload limit is 5 MiB.

Create `frontend/.env` from `frontend/.env.example`. The API value must include the backend `/api` prefix:

```env
VITE_API_URL=http://localhost:3000/api
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

Apply ordered PostgreSQL migrations before starting the backend:

```bash
cd backend
npm run migrate
npm run dev
```

Migrations are a release step and are not applied automatically by `npm start`: run `npm run migrate` successfully against the target `DATABASE_URL` before every backend start. The migration runner holds a PostgreSQL advisory lock on one checked-out client across the ledger check and ordered SQL application, records each completed filename in `schema_migrations`, and closes its pool on success or failure.

Start the frontend separately:

```bash
cd frontend
npm run dev
```

## Financial API lifecycle

New clients should use `/api/v1`; the existing `/api` routes remain available during migration. Send a unique `Idempotency-Key` header with every versioned expense write and every payment, correction, void, or invitation mutation. A matching retry returns the stored status and body with `Idempotency-Replayed: true`; reusing a key for a different payload returns `409`.

Payments start as `pending`. Only the recipient can confirm or reject them, only the payer can cancel them, and every terminal transition is final. Correcting an expense requires `expectedVersion`, voids the current row, and creates the next active version under the same logical `expense_key`; voiding also requires `expectedVersion`. Only active expense versions and confirmed payments contribute to balances.

Invitation responses expose the raw token once. PostgreSQL stores only its SHA-256 hash. Invitation acceptance requires the authenticated Firebase email to match, and all invitation mutation routes require an `Idempotency-Key`. Audit history is available to active trip members at `GET /api/v1/trips/:tripId/audit`; payment state is available at `GET /api/v1/trips/:tripId/payments`.

## Receipt lifecycle and cleanup

`POST /api/trips/:tripId/receipts` accepts a raw image body after Firebase authentication. The upload is stored as `pending` with `pending_expires_at`. Creating an expense with its `receiptId` locks and attaches that receipt in the same PostgreSQL transaction as the expense and splits; the receipt must belong to the same trip and acting membership.

Pending rows older than `RECEIPT_PENDING_TTL_HOURS` are cleanup candidates. Preview a bounded cleanup without mutations:

```bash
cd backend
npm run receipts:cleanup -- --dry-run --limit=100
```

Run cleanup from one scheduler; the command also takes a PostgreSQL advisory lock so overlapping invocations safely yield. Object removal always precedes conditional metadata deletion:

```bash
npm run receipts:cleanup -- --limit=100
```

The command prints `{ scanned, removed, failed }` JSON and exits unsuccessfully when any removal fails. It is safe to retry because local and R2 deletes are idempotent. Operators can also inspect candidates with:

```sql
SELECT id, storage_key
  FROM receipts
 WHERE status = 'pending'
   AND pending_expires_at <= now();
```

Never delete metadata before its corresponding object and never use a storage key as an unrestricted filesystem path.

The local driver is intended only for development or one instance with a durable mounted disk. Production uses Cloudflare R2 so receipt bytes survive restarts and every backend instance sees the same objects. Following Cloudflare’s S3-compatible configuration, the adapter uses AWS SDK v3 with the configured endpoint and `region=auto`.

## Legacy MongoDB migration

Migration requires migrations 001-005 to be applied first. Migration 005 transfers any reachable legacy owner to the earliest connected active membership or archives and locks a trip that has no reachable owner. Archived trips cannot be joined. Take a MongoDB backup, stop legacy writes, configure the target PostgreSQL database and receipt root, then set migration-only source values:

```env
MONGODB_URI=mongodb://localhost:27017/tripexpense
MONGODB_DATABASE=tripexpense
DATABASE_URL=postgres://postgres:postgres@localhost:5432/owezy
RECEIPT_STORAGE_DRIVER=local
RECEIPT_STORAGE_ROOT=./var/receipts
```

Run a dry-run first:

```bash
cd backend
npm run migrate:mongo -- --dry-run
```

The dry-run reads source collections and reports duplicate IDs, invalid records, orphan references, invalid data-URL receipts, count differences, split-total failures, and non-zero trip balances without writing PostgreSQL or receipt storage. Resolve every reported issue before continuing.

Run the migration:

```bash
npm run migrate:mongo
```

The command:

- deterministically maps legacy Firebase user IDs to PostgreSQL UUIDs;
- preserves legacy trip, membership, expense, and message IDs through `legacy_id_mappings`;
- converts decimal amounts to integer minor units;
- extracts supported Base64 data-URL receipts into `ReceiptStorage` and stores metadata only in PostgreSQL;
- uses collision-rejecting PostgreSQL inserts, immutable legacy mappings, receipt mapping/row/object checks, and per-trip transactions;
- verifies every persisted mapped row identity and parent reference in addition to counts, expense split totals, and zero-sum trip balances; and
- exits unsuccessfully if preflight or post-write verification finds an issue.

It is safe to rerun after a failure. Before skipping a receipt, the migration proves that its mapping identity, PostgreSQL metadata, byte size, checksum, and stored bytes match the source. Missing rows or objects and corrupt bytes are repaired at the deterministic server key. Failed per-trip transactions clean up newly written objects and surface any cleanup failure so operators know that a recoverable orphan remains. Keep the MongoDB backup and source deployment read-only until post-write verification and application smoke tests pass.

For rollback, stop the new backend and restore traffic to the read-only legacy deployment plus its backup; do not attempt to reverse the additive PostgreSQL schema in place. Investigate and correct the migration, then rerun it before cutover.

## Verification

```bash
npm run verify
```

`verify` runs ESLint, backend and frontend unit/integration tests, both production builds, six Playwright browser flows, and the production dependency audit. PostgreSQL migration integration tests run only when `TEST_DATABASE_URL` is configured; CI always supplies a live PostgreSQL 18 service, so skipped integration tests are not accepted by the release gate. Install the browser once locally with `npx playwright install chromium`.

## Deployment

The detailed environment matrix, Railway/Vercel release sequence, scheduled receipt cleanup, key rotation, backup/restore drill, incident response, and rollback controls live in [`docs/operations.md`](docs/operations.md).

Deploy in this order:

1. Provision and back up PostgreSQL.
2. Configure Firebase credentials, `DATABASE_URL`, authenticated TLS with `DATABASE_SSL=true` (and `DATABASE_SSL_CA` when required), plus bounded database timeouts.
3. Provision Cloudflare R2 and set `RECEIPT_STORAGE_DRIVER=r2` plus its endpoint, bucket, and scoped object credentials.
4. Build the backend image from `backend/Dockerfile`.
5. Run `node dist/db/migrate.js` as a pre-deploy step before starting the new backend.
6. If migrating, complete the dry-run, migration, verification, and smoke tests before opening writes.
7. Start the backend with `npm start`.
8. Deploy the Vite frontend with `VITE_API_URL=https://your-backend.example/api` and the Firebase `VITE_*` values.

Do not place Firebase service-account JSON, database passwords, MongoDB credentials, R2 credentials, or receipt files in source control.

## Author

Vishnu Vardhan Theegela
