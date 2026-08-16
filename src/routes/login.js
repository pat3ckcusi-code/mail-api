import { Router } from 'express';
import { ImapFlow } from 'imapflow';
import { imapConnectOptions } from '../imapClient.js';
import { issueToken } from '../auth.js';

export const loginRouter = Router();

loginRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // The login IMAP connection *is* the credential check - mailcow's Dovecot
  // rejects bad credentials at auth time, no separate verification needed.
  const client = new ImapFlow(imapConnectOptions({ email, password }));

  try {
    await client.connect();
    await client.logout().catch(() => client.close());
  } catch {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = issueToken({ email, password });
  res.json({ token, email });
});
