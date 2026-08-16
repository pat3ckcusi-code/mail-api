import { Router } from 'express';
import { withImap } from '../imapClient.js';

export const quotaRouter = Router();

// Tolerant-failure by design, matching the app's own convention (see
// InboxScreen._loadQuota in mail_app_flutter): if the server or account has
// no QUOTA support, respond 200 {available:false} rather than an error -
// this isn't a failure state worth surfacing to the user.
quotaRouter.get('/quota', async (req, res) => {
  try {
    const quota = await withImap(req.imapCreds, (client) => client.getQuota('INBOX'));
    if (!quota || !quota.storage) {
      return res.json({ available: false });
    }
    res.json({ available: true, usage: quota.storage.usage, limit: quota.storage.limit });
  } catch {
    res.json({ available: false });
  }
});
