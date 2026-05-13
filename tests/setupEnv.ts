// Shared deterministic env for tests that load `loadEnv()`.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-1234';
process.env.JWT_EXPIRES_IN ??= '1h';
process.env.API_KEY_ENC_KEY ??= '0'.repeat(64);
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role';
process.env.USER_DAILY_QUOTA ??= '1000';
