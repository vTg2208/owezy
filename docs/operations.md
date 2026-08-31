# Owezy production operations

## Deployment topology

- Vercel serves the `frontend` Vite project. Set its Root Directory to `frontend`.
- Railway runs the `backend/Dockerfile` and a managed PostgreSQL service in the same project/environment.
- Cloudflare R2 holds private receipt objects. Objects are read only through the authenticated backend.
- Firebase provides browser authentication and server-side token verification.

Use separate Firebase projects, PostgreSQL databases, R2 buckets, and environment variables for staging and production. Never copy production service credentials into preview deployments.

## Required production variables

Railway backend:

| Variable | Production value/control |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Supplied by Railway |
| `DATABASE_URL` | Private Railway PostgreSQL reference |
| `DATABASE_SSL` | `false` for Railway private networking; `true` for an external TLS endpoint |
| `CORS_ALLOWED_ORIGINS` | Exact comma-separated Vercel production and approved preview origins |
| `TRUST_PROXY_HOPS` | Verified reverse-proxy hop count; `1` for the current direct Railway edge-to-service path |
| `FIREBASE_SERVICE_ACCOUNT` | Complete Firebase service-account JSON stored as a Railway secret; alternatively use `GOOGLE_APPLICATION_CREDENTIALS` with a securely mounted file |
| `RECEIPT_STORAGE_DRIVER` | `r2` |
| `R2_ENDPOINT` | Account S3 endpoint |
| `R2_BUCKET` | Private production bucket name |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Bucket-scoped object credentials |
| `RECEIPT_MAX_BYTES` | `5242880` unless the product limit changes |
| `RECEIPT_PENDING_TTL_HOURS` | `24` |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `5000` |
| `DATABASE_QUERY_TIMEOUT_MS` | `10000` |
| `SHUTDOWN_TIMEOUT_MS` | `10000` |
| `UID_RATE_LIMIT_WINDOW_MS`, `UID_RATE_LIMIT_MAX` | `900000` and `180`; tune from observed authenticated traffic |

Vercel frontend:

| Variable | Production value/control |
| --- | --- |
| `VITE_API_URL` | Public Railway URL ending in `/api` |
| `VITE_FIREBASE_*` | Public web-app configuration from the production Firebase project |
| `VITE_E2E_AUTH` | Never set outside Playwright's local/CI web server |

## Release procedure

1. Require the GitHub `quality` job before merging.
2. Create a manual PostgreSQL backup before a schema release.
3. Build the Railway service from `backend/Dockerfile`.
4. Run `node dist/db/migrate.js` as Railway's pre-deploy command. A migration failure must stop deployment.
5. Start with `node dist/server.js`; configure the service health check as `/ready` with at least a 30-second timeout.
6. Deploy the Vercel project only after the backend is ready. Verify `/live`, `/ready`, login, direct trip navigation, an expense read, and an authenticated receipt read.
7. Schedule `node dist/scripts/cleanup-receipts.js --limit=100` at least daily in a separate Railway cron service using the same backend image and variables. Its advisory lock makes overlapping runs yield safely.

Before changing Railway networking or placing another CDN/proxy in front of it, re-verify `TRUST_PROXY_HOPS`; an incorrect value can collapse the IP limiter into a global limiter or trust a client-supplied address. The in-process rate-limit store is intentionally a single-replica control. Before scaling the backend above one replica, replace it with a shared supported store and re-run the rate-limit security tests.

Railway's legacy `railway.toml`/`railway.json` Config-as-Code path is not used because it is retired for new services in December 2026. After linking the real Railway project, run `railway config init`, review the generated `.railway/railway.ts`, and apply it through `railway config plan`/`railway config apply`; resource IDs and secret references must come from that linked project rather than being guessed in source.

## PostgreSQL backup and restore

Enable three independent layers before launch:

1. Daily and weekly Railway volume backups.
2. Railway point-in-time recovery (PITR).
3. A daily encrypted custom-format logical dump stored outside the Railway project.

Create a portable dump with PostgreSQL client tools:

```bash
pg_dump "$DATABASE_PUBLIC_URL" --format=custom --no-owner --no-acl --file=owezy-YYYYMMDD-HHMM.dump
```

Never test a restore over production. Provision a scratch PostgreSQL database, restore, migrate, and compare table counts and recent financial rows:

```bash
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl --exit-on-error owezy-YYYYMMDD-HHMM.dump
DATABASE_URL="$RESTORE_DATABASE_URL" node backend/dist/db/migrate.js
psql "$RESTORE_DATABASE_URL" -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;"
```

Perform and record a restore drill quarterly. Record backup age (RPO), restore duration (RTO), row-count comparison, ledger balance checks, and the reviewer. For an accidental write or destructive migration, restore PITR to a new sibling service immediately before the incident, validate it, then change the backend `DATABASE_URL`. Keep the original database read-only until reconciliation is complete.

## Receipt recovery and retention

R2 durability does not protect against intentional or accidental deletion. Use bucket-scoped credentials with only the required object permissions, restrict credential access to the backend/cleanup services, and keep a second independently credentialed copy if receipts have a regulatory retention requirement. Do not add a bucket lifecycle delete rule for attached receipt prefixes. The application cleanup command is the authority for expired pending uploads because it deletes the object before its metadata.

Run `node dist/scripts/reconcile-receipts.js --limit=500` regularly and page through `nextMetadataAfter`/`nextObjectCursor`; exit code `2` means missing or orphaned objects were found and requires investigation, never automatic deletion. Quarterly, sample PostgreSQL `receipts` rows and verify object size/checksum from R2. Rotate R2 and Firebase Admin credentials at least every 90 days or immediately after exposure: create the replacement, deploy it, verify reads/writes, then revoke the old credential.

## Incident and rollback

- Application regression: roll Railway and Vercel back to the prior image/deployment. Additive migrations remain in place; do not reverse them destructively.
- Database corruption or bad writes: close writes, use PITR to a sibling, validate, then cut over.
- R2 outage: keep metadata intact, pause receipt cleanup, and retry object operations after service recovery.
- Credential leak: rotate the affected key, inspect structured request logs/audit events, revoke active sessions when needed, and document the exposure window.
- Readiness failure: inspect the request ID in structured backend logs, PostgreSQL reachability, migration state, and configuration validation before reopening traffic.

## Platform references

- [Railway PostgreSQL backup, PITR, logical dump, and restore guidance](https://docs.railway.com/guides/postgres-backups-restores)
- [Railway Infrastructure-as-Code CLI workflow](https://docs.railway.com/cli)
- [Vercel monorepo root-directory configuration](https://vercel.com/docs/monorepos)
- [Vercel rewrite configuration](https://vercel.com/docs/routing/rewrites)
- [Cloudflare R2 durability and deletion caveats](https://developers.cloudflare.com/r2/reference/durability/)
- [Cloudflare R2 consistency guarantees](https://developers.cloudflare.com/r2/reference/consistency/)
