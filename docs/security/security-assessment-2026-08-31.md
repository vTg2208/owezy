# Application Security Assessment — 2026-08-31

## Executive summary

The Owezy repository was reviewed as an authenticated React/Express/PostgreSQL application, attacked with controlled local inputs, remediated, and retested. No confirmed Critical finding remained. Two High, five Medium, and seven Low findings were confirmed and fixed. The backend runtime was also moved from end-of-life Node 20 to a pinned, non-root Node 24 distroless image after the original image scan reported 41 fixable High/Critical package findings.

The final local gate passed on Node 24.20.0 with PostgreSQL 18: lint, 237 backend tests, 19 frontend tests, both production builds, 6 Playwright flows, both npm audits, and Trivy filesystem/configuration/secret scanning. The exact distroless runtime base reported zero fixable High/Critical vulnerabilities. External cloud control-plane state was not accessible and is listed separately rather than assumed secure.

## Attack-surface map

- Frontend: React 18, Vite 7, React Router, Firebase browser authentication, Vercel headers and SPA rewrites.
- Backend: Express 4 TypeScript API, Firebase Admin bearer-token authentication, per-IP and per-UID limiting, Helmet, exact-origin CORS, structured logging.
- Data: PostgreSQL 18 with transactional repositories, migration-managed constraints, idempotency records, and immutable audit records.
- Files: authenticated JPEG/PNG/WebP receipt upload and read paths, local or private R2-compatible object storage, server-generated keys, checksums, pending-object cleanup and reconciliation jobs.
- Roles/workflows: owner/member trip authorization, invitations, versioned expenses, payment state transitions, member removal, locking, account deletion, and audit history.
- Delivery: pinned GitHub Actions, pinned PostgreSQL test image, multi-stage backend container, Railway/Vercel operational configuration.
- Not present: application cookies, custom JWT signing, webhooks, administrative backdoor routes, dynamic SQL identifiers derived from requests, public receipt URLs, or infrastructure-as-code defining cloud IAM.

## Findings and disposition

| Severity | Vulnerability | Component | Status |
| --- | --- | --- | --- |
| High | Stale authentication could authorize account deletion | Firebase auth / account route | Fixed and tested |
| High | EOL runtime image with fixable High/Critical findings | Backend container | Fixed; final base rescanned |
| Medium | Revoked/disabled Firebase tokens were not checked | Auth middleware | Fixed and tested |
| Medium | Proxy-unaware rate limiting collapsed clients behind Railway | Express server | Fixed and tested |
| Medium | Invitation bearer secret exposed in URL query | Frontend invitations | Fixed and tested |
| Medium | Unbounded persisted request fields enabled storage/availability abuse | Services and PostgreSQL | Fixed and tested |
| Medium | Expense pagination cast opaque text IDs as UUID | PostgreSQL repository | Fixed and tested |
| Low | Room codes used predictable `Math.random` | ID helper | Fixed and tested |
| Low | Unexpected-error logs included raw error messages | Express error handler | Fixed and tested |
| Low | Invitee email PII was copied into member-visible audit metadata | Audit persistence | Fixed, scrubbed, and tested |
| Low | Invite revocation client omitted replay protection | Frontend API client | Fixed and tested |
| Low | Invite name conflict suffix could exceed the database boundary | Invitation repository | Fixed and tested |
| Low | `pgcrypto` could be installed into a temporary schema | Database migration | Fixed and tested |
| Low | Missing browser/container/supply-chain hardening | Vercel, Docker, CI, Firebase startup | Fixed and scanned |

## Confirmed vulnerabilities and remediations

### 1. Stale authentication on account deletion — High

- Affected: `backend/src/routes/auth.ts`.
- Attack and root cause: a valid but old Firebase ID token was sufficient for the destructive account endpoint; the route did not check `auth_time`.
- Impact: possession of a stale session could delete the application account and invoke Firebase account deletion.
- Safe reproduction: a synthetic authenticated principal with an authentication age greater than five minutes received success before the fix.
- Fix: account deletion now requires a non-future `auth_time` no older than five minutes and otherwise returns 403.
- Regression: the route suite proves stale authentication is rejected and the deletion service is not invoked.

### 2. Vulnerable end-of-life backend runtime — High

