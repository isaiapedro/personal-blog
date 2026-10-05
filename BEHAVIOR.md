# Personal Blog Behavioral Contract

- Public read and visitor-interaction routes are intentionally anonymous.
  They may use an opaque visitor identifier only to limit duplicate reactions;
  it is not an authentication credential.
- `POST /api/auth/login` is rate limited. On success it issues an eight-hour
  HS256 JWT. Every CMS mutation and administrator analytics route requires a
  valid bearer token.
- The service fails closed at startup when `DB_PASSWORD`, `JWT_SECRET`, or
  `ADMIN_PASSWORD` is missing. It has no default database password.
- Browser origins are allow-listed through `ALLOWED_ORIGINS`; credentials are
  permitted only for an approved origin.
- Upload routes are administrator-only. Production S3 credentials must have
  the minimum permissions for the configured bucket and media prefixes.
- Secrets belong only in the ignored `.env` file or the deployment secret
  manager. They must not be logged, committed, copied into contracts, or sent
  to PIOS Registry state.
- Application errors must not include database credentials, authorization
  headers, JWTs, or uploaded media bodies in logs or client responses.
