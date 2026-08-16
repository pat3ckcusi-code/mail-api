import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name} (see .env.example)`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  imap: {
    host: required('IMAP_HOST'),
    port: Number(process.env.IMAP_PORT || 993),
    secure: (process.env.IMAP_SECURE ?? 'true') === 'true',
    // Set this when IMAP_HOST is an internal Docker hostname (e.g. "dovecot")
    // that doesn't match the TLS cert's name (issued for the public domain) -
    // forces SNI/cert validation against the public name while still
    // connecting to the internal address.
    tlsServername: process.env.IMAP_TLS_SERVERNAME || undefined,
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT || 587),
    secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
    tlsServername: process.env.SMTP_TLS_SERVERNAME || undefined,
  },
  jwtSecret: required('JWT_SECRET'),
  credEncKey: required('CRED_ENC_KEY'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
};