- Affected: `backend/Dockerfile`, package engines, and CI runtime.
- Attack and root cause: the pinned Node 20 Alpine image was end-of-life and the exact image scan found 41 fixable High/Critical OS or bundled-tool entries.
- Impact: avoidable vulnerable code and unsupported runtime packages would be present in the network-facing backend container.
- Safe reproduction: Trivy scanned the immutable original image digest without executing it.
- Fix: Node 24.20.0 LTS is enforced; build and runtime stages are separately pinned; the final stage is a non-root distroless Debian 13 Node image with no shell or package manager.
- Regression: the exact final runtime base scans at zero fixable High/Critical findings, Dockerfile configuration scans cleanly, and CI now builds and scans the assembled image.

### 3. Revoked tokens remained usable — Medium

- Affected: `backend/src/middleware/auth.ts`.
- Attack and root cause: Firebase `verifyIdToken` used its default mode, which verifies signature/expiry but does not check revocation or disabled/deleted users.
- Impact: a revoked stolen token could continue calling authenticated APIs until token expiry.
- Safe reproduction: the verifier boundary test observed that the revocation argument was absent.
- Fix: required and optional authentication always call `verifyIdToken(token, true)`, require verified email for every provider, require `auth_time`, and bound the derived display name.
- Regression: middleware tests cover the revocation flag, missing claims, federated unverified email, and bounded names.

### 4. Reverse-proxy rate-limit identity failure — Medium

- Affected: `backend/src/server.ts` and deployment configuration.
- Attack and root cause: Express did not trust the verified proxy hop, so proxied clients collapsed to one address; an overly permissive correction would instead trust spoofed forwarding headers.
- Impact: one client could consume a global quota, while unsafe proxy trust could permit rate-limit bypass.
- Safe reproduction: two synthetic forwarded client addresses shared one limit before configuration; a direct client also attempted forwarding-header spoofing.
- Fix: bounded `TRUST_PROXY_HOPS` configuration is mandatory in production and defaults to zero outside production. Operations document the currently expected single Railway hop and revalidation requirement.
- Regression: server tests prove trusted proxied clients are separated and direct clients cannot spoof their identity.

### 5. Invitation token in query string — Medium

- Affected: `frontend/src/components/InvitePanel.tsx`, `frontend/src/pages/Home.tsx`, authentication navigation.
- Attack and root cause: bearer invitation tokens were placed in `?invite=`, exposing them to hosting/access logs, browser history listings, and referrer handling.
- Impact: token disclosure could let a matching authenticated account consume or interfere with an invitation.
- Safe reproduction: the invitation link component produced a query-bearing URL.
- Fix: tokens use URL fragments, are immediately removed after capture, and query tokens are deliberately ignored. Unauthenticated flows carry the fragment only in router history state through login/registration; return targets are restricted to same-origin application paths.
- Regression: component, parser, protected-route, and safe-return tests cover link generation, query rejection, fragment removal, login handoff, and open-redirect rejection.

### 6. Unbounded persisted inputs — Medium

- Affected: trip, expense, invite, receipt configuration, and migration `007_security_boundaries.sql`.
- Attack and root cause: several server schemas relied on frontend or database type defaults and allowed very large strings/arrays or upload-limit configuration.
- Impact: authenticated storage growth, expensive processing, constraint errors, and availability degradation.
- Safe reproduction: oversized trip names, expense descriptions/splits, invite email, and receipt limits were accepted before remediation.
- Fix: application limits cover trip/member names, room codes, descriptions, split count, email length, and a 20 MiB configuration ceiling. PostgreSQL `NOT VALID` constraints preserve legacy rows while enforcing every new write.
- Regression: service/config tests and PostgreSQL integration tests cover both accepted boundaries and rejected overflows.

### 7. Expense cursor type mismatch — Medium

- Affected: `backend/src/repositories/tripRepository.ts`.
- Attack and root cause: generated expense IDs are opaque text, but page-two cursor SQL cast the ID to UUID.
- Impact: any member could deterministically trigger database errors on later expense pages, affecting availability and normal access.
- Safe reproduction: a generated 24-character cursor ID reached a query containing `$3::uuid`.
- Fix: cursor IDs are compared as text.
- Regression: repository test asserts the opaque cursor uses `$3::text` and never a UUID cast.

### 8–14. Low-severity findings

