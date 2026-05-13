/**
 * auth service — register/login business logic. Controllers stay thin and
 * just translate HTTP <-> service.
 */
const bcrypt = require('bcryptjs');
const logger = require('../../shared/utils/logger');
const usersRepo = require('../../shared/repositories/users.repo');
const apiKeysRepo = require('../../shared/repositories/apiKeys.repo');
const apiKeysService = require('./apiKeys.service');
const jwtAuth = require('../../shared/auth/jwt');
const { ConflictError, UnauthorizedError, AppError } = require('../../shared/utils/errors');

const BCRYPT_ROUNDS = Math.max(8, Math.min(14, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10));
const DEFAULT_USER_DAILY_LIMIT = parseInt(process.env.QUOTA_USER_DAILY, 10) || 250;

async function register({ username, email, password }) {
  // Pre-flight checks. Race-safe fallback handled by repo's 23505 catch.
  if (await usersRepo.findByEmail(email)) {
    throw new ConflictError('Email already registered');
  }
  if (await usersRepo.findByUsername(username)) {
    throw new ConflictError('Username already taken');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Mint the user's API key first so the user row can reference it.
  const { plaintext, record } = await apiKeysService.createKey({
    name: username,
    tier: 'user',
    dailyLimit: DEFAULT_USER_DAILY_LIMIT,
  });

  let userPublic;
  try {
    const inserted = await usersRepo.insertUser({
      username,
      email,
      passwordHash,
      apiKeyId: record.id,
    });
    userPublic = usersRepo.publicView(inserted);
  } catch (err) {
    // Roll back the orphan API key — user row never landed.
    await apiKeysService.revokeKey(record.id).catch(() => {});
    if (err.code === 'EMAIL_TAKEN') throw new ConflictError('Email already registered');
    if (err.code === 'USERNAME_TAKEN') throw new ConflictError('Username already taken');
    throw new AppError('Failed to create user', 500);
  }

  const token = jwtAuth.sign({ sub: userPublic.id, username: userPublic.username });
  logger.success(`[auth] Registered user "${userPublic.username}" (${userPublic.email})`);
  return {
    user: userPublic,
    apiKey: {
      id: record.id,
      name: record.name,
      tier: record.tier,
      dailyLimit: record.dailyLimit,
      key: plaintext,
      createdAt: record.createdAt,
    },
    token,
    tokenType: 'Bearer',
    expiresIn: jwtAuth.expiresIn(),
  };
}

async function login({ identifier, password }) {
  const user = await usersRepo.findByEmailOrUsername(identifier);
  if (!user) throw new UnauthorizedError('Invalid credentials');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Invalid credentials');

  await usersRepo.touchLogin(user.id);
  const token = jwtAuth.sign({ sub: user.id, username: user.username });
  logger.info(`[auth] Login: ${user.username}`);

  // Login is fresh password re-auth — safe to surface the plaintext API key.
  const apiKeyRecord = await apiKeysRepo.findById(user.apiKeyId);
  const plaintext = apiKeyRecord ? await apiKeysService.getPlaintextById(apiKeyRecord.id) : null;

  return {
    user: usersRepo.publicView(user),
    apiKey: apiKeyRecord
      ? {
          id: apiKeyRecord.id,
          name: apiKeyRecord.name,
          tier: apiKeyRecord.tier,
          dailyLimit: apiKeyRecord.dailyLimit,
          key: plaintext,
          createdAt: apiKeyRecord.createdAt,
        }
      : null,
    token,
    tokenType: 'Bearer',
    expiresIn: jwtAuth.expiresIn(),
  };
}

module.exports = { register, login };
