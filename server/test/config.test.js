const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRuntimeConfig } = require('../config');

const valid = {
  DB_PASSWORD: 'database-secret',
  JWT_SECRET: 'jwt-secret',
  ADMIN_PASSWORD: 'admin-secret',
  PORT: '3000',
};

test('accepts complete non-secret runtime configuration', () => {
  assert.doesNotThrow(() => validateRuntimeConfig(valid));
});

test('rejects a missing database password instead of applying a default', () => {
  const missingPassword = { ...valid, DB_PASSWORD: '' };
  assert.throws(() => validateRuntimeConfig(missingPassword), /DB_PASSWORD/);
});

test('rejects an invalid port', () => {
  assert.throws(() => validateRuntimeConfig({ ...valid, PORT: '70000' }), /PORT/);
});
