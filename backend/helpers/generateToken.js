const jwt = require('jsonwebtoken');

const generateToken = (id) => {
  // Use a secret from env or fallback for local dev
  const secret = process.env.JWT_SECRET || 'fallback_secret_for_local_dev';
  return jwt.sign({ id }, secret, {
    expiresIn: '30d'
  });
};

module.exports = generateToken;
