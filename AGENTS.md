# Personal Blog Agent Instructions

## Scope

Work only within this independent repository. Do not modify parent-workspace
contracts from this repository without a separately scoped PIOS task.

## Safety rules

- Never read, print, change, or commit `.env`, cloud credentials, JWTs, or
  production database contents.
- Preserve the prohibition on PIOS Personal and Knowledge domain access.
- Keep every CMS mutation behind `authenticateToken`; public endpoints must
  not gain write access to CMS records or object storage.
- Record authentication, data-boundary, or external-integration changes in
  `DECISIONS.md`.

## Local verification

Run `npm run server:test`, `npm run verify:config`, and the relevant Angular
build/test command. The configuration check is expected to fail until a local
`.env` is created from `.env.example`; do not use real values in test output.
