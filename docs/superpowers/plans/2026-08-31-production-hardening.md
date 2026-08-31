# Owezy Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved production-ready financial, security, storage, frontend, accessibility, and delivery improvements.

**Architecture:** Extend the constrained PostgreSQL ledger through additive migration 006 and transactional repositories, then expose a typed API consumed by a deduplicated React data layer. Infrastructure adapters remain injectable so local development and Cloudflare R2 production share the same domain services.

**Tech Stack:** Node.js 20.19+, Express 4, PostgreSQL 14+, TypeScript, Zod, Firebase Admin/Auth, AWS S3 client for R2, React 18, Vite 7, Vitest, Testing Library, Playwright, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-31-production-hardening-design.md`

## Global Constraints

- New trips default to INR and each trip has exactly one immutable currency.
- Only confirmed payments affect balances.
- Financial history is append-only; corrections and voids require audit events.
- Financial mutations are idempotent by actor, operation, request hash, and key.
- Trusted identity fields come only from verified Firebase claims.
- All new behavior follows red-green-refactor and additive migrations.
- UI meets WCAG 2.2 AA and the project design context in `.impeccable.md`.

---

### Task 1: Schema and domain primitives

**Files:** create `backend/src/db/migrations/006_production_hardening.sql`; modify money and migration tests.

**Produces:** trip currency, expense lifecycle/version, payment workflow, invitation token hashes, idempotency records, and audit events.

- [ ] Add a failing PostgreSQL integration test asserting all new constraints and indexes.
- [ ] Run the test with `TEST_DATABASE_URL` and confirm migration 006 is missing.
- [ ] Add migration 006 with additive backfills and deferred cross-table constraints.
- [ ] Add failing unit tests for exact decimal and remainder allocation helpers.
- [ ] Implement bigint-only helpers and run the focused tests green.
- [ ] Run all backend tests and commit `feat: add production ledger schema`.

### Task 2: Trusted authentication and API edge

**Files:** modify `middleware/auth.ts`, `routes/auth.ts`, `server.ts`, environment docs; create `middleware/rateLimit.ts`, `middleware/requestContext.ts`.

**Produces:** `AuthPrincipal`, claim-derived sync, verified-email policy, allow-listed CORS, Helmet, request IDs, structured logs, `/live`, and `/ready`.

- [ ] Write route and server tests for spoofed identity, unverified users, CORS, headers, limits, probes, and shutdown deadline.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement the middleware and bounded configuration with dependency injection.
- [ ] Run focused and complete backend suites green.
- [ ] Commit `feat: harden authentication and api edge`.

### Task 3: Idempotent expenses, corrections, payments, and invitations

**Files:** create focused services/repositories and tests; modify `routes/api.ts` and balance queries.

**Produces:** `IdempotencyService.execute`, expense correct/void endpoints, payment create/confirm/reject/cancel endpoints, invite create/revoke/accept endpoints, and audit listing.

- [ ] Write failing service tests for identical retry, conflicting retry, unauthorized transitions, double confirmation, correction version conflicts, expired invites, and audit creation.
- [ ] Run each focused test file red.
- [ ] Implement transactional repositories and minimal service behavior.
- [ ] Write failing route contract tests, then add endpoints and typed response mapping.
- [ ] Run backend tests green and commit `feat: complete financial workflows`.

### Task 4: Shared receipt storage and lifecycle jobs

**Files:** create `storage/r2ReceiptStorage.ts`, `jobs/receiptCleanup.ts`, scripts and tests; modify storage factory/config.

**Produces:** R2 adapter, cleanup/reconciliation command, startup configuration validation, and scheduler-safe locking.

- [ ] Write failing adapter tests against a fake S3 client and cleanup tests against fake metadata/storage adapters.
- [ ] Run focused tests red.
- [ ] Implement R2 operations, cleanup ordering, advisory locking, and dry-run reconciliation.
- [ ] Run focused and backend suites green.
- [ ] Commit `feat: add shared receipt lifecycle`.

### Task 5: Typed frontend data and complete product flows

**Files:** refactor `frontend/src/api.ts`, `App.tsx`, `TripDashboard.tsx`, expense/chat/settlement components; add hooks and tests.

**Produces:** typed `ApiError`, abortable deduplicated snapshot loading, server-derived membership, exact split builder, paginated chat, payment actions, corrections, invitations, and inline confirmations.

- [ ] Write failing tests for API error decoding, request timeout/idempotency headers, split remainder allocation, stale split removal, direct trip navigation, chat chronology, and payment state actions.
- [ ] Run focused frontend tests red.
- [ ] Implement small API, hooks, and feature components without effect-derived state.
- [ ] Run frontend tests and build green.
- [ ] Commit `feat: complete trip and settlement experience`.

### Task 6: Accessible travel-notebook interface

**Files:** replace `index.css`, update all pages/components, add accessibility tests and metadata assets.

**Produces:** semantic token system, accessible forms/tabs/dialogs/live regions, contrast-safe controls, reduced motion, responsive layout, and project metadata.

- [ ] Write failing Testing Library assertions for labels, tabs, dialog Escape/focus return, live errors, and accessible control names.
- [ ] Run focused tests red.
- [ ] Implement the design context using semantic CSS classes and minimal purposeful motion.
- [ ] Verify keyboard interactions and run frontend tests/build green.
- [ ] Commit `feat: redesign accessible owezy interface`.

### Task 7: CI, lint, end-to-end tests, and operations

**Files:** create GitHub Actions, ESLint, Playwright configuration/tests, Docker Compose test dependencies, and operational docs.

**Produces:** one-command verification, live PostgreSQL CI, browser smoke coverage, audits, backup/restore and deployment runbooks.

- [ ] Add CI configuration that initially fails because scripts/config are absent.
- [ ] Add lint/typecheck/verify scripts and resolve all reported source issues.
- [ ] Add deterministic Playwright adapters and the six critical flow tests from the spec.
- [ ] Add Railway/Vercel/R2 environment and operational documentation.
- [ ] Run the complete local verification command and commit `ci: enforce production quality gates`.

### Task 8: Final verification and requirement audit

**Files:** update README and security risk acceptance only if evidence changes.

- [ ] Re-read the spec and map every success criterion to a test or operational control.
- [ ] Run backend unit tests, live PostgreSQL integration tests, build, lint, and production audit.
- [ ] Run frontend unit tests, Playwright tests, build, lint, and production audit.
- [ ] Inspect `git diff`, migration ordering, secrets scan, and worktree cleanliness.
- [ ] Fix any failure through a new red-green cycle, rerun the full gate, and commit `docs: finalize production hardening`.
