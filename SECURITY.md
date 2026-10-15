# Security Policy

## Supported Versions

Arbiter is currently deployed continuously from the `main` branch. Security fixes are applied directly to `main`.

| Version / Branch | Supported          |
| ---------------- | ------------------ |
| `main`           | :white_check_mark: |
| Older commits    | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, please report vulnerabilities privately using **[GitHub Private Vulnerability Reporting](https://github.com/Arbiter-xyz/arbiter-app/security/advisories/new)** on this repository.

When submitting a report, please include:

- The affected component(s) and file path(s) (e.g., `app/src/localWallet.js`, `app/src/contractCalls.js`, `app/src/admin.js`, `app/src/customer.js`, `landing/`).
- Step-by-step reproduction instructions or a minimal proof-of-concept.
- The potential impact (e.g., key extraction, unauthorized session token access, stored/reflected XSS in the worker/buyer/admin consoles, or Soroban XDR manipulation).

## Response Timeline

- **Initial acknowledgment:** within **48 hours** of report submission.
- **Triage & severity assessment:** within **5 business days**.
- **Remediation & coordinated disclosure:** we aim to ship a fix within **14 days** for critical/high-severity issues and coordinate public disclosure after the patch is deployed.

## Scope & Security Model Notes

- **Non-custodial browser wallet (`app/src/localWallet.js`):** Quick-start Stellar keys are generated client-side and migrated into non-extractable WebCrypto storage once backup is confirmed. Any bypass allowing secret extraction after `lockExport()` or XSS in the application pages (`app/*.html`) is considered high severity.
- **Session & bearer tokens (`app/src/session.js`, `app/src/admin.js`, `app/src/customer.js`):** Leakage of session tokens, API keys (`#apikey-reveal-input`), or admin bearer tokens (`#admin-token-input`) to third-party origins or telemetry/replay pipelines (`app/src/errorReporting.js`, `app/src/sessionReplay.js`) is in scope.
- **Cross-repository issues:** For vulnerabilities in the backend (`arbiter-backend`), Soroban contracts (`arbiter-contracts`), or SDKs (`arbiter-sdk`, `arbiter-Guillotine`), please report via the corresponding repository's Security Advisories tab or mention the cross-repo impact in your report here.
