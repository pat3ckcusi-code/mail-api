import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const ALGO = 'aes-256-gcm';

function encKey() {
  const key = Buffer.from(config.credEncKey, 'hex');
  if (key.length !== 32) {
    throw new Error('CRED_ENC_KEY must be 32 bytes hex-encoded (64 hex chars)');
  }
  return key;
}

// The IMAP password has to travel with every request (each route opens its
// own short-lived IMAP connection - see imapClient.js), and there's no
// server-side session store here. Rather than add one, the password rides
// inside the JWT payload, encrypted with a key separate from the one that
// signs the JWT, so a leaked JWT_SECRET alone doesn't expose credentials.
function encryptPassword(password) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decryptPassword(encoded) {
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, encKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function issueToken({ email, password }) {
  return jwt.sign({ email, cred: encryptPassword(password) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.imapCreds = { email: payload.email, password: decryptPassword(payload.cred) };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}
