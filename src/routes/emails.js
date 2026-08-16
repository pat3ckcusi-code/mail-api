import { Router } from 'express';
import { simpleParser } from 'mailparser';
import { withImap, listMailboxes, resolveFolderPath } from '../imapClient.js';
import { summaryFromMessage, detailFromParsed } from '../mailParsing.js';

export const emailsRouter = Router();

async function fetchSourceByUid(client, folder, uid) {
  await client.mailboxOpen(folder, { readOnly: true });
  for await (const msg of client.fetch(String(uid), { source: true }, { uid: true })) {
    return msg;
  }
  return null;
}

// GET /emails?folder=INBOX&page=1&limit=25
// IMAP has no native "give me page N sorted by date desc" - UID order tracks
// arrival order closely enough for paging, so this slices sequence numbers
// from the high (newest) end of the mailbox instead of running a SORT.
emailsRouter.get('/emails', async (req, res) => {
  const folder = req.query.folder || 'INBOX';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Number(req.query.limit) || 25);

  const result = await withImap(req.imapCreds, async (client) => {
    const mailbox = await client.mailboxOpen(folder, { readOnly: true });
    const total = mailbox.exists;
    const end = total - (page - 1) * limit;
    if (end < 1) return { messages: [], page, total };
    const start = Math.max(1, end - limit + 1);

    const messages = [];
    for await (const msg of client.fetch(`${start}:${end}`, { envelope: true, flags: true })) {
      messages.push(summaryFromMessage(msg));
    }
    messages.reverse(); // fetch yields ascending seq (oldest first in the page); newest-first for the UI
    return { messages, page, total };
  });

  res.json(result);
});

// GET /emails/search?folder=INBOX&q=...&limit=50
emailsRouter.get('/emails/search', async (req, res) => {
  const folder = req.query.folder || 'INBOX';
  const q = String(req.query.q || '').trim();
  const limit = Math.max(1, Number(req.query.limit) || 50);
  if (!q) return res.json({ messages: [] });

  const messages = await withImap(req.imapCreds, async (client) => {
    await client.mailboxOpen(folder, { readOnly: true });
    const uids = await client.search(
      { or: [{ subject: q }, { from: q }, { body: q }] },
      { uid: true },
    );
    if (!uids || !uids.length) return [];
    const wanted = uids.slice(-limit); // search returns ascending uid; keep the most recent `limit`

    const found = [];
    for await (const msg of client.fetch(wanted, { envelope: true, flags: true }, { uid: true })) {
      found.push(summaryFromMessage(msg));
    }
    found.sort((a, b) => b.uid - a.uid); // newest-first, independent of fetch response order
    return found;
  });

  res.json({ messages });
});

// GET /emails/:uid?folder=INBOX
emailsRouter.get('/emails/:uid', async (req, res) => {
  const folder = req.query.folder || 'INBOX';
  const uid = Number(req.params.uid);

  const detail = await withImap(req.imapCreds, async (client) => {
    const msg = await fetchSourceByUid(client, folder, uid);
    if (!msg?.source) return null;
    const parsed = await simpleParser(msg.source);
    return detailFromParsed(parsed);
  });

  if (!detail) return res.status(404).json({ error: 'Message not found' });
  res.json(detail);
});

// GET /emails/:uid/attachments/:index?folder=INBOX
// Bypasses the JSON envelope other routes use - the app requests this with
// ResponseType.bytes and expects a raw body, not {"...": ...}.
emailsRouter.get('/emails/:uid/attachments/:index', async (req, res) => {
  const folder = req.query.folder || 'INBOX';
  const uid = Number(req.params.uid);
  const index = Number(req.params.index);

  const attachment = await withImap(req.imapCreds, async (client) => {
    const msg = await fetchSourceByUid(client, folder, uid);
    if (!msg?.source) return null;
    const parsed = await simpleParser(msg.source);
    return parsed.attachments[index] || null;
  });

  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
  res.set('Content-Type', attachment.contentType || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="${attachment.filename || 'attachment'}"`);
  res.send(attachment.content);
});

// POST /emails/:uid/unread  { folder }
emailsRouter.post('/emails/:uid/unread', async (req, res) => {
  const folder = req.body?.folder || 'INBOX';
  const uid = Number(req.params.uid);

  await withImap(req.imapCreds, async (client) => {
    await client.mailboxOpen(folder);
    await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
  });

  res.json({ success: true });
});

// POST /emails/:uid/move  { folder, targetFolder }
emailsRouter.post('/emails/:uid/move', async (req, res) => {
  const folder = req.body?.folder || 'INBOX';
  const targetFolder = req.body?.targetFolder;
  const uid = Number(req.params.uid);
  if (!targetFolder) return res.status(400).json({ error: 'targetFolder is required' });

  await withImap(req.imapCreds, async (client) => {
    const mailboxes = await listMailboxes(client);
    const destination = resolveFolderPath(mailboxes, targetFolder);
    await client.mailboxOpen(folder);
    await client.messageMove(String(uid), destination, { uid: true });
  });

  res.json({ success: true });
});
