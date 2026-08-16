import { Router } from 'express';
import { withImap, listMailboxes } from '../imapClient.js';

export const foldersRouter = Router();

foldersRouter.get('/folders', async (req, res) => {
  const folders = await withImap(req.imapCreds, async (client) => {
    const mailboxes = await listMailboxes(client);
    return Promise.all(
      mailboxes.map(async (mailbox) => {
        const status = await client.status(mailbox.path, { unseen: true, uidNext: true });
        return {
          name: mailbox.path,
          specialUse: mailbox.specialUse,
          unread: status.unseen ?? 0,
          uidNext: status.uidNext ?? null,
        };
      }),
    );
  });
  res.json({ folders });
});
