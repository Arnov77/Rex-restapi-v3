const bcrypt = require('bcryptjs');
const usersStore = require('../../shared/auth/usersStore');
const apiKeyStore = require('../../shared/auth/apiKeyStore');
const jwtAuth = require('../../shared/auth/jwt');
const ResponseHandler = require('../../shared/utils/response');
const logger = require('../../shared/utils/logger');
const { ConflictError, UnauthorizedError, AppError } = require('../../shared/utils/errors');

const BCRYPT_ROUNDS = Math.max(8, Math.min(14, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10));
const DEFAULT_USER_DAILY_LIMIT = parseInt(process.env.QUOTA_USER_DAILY, 10) || 250;

async function register(req, res) {
  const { username, email, password } = req.validated;

  if (usersStore.findByEmail(email)) {
    throw new ConflictError('Email already registered');
  }
  if (usersStore.findByUsername(username)) {
    throw new ConflictError('Username already taken');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Mint a tier=user API key first so the user record can reference it.
  // Plaintext is stored alongside the hash by apiKeyStore so the user can
  // re-display it from /api/user/profile later.
  const { plaintext, record } = apiKeyStore.createKey({
    name: username,
    tier: 'user',
    dailyLimit: DEFAULT_USER_DAILY_LIMIT,
  });

  let userPublic;
  try {
    userPublic = usersStore.createUser({
      username,
      email,
      passwordHash,
      apiKeyId: record.id,
    });
  } catch (err) {
    apiKeyStore.revokeKey(record.id);
    if (err.code === 'EMAIL_TAKEN') throw new ConflictError('Email already registered');
    if (err.code === 'USERNAME_TAKEN') throw new ConflictError('Username already taken');
    throw new AppError('Failed to create user', 500);
  }

  const token = jwtAuth.sign({ sub: userPublic.id, username: userPublic.username });
  logger.success(`[auth] Registered user "${userPublic.username}" (${userPublic.email})`);

  return ResponseHandler.success(
    res,
    {
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
    },
    'Registered',
    201
  );
}

async function login(req, res) {
  const { identifier, password } = req.validated;

  const user = usersStore.findByEmailOrUsername(identifier);
  if (!user) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new UnauthorizedError('Invalid credentials');
  }

  usersStore.touchLogin(user.id);
  const token = jwtAuth.sign({ sub: user.id, username: user.username });
  logger.info(`[auth] Login: ${user.username}`);

  // Login is a fresh password re-auth event, so it's the right moment to
  // hand back the plaintext API key. /api/user/profile no longer exposes
  // plaintext (JWT theft alone must not leak the key).
  const apiKeyRecord = apiKeyStore.findById(user.apiKeyId);
  const plaintext = apiKeyRecord ? apiKeyStore.getPlaintextById(apiKeyRecord.id) : null;

  return ResponseHandler.success(res, {
    user: usersStore.publicView(user),
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
  });
}

module.exports = { register, login };
