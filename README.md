# Trip Expense Manager

Trip Expense Manager is a React and Express application for shared trip expenses, exact balance calculations, settlement suggestions, chat, and private receipt images.

## Features

- Create or join trips with a room code.
- Equal, custom, and percentage expense splits.
- Exact integer-minor-unit money persistence and zero-sum balance verification.
- Firebase Authentication with trip membership and owner authorization.
- Authenticated JPEG, PNG, and WebP receipt upload/read endpoints.
- Pending receipt state so an upload can occur before its expense is created.
- PostgreSQL application persistence and a restartable MongoDB migration command.

Receipt bytes are never stored in PostgreSQL or expense JSON. PostgreSQL stores only a server-generated storage key, MIME type, byte size, and SHA-256 checksum. `receipt_url` remains the frontend response field, but it now contains an authenticated application URL rather than Base64 data or an opaque storage key.

## Stack and prerequisites

- Node.js 20+
- PostgreSQL
- Firebase project and Admin credentials
- MongoDB access only while migrating a legacy deployment

The frontend uses React 18, Vite, TypeScript, and Tailwind CSS. The backend API routes use Express, TypeScript, and PostgreSQL through `pg`; the migration command uses the MongoDB Node driver for source reads.

## Local setup

Install dependencies:

```bash
cd backend
npm install
cd ../frontend
npm install
```

Create `backend/.env` from `backend/.env.example`:

```env
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/owezy
DATABASE_SSL=false
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
RECEIPT_STORAGE_ROOT=./var/receipts
RECEIPT_MAX_BYTES=5242880
RECEIPT_PENDING_TTL_HOURS=24
```

`RECEIPT_STORAGE_ROOT` is optional. If it is absent, receipt storage is disabled and upload attempts return a service-unavailable response. Paths are resolved under the configured root and object names are generated deterministically from server-issued receipt IDs, so an interrupted write can be identified and safely replaced on retry. The default backend upload limit is 5 MiB; the frontend intentionally leaves byte-limit enforcement to the configured backend.

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

Start the frontend separately:

```bash
cd frontend
npm run dev
```

## Receipt lifecycle and cleanup

`POST /api/trips/:tripId/receipts` accepts a raw image body after Firebase authentication. The upload is stored as `pending` with `pending_expires_at`. Creating an expense with its `receiptId` locks and attaches that receipt in the same PostgreSQL transaction as the expense and splits; the receipt must belong to the same trip and acting membership.

Pending rows older than `RECEIPT_PENDING_TTL_HOURS` are cleanup candidates. Cleanup must remove the object through the same path-safe storage implementation before deleting its metadata. Operators can identify candidates with:

```sql
SELECT id, storage_key
  FROM receipts
 WHERE status = 'pending'
   AND pending_expires_at <= now();
```

After the corresponding objects are removed, delete only those expired pending rows. Never use a storage key as an unrestricted filesystem path.

The local filesystem implementation is intended for development or a single backend instance with a durable mounted disk. Ephemeral deployment filesystems will lose receipts. Production deployment must configure a persistent disk at `RECEIPT_STORAGE_ROOT` and ensure every serving instance sees the same storage, or keep uploads disabled until a shared `ReceiptStorage` implementation is provided.

## Legacy MongoDB migration

Migration requires migrations 001-004 to be applied first. Take a MongoDB backup, stop legacy writes, configure the target PostgreSQL database and receipt root, then set migration-only source values:

```env
MONGODB_URI=mongodb://localhost:27017/tripexpense
MONGODB_DATABASE=tripexpense
DATABASE_URL=postgres://postgres:postgres@localhost:5432/owezy
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
- uses idempotent PostgreSQL upserts, receipt mapping/row/object checks, and per-trip transactions;
- verifies persisted counts, references, expense split totals, and zero-sum trip balances; and
- exits unsuccessfully if preflight or post-write verification finds an issue.

It is safe to rerun after a failure. Before skipping a receipt, the migration proves that its mapping identity, PostgreSQL metadata, byte size, checksum, and stored bytes match the source. Missing rows or objects and corrupt bytes are repaired at the deterministic server key. Failed per-trip transactions clean up newly written objects and surface any cleanup failure so operators know that a recoverable orphan remains. Keep the MongoDB backup and source deployment read-only until post-write verification and application smoke tests pass.

For rollback, stop the new backend and restore traffic to the read-only legacy deployment plus its backup; do not attempt to reverse the additive PostgreSQL schema in place. Investigate and correct the migration, then rerun it before cutover.

## Verification

```bash
cd backend
npm test
npm run build
cd ../frontend
npm run build
```

PostgreSQL migration integration tests run only when `TEST_DATABASE_URL` is configured.

## Deployment

Deploy in this order:

1. Provision and back up PostgreSQL.
2. Configure Firebase credentials, `DATABASE_URL`, and TLS with `DATABASE_SSL=true` where required.
3. Provision durable receipt storage and set `RECEIPT_STORAGE_ROOT`, or leave uploads disabled.
4. Build the backend with `npm install && npm run build`.
5. Run `npm run migrate` as a release step before starting the new backend.
6. If migrating, complete the dry-run, migration, verification, and smoke tests before opening writes.
7. Start the backend with `npm start`.
8. Deploy the Vite frontend with `VITE_API_URL=https://your-backend.example/api` and the Firebase `VITE_*` values.

Do not place Firebase service-account JSON, database passwords, MongoDB credentials, or receipt files in source control.

## Author

Vishnu Vardhan Theegela
