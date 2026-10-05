const { validateRuntimeConfig } = require('./config');

try {
  validateRuntimeConfig();
  console.log('Runtime configuration is valid.');
} catch (error) {
  console.error(`Configuration check failed: ${error.message}`);
  process.exitCode = 1;
}
