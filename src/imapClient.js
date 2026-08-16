import { ImapFlow } from 'imapflow';
import { config } from './config.js';

export function imapConnectOptions({ email, password }) {
  return {
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    tls: config.imap.tlsServername ? { servername: config.imap.tlsServername } : undefined,
    auth: { user: email, pass: password },
    logger: false,
  };
}

// Each request opens and closes its own IMAP connection rather than pooling
// - mirrors the app's own "server never polls IMAP on a schedule" design
// (see CLAUDE.md in mail_app_flutter) and keeps this server itself stateless,
// at the cost of a login round-trip per request. Fine for a single-user
// mobile client; would want pooling before this serves many concurrent users.
export async function withImap(creds, fn) {
  const client = new ImapFlow(imapConnectOptions(creds));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** List mailboxes with special-use flags normalized, INBOX tagged explicitly. */
export async function listMailboxes(client) {
  const list = await client.list();
  return list.map((entry) => ({
    path: entry.path,
    specialUse: entry.path.toUpperCase() === 'INBOX' ? '\\Inbox' : entry.specialUse || null,
  }));
}

/**
 * The app passes folder names back verbatim from what /folders returned
 * (e.g. "Trash", "Archive"), but the real mailbox path/casing/hierarchy is
 * whatever mailcow's Dovecot actually uses. Best-effort match by exact path,
 * then case-insensitive name, then fall back to the requested string as-is.
 */
export function resolveFolderPath(mailboxes, requested) {
  if (!requested) return requested;
  const exact = mailboxes.find((m) => m.path === requested);
  if (exact) return exact.path;
  const ci = mailboxes.find((m) => m.path.toLowerCase() === requested.toLowerCase());
  if (ci) return ci.path;
  const bySpecialUse = mailboxes.find((m) => m.specialUse === requested);
  if (bySpecialUse) return bySpecialUse.path;
  return requested;
}
