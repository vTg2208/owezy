# Production hardening verification matrix

Verified on 2026-08-31 against Node.js 20-compatible tooling, PostgreSQL 18, and Chromium.

| Requirement | Implementation control | Automated/operational evidence |
| --- | --- | --- |
| One immutable currency per trip, default INR | Migration 006 constraints/backfill; bigint minor-unit domain | Migration 006 integration and money tests |
| Retry cannot duplicate a financial write | Transaction-scoped actor/operation/key/request-hash records | `idempotencyService.test.ts` and live financial workflow integration |
| Only confirmed payments affect balances once | Recipient-only terminal transition and confirmed-only balance query | Payment service/repository tests and live workflow integration |
| Privileged transitions authorize in the mutation transaction | Repository actor membership/role locks | Expense, payment, invite, account, and trip repository/service tests |
| Corrections preserve history | Versioned replacement/void rows plus immutable audit events | Migration, expense service/repository, route, and activity UI tests |
| Identity cannot be spoofed by request bodies | Firebase claim-derived principal, verified password email, strict bearer parsing | Auth middleware/route tests |
| Abuse is bounded per IP and trusted UID | Global IP limiter plus authenticated UID limiter | Server tests for independent IP and UID buckets |
| Receipts survive multiple backend instances | Private R2 S3 adapter; production rejects local disk | R2/config tests and deployment environment control |
| Receipt drift is detectable without mutation | Bounded `receipts:reconcile` missing/orphan report | Reconciliation and R2 list/head tests |
| Cleanup cannot orphan metadata deliberately | Object delete precedes conditional metadata delete under advisory lock | Cleanup unit and PostgreSQL integration tests |
| Trip refresh does not repeatedly fetch full history | 50-row keyset expense page, cursor loading, deduplicated focus-aware snapshot | Repository route/hook tests and direct-link Playwright flow |
| Exact split math | Decimal-string input and deterministic remainder allocation | Split builder tests including ₹10.00 across three members |
| Primary UI is keyboard accessible | Semantic labels/tabs/dialog, focus return, live errors, 44px controls, reduced motion | Testing Library keyboard/dialog tests and six Chromium flows |
| Text/control contrast meets WCAG AA | Semantic paper/ink/forest/danger palette | Calculated minimum tested semantic pair: muted text on paper 5.39:1 |
| Releases are reproducible and observable | Root lockfile, lint/test/build/audit gate, request IDs/logs, live/ready probes | GitHub `quality` workflow and `npm run verify` |
| Recovery is rehearsable | Additive migrations, Railway backup/PITR, offsite dumps, scratch restore drill, non-destructive rollback | `docs/operations.md` quarterly drill procedure |

## Latest complete gate

- Backend: 32 files / 222 tests, including live PostgreSQL migrations/workflows.
- Frontend: 8 files / 14 tests plus six Chromium critical-flow tests.
- ESLint and both TypeScript production builds: passed.
- Root production and full dependency audits: zero known vulnerabilities.
- Tracked-secret scan: only example environment templates are tracked; no private-key signatures or Firebase API-key patterns found.
