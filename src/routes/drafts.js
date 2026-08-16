import { Router } from 'express';
import { withImap, listMailboxes, resolveFolderPath } from '../imapClient.js';
import { buildRawMessage } from '../mime.js';

export const draftsRouter = Router();

function draftMailOptions(email, body) {
  return {
    from: email,
    to: body.to || undefined,
    cc: body.cc || undefined,
    bcc: body.bcc || undefined,
    subject: body.subject || '',
    text: body.text || '',
  };
}

// POST /drafts  { folder, to, subject, text, cc, bcc }
draftsRouter.post('/drafts', async (req, res) => {
  const folder = req.body?.folder;
  if (!folder) return res.status(400).json({ error: 'folder is required' });

  const result = await withImap(req.imapCreds, async (client) => {
    const raw = await buildRawMessage(draftMailOptions(req.imapCreds.email, req.body));
    const mailboxes = await listMailboxes(client);
    const destination = resolveFolderPath(mailboxes, folder);
    return client.append(destination, raw, ['\\Draft'], new Date());
  });

  if (!result || result.uid === undefined) {
    return res.status(502).json({ error: "Server didn't confirm the draft was saved" });
  }
  res.json({ uid: result.uid, folder: result.destination });
});

// PUT /drafts/:uid  { folder, to, subject, text, cc, bcc }
// IMAP has no in-place edit: append the new version, then delete the old
// UID - the app tracks whatever uid comes back from each autosave.
draftsRouter.put('/drafts/:uid', async (req, res) => {
  const folder = req.body?.folder;
  const oldUid = Number(req.params.uid);
  if (!folder) return res.status(400).json({ error: 'folder is required' });

  const result = await withImap(req.imapCreds, async (client) => {
    const raw = await buildRawMessage(draftMailOptions(req.imapCreds.email, req.body));
    const mailboxes = await listMailboxes(client);
    const destination = resolveFolderPath(mailboxes, folder);
    const appended = await client.append(destination, raw, ['\\Draft'], new Date());

    await client.mailboxOpen(destination);
    await client.messageDelete(String(oldUid), { uid: true });

    return appended;
  });

  if (!result || result.uid === undefined) {
    return res.status(502).json({ error: "Server didn't confirm the draft was saved" });
  }
  res.json({ uid: result.uid, folder: result.destination });
});