- Room code entropy: replaced `Math.random` with cryptographic `randomInt`; deterministic mock regression confirms selection behavior.
- Log disclosure: raw exception messages are no longer logged; the regression injects a synthetic credential-like message and proves it is absent.
- Audit PII: new invite audit events omit email, and migration 007 temporarily disables the named immutable trigger only within the migration transaction to scrub historical email metadata before restoring immutability; repository and integration tests cover both properties.
- Replay protection: invitation revocation now always sends an idempotency key; the API boundary test verifies the header.
- Name boundary: conflict suffixing truncates the base name so the stored result cannot exceed 100 characters; repository boundary test covers it.
- Migration isolation: `pgcrypto` is installed in `public` and `digest` is schema-qualified; serialized migration tests pass across isolated test schemas.
- Defense in depth: CSP, HSTS, framing, MIME, referrer, permissions, opener/resource policies, container health check, sanitized Firebase startup errors, immutable image/action references, full-tree audit scripts, repository/secret/misconfiguration scanning, and final-image CI scanning were added. The unused direct `nanoid` dependency was removed.

## Adversarial tests performed

- Authentication: malformed/missing/revoked/unverified claims, stale destructive sessions, missing required claims, and account-status behavior.
- Authorization: cross-user trip, expense, payment, invite, audit, message, member, and receipt access/mutation tests; owner/member transition checks.
- Injection/input: parameterized SQL review, malformed JSON, unexpected types, oversized/boundary values, mass-assignment-resistant schemas, cursor tampering, and unexpected workflow state.
- Business logic: idempotent replay, payment terminal transitions, expense correction/version conflicts, invite expiry/email binding/revocation, trip lock/removal authorization, and concurrent database invariants.
- Files: MIME/magic-byte mismatch, unsupported executable/SVG types, oversized uploads, missing/foreign/expired receipt access, server-generated storage keys, path confinement, checksum and size verification.
- Frontend: no unsafe HTML sink found; no browser token persistence found; invitation/referrer handling, safe redirects, production bundle secret/test-marker checks, and source-map absence.
- Tooling: ESLint, TypeScript builds, Vitest, PostgreSQL 18 integration migrations, Playwright Chromium, npm production/full audits, npm tree validation, Git history/current-tree secret review, Trivy dependency/secret/misconfiguration scan, Dockerfile scan, and immutable runtime-image scan.

## Dependencies, secrets, and configuration

- npm production audit: zero known vulnerabilities.
- npm complete-tree audit: zero known vulnerabilities at the configured threshold; dependency tree resolves successfully.
- Trivy repository scan: zero vulnerabilities, secrets, or misconfigurations.
- Final distroless runtime base: zero fixable High/Critical findings.
- No committed private keys, service-account files, or confirmed credentials were found in the current tree or reviewed Git history. Example/test connection strings remain clearly synthetic.
- Firebase credential initialization no longer logs credential source paths or raw initialization errors.
- Major-version updates reported by `npm outdated` were not treated as vulnerabilities and were not forced into this security change.

## Items not fully verifiable from the repository

The following require authenticated inspection of the real provider control planes and were not tested against production:

- R2 bucket public-access state, object ACLs, encryption, retention, and the deployed access key's exact IAM scope.
- Railway service networking, database exposure/roles, actual proxy hop path, secret values, replica count, TLS termination, backups, and point-in-time recovery.
- Vercel's deployed response headers/CSP behavior, environment values, approved preview origins, and TLS/domain configuration.
- Firebase enabled providers, password policy, MFA/Identity Platform controls, authorized domains, service-account IAM scope, audit logging, and revocation behavior in the real project.
- Runtime logs, alerts, incident response, restore drills, and production data-retention enforcement.

## Remaining risks

- The in-memory rate-limit store is correct only for a single backend replica. A supported shared store is required before horizontal scaling.
- `TRUST_PROXY_HOPS=1` is appropriate only while the verified Railway path remains one trusted hop; topology changes require retesting.
- The Node build-stage image contains npm tooling that is not copied into production. Its scan reported four High entries in bundled build-only npm dependencies; the trusted lockfile, disabled lifecycle scripts, distroless final stage, and final-image CI scan limit exposure, but the builder pin should be refreshed when an upstream Node LTS image ships patched npm tooling.
- CSP necessarily permits HTTPS/WSS connections because the backend and Firebase endpoints are deployment-configured. Narrowing these directives to exact production domains remains desirable once those domains are stable.

## Final security status

All locally confirmed vulnerabilities are remediated with regression coverage. No obvious Critical or High application vulnerability remains in the reviewed code, and all executable local verification gates pass. Overall code-level posture is **strong with external-control verification required before production sign-off**.
