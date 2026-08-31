# Dependency risk acceptance

Date: 2026-08-31

## Current audit

Both `npm audit` and `npm audit --omit=dev` report zero known vulnerabilities across the workspace as of the date above. Trivy's filesystem dependency scan also reports zero vulnerabilities.

There is no active dependency-risk acceptance. The root overrides pin patched transitive versions where upstream ranges would otherwise retain a vulnerable release.

## Controls and review trigger

- Firestore and Firebase Cloud Storage must not be introduced without a new threat review; the backend currently uses Firebase Admin Authentication only.
- Production audit results must remain at zero known vulnerabilities, and the complete development tree must remain at zero high/critical findings.
- Re-run npm and Trivy scans during every dependency or base-image update and remove overrides when upstream dependency ranges make them unnecessary.
