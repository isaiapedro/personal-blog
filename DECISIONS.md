# Personal Blog Decisions

## 2026-09-10 — Adopt PIOS service governance without changing repository ownership

Personal Blog remains an independently versioned application repository,
registered in `registry/repositories.yaml`. Its local manifest and contracts
describe PIOS boundaries while application source, application configuration,
and tests remain owned by this repository.

## 2026-09-10 — Fail closed for database and administrator credentials

The server no longer substitutes `password` when `DB_PASSWORD` is absent.
Startup configuration validation requires the database password, JWT signing
secret, and administrator password. A tracked `.env.example` provides names
and placeholders only; `.env` remains ignored.

## 2026-09-10 — Keep publication data outside Personal and Knowledge domains

The public blog uses external PostgreSQL and S3 stores exclusively. It has no
runtime PIOS filesystem permissions and must not receive Personal records or
claim that subjective publication content is Knowledge consensus.
