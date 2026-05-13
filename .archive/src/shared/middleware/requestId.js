const { randomUUID } = require('crypto');

// Attaches a stable request identifier so logs, upstream calls, and error
// envelopes can be correlated. Honours an incoming `X-Request-ID` header when
// present (useful behind a proxy that already stamps one), otherwise mints a
// fresh v4 UUID.
module.exports = function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
};
