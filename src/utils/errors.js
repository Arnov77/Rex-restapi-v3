function getError(err) {
  return err.message || 'Unknown Error';
}

module.exports = { getError };
