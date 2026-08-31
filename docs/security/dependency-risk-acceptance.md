# Dependency risk acceptance

Date: 2026-08-31

## Current production audit

`npm audit --omit=dev` reports:

- Frontend: 0 vulnerabilities.
- Backend: 8 moderate vulnerabilities, 0 low, 0 high, and 0 critical.

The backend entries are `@google-cloud/firestore`, `@google-cloud/storage`, `firebase-admin`, `gaxios`, `google-gax`, `retry-request`, `teeny-request`, and `uuid`. They trace to an advisory in the optional Firebase Admin Firestore/Storage dependency chains that retain `uuid@9`.

## Why this is temporarily accepted

- The backend uses Firebase Admin Authentication only. It does not import or initialize Firestore or Cloud Storage.
- The application does not expose the affected UUID buffer-writing API to request data.
- No compatible patch is available in the current Node.js 20-supported Firebase Admin dependency line. The audit-proposed remediation is a breaking dependency-line change rather than a compatible security patch.
- All high and critical production advisories were removed during the PostgreSQL redesign.

## Controls and review trigger

- Firestore and Cloud Storage must not be introduced without revisiting this acceptance.
- Production audit results must remain at zero high and zero critical findings.
- Re-run both production audits during every dependency upgrade and adopt a fixed Firebase Admin chain when one becomes compatible with the supported Node runtime.

