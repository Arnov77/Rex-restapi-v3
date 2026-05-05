const { env } = require('../../../config');
const logger = require('../utils/logger');

const API_BASE = 'https://api.capsolver.com';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90000;

class CapSolverError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CapSolverError';
    this.code = code;
  }
}

function getApiKey() {
  const key = env.CAPSOLVER_API_KEY;
  if (!key) {
    throw new CapSolverError(
      'CAPSOLVER_API_KEY is not configured — Turnstile-protected scrapers cannot be solved.',
      'NO_API_KEY'
    );
  }
  return key;
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new CapSolverError(`CapSolver ${path} HTTP ${res.status}`, 'HTTP_ERROR');
  }
  return res.json();
}

async function getBalance() {
  const data = await postJson('/getBalance', { clientKey: getApiKey() });
  if (data.errorId !== 0) {
    throw new CapSolverError(
      data.errorDescription || 'CapSolver getBalance failed',
      data.errorCode
    );
  }
  return data.balance;
}

/**
 * Solve a Cloudflare Turnstile challenge via CapSolver.
 *
 * @param {object}  opts
 * @param {string}  opts.websiteURL  Page hosting the widget (e.g. "https://spotidown.co/")
 * @param {string}  opts.websiteKey  Turnstile sitekey (the `0x4AAAA...` token in the iframe URL)
 * @param {string=} opts.action      Optional Turnstile action name
 * @param {string=} opts.cdata       Optional Turnstile cdata
 * @returns {Promise<string>}        The Turnstile response token (`cf-turnstile-response`)
 */
async function solveTurnstile({ websiteURL, websiteKey, action, cdata } = {}) {
  if (!websiteURL || !websiteKey) {
    throw new CapSolverError('solveTurnstile: websiteURL and websiteKey are required', 'BAD_INPUT');
  }
  const clientKey = getApiKey();
  const task = {
    type: 'AntiTurnstileTaskProxyLess',
    websiteURL,
    websiteKey,
  };
  if (action) task.action = action;
  if (cdata) task.cdata = cdata;

  const startedAt = Date.now();
  logger.info(`[capsolver] createTask Turnstile sitekey=${websiteKey.slice(0, 12)}…`);
  const create = await postJson('/createTask', { clientKey, task });
  if (create.errorId !== 0 || !create.taskId) {
    throw new CapSolverError(
      `CapSolver createTask failed: ${create.errorDescription || 'unknown'}`,
      create.errorCode || 'CREATE_FAILED'
    );
  }
  const { taskId } = create;

  // Poll until ready or timeout. CapSolver typically resolves Turnstile in 3-8s.
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await postJson('/getTaskResult', { clientKey, taskId });
    if (result.errorId !== 0) {
      throw new CapSolverError(
        `CapSolver getTaskResult failed: ${result.errorDescription || 'unknown'}`,
        result.errorCode || 'POLL_FAILED'
      );
    }
    if (result.status === 'ready') {
      const token = result.solution && result.solution.token;
      if (!token) throw new CapSolverError('CapSolver returned no token', 'NO_TOKEN');
      const elapsedMs = Date.now() - startedAt;
      logger.info(`[capsolver] solved in ${elapsedMs}ms (taskId=${taskId})`);
      return token;
    }
  }
  throw new CapSolverError(`CapSolver timeout after ${POLL_TIMEOUT_MS}ms`, 'TIMEOUT');
}

function isConfigured() {
  return Boolean(env.CAPSOLVER_API_KEY);
}

module.exports = {
  solveTurnstile,
  getBalance,
  isConfigured,
  CapSolverError,
};
