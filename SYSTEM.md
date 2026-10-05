# Personal Blog System Contract

## Purpose

Provide publicly consumable music articles and album reviews, with a private
administrator CMS for publication management. This service is an independent
Git repository registered at `services/personal-blog`.

## Responsibilities

- Serve public article, review, sitemap, and visitor-interaction endpoints.
- Authenticate administrator CMS operations before content, settings, media,
  analytics, or translation operations execute.
- Persist publication data to its external PostgreSQL database and media to
  its external S3 bucket.

## Boundaries

- The service must not access `personal/`, `knowledge/`, or `registry/` data
  at runtime. Its PIOS Registry dependency is governance/discovery only.
- PostgreSQL and S3 are external application stores, not PIOS filesystem
  permissions.
- `personal_blog` content must remain publication content; it must not be
  presented as objective Knowledge consensus or imported from Personal records.

## Operational integrations

- PostgreSQL: CMS records and aggregate visitor interactions.
- Amazon S3: administrator-uploaded images and audio. IAM access must be
  restricted to the configured bucket and upload prefixes.
- DeepL: optional, administrator-triggered translation. Requests are disabled
  when `DEEPL_API_KEY` is absent.
- MusicBrainz and 1001 Album Generator: scheduled ingestion/enrichment
  scripts. They are external calls and are not part of the web-server request
  path.

See [BEHAVIOR.md](BEHAVIOR.md) for access rules and [README.md](README.md) for
local setup.
