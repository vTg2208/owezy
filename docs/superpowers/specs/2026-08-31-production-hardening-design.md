# Owezy Production Hardening Design

## Objective

Turn Owezy from a working PostgreSQL-backed MVP into a production-operable India-first trip ledger with complete settlement workflows, retry-safe financial writes, secure invitations, shared receipt storage, observable operations, scalable reads, accessible UX, and automated release checks.

## Fixed decisions

- Deployment: Vercel frontend, Railway Node backend and PostgreSQL, Cloudflare R2 receipt objects.
- Currency: one immutable ISO 4217 currency per trip; new trips default to INR. Cross-currency conversion is out of scope.
- Settlements: the payer records a pending payment and the recipient confirms or rejects it. Only confirmed payments affect balances.
- Corrections: financial history is append-only. Expenses are corrected by creating a new version or voiding the current version; rows are not hard-deleted.
- Idempotency: every expense, payment, invite, and correction write accepts an `Idempotency-Key` scoped to actor and route.
- Identity: email, display name, and verification state come from Firebase token claims, not request bodies.
- Realtime: initial trip state comes from one snapshot endpoint. Foreground refresh is deduplicated and visibility-aware; chat is cursor paginated. Multi-instance push transport is deferred until a durable pub/sub service is selected.
- UI: calm, companionable travel notebook; WCAG 2.2 AA; light theme first with token architecture ready for dark mode.

## Backend architecture

Migration 006 adds trip currency, expense lifecycle/version fields, payment confirmation metadata, hashed invitation tokens, idempotency records, and audit events. Repositories keep authorization and mutation in the same transaction. Services validate bounded inputs, own state transitions, and return typed domain responses. Routes expose a versioned `/api/v1` contract while preserving `/api` compatibility during transition.

Financial writes use a reusable idempotency executor. The first request stores a request hash and serialized response; a matching retry returns that response, while reuse with a different payload returns 409. Expense corrections preserve the original logical expense identifier and increment a transactionally locked version. Voiding removes an expense from active balance calculation without erasing history.

Payment states are `pending`, `confirmed`, `rejected`, and `cancelled`. The payer may create or cancel; only the payee may confirm or reject. Audit events capture actor, action, entity, and non-secret metadata.

## Security and operations

The server validates all environment variables at startup, uses an explicit CORS allow-list, Helmet, bounded JSON/raw bodies, per-IP and per-UID rate limits, request IDs, structured JSON logs, and separate `/live` and `/ready` probes. Shutdown has a deadline.

Room codes remain a human convenience but use cryptographic randomness. Secure join links use high-entropy tokens stored only as SHA-256 hashes with expiry and revocation. Firebase middleware rejects unverified password-provider identities and exposes trusted claims to routes.

R2 implements the existing `ReceiptStorage` interface through the S3-compatible API. Pending receipts are removed by an authenticated scheduled cleanup command that deletes the object before metadata. Reconciliation reports missing and orphaned objects. Local storage remains available only for development.

## Frontend architecture

The API client owns authentication, timeouts, error decoding, request IDs, idempotency headers, and response types. Trip pages fetch one snapshot, derive current membership from the server, and do not store membership IDs. Refresh is deduplicated, abortable, focus-aware, and backs off after failure.

The expense form uses decimal strings and deterministic minor-unit allocation. Settlement screens record, confirm, reject, and cancel payments. Expenses can be corrected or voided with explicit confirmation and visible history. Chat renders chronologically, loads older pages with the cursor, and announces send failures.

The interface uses semantic tokens, associated labels, proper tabs and dialogs, live regions, visible focus, reduced-motion fallbacks, 44px targets, and contrast-verified colors. Native dialogs are avoided where inline confirmation works.

## Verification

- Unit tests cover every new transition and regression before implementation.
- PostgreSQL integration tests run migrations 001-006 and concurrent/idempotent writes against a real service.
- Frontend component tests cover split rounding, errors, tabs, dialog keyboard behavior, and settlement actions.
- Playwright covers register/login stubs, trip creation/joining, expense entry, payment confirmation, direct trip links, and account deletion against deterministic test adapters.
- CI runs lint, typecheck, unit/integration tests, production builds, and dependency audits.
- Deployment documentation includes migrations, R2 setup, backup/PITR, restore drill, health checks, cleanup scheduling, and rollback.

## Success criteria

No duplicate financial record can be created by a retry; confirmed payments change balances exactly once; every privileged transition is actor-authorized in the mutation transaction; receipts survive horizontal backend deployment; trip load does not repeatedly download full history; all automated checks pass with PostgreSQL integration tests enabled; and the primary flows are keyboard-usable at WCAG 2.2 AA contrast.
