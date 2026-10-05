const path = require('path');

// dotenv is an application dependency. Keeping this optional makes the pure
// configuration validator runnable in a dependency-free checkout; production
// startup still receives its values from .env or the deployment environment.
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const REQUIRED_AT_STARTUP = ['DB_PASSWORD', 'JWT_SECRET', 'ADMIN_PASSWORD'];

const env = {
  PORT: Number(process.env.PORT || 3000),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:4200',
  DB_PASSWORD: process.env.DB_PASSWORD,
  JWT_SECRET: process.env.JWT_SECRET,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
};

function validateRuntimeConfig(source = process.env) {
  const missing = REQUIRED_AT_STARTUP.filter((name) => !String(source[name] || '').trim());
  if (missing.length) {
    throw new Error(`Missing required runtime configuration: ${missing.join(', ')}`);
  }
  if (!Number.isInteger(Number(source.PORT || 3000)) || Number(source.PORT || 3000) < 1 || Number(source.PORT || 3000) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
}

module.exports = { env, validateRuntimeConfig, REQUIRED_AT_STARTUP };
