const ResponseHandler = require('../../shared/utils/response');
const authService = require('./auth.service');

async function register(req, res) {
  const result = await authService.register(req.validated);
  return ResponseHandler.success(res, result, 'Registered', 201);
}

async function login(req, res) {
  const result = await authService.login(req.validated);
  return ResponseHandler.success(res, result);
}

module.exports = { register, login };
