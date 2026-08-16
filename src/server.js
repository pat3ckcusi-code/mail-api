import express from 'express';
import { config } from './config.js';
import { authMiddleware } from './auth.js';
import { loginRouter } from './routes/login.js';
import { foldersRouter } from './routes/folders.js';
import { quotaRouter } from './routes/quota.js';
import { emailsRouter } from './routes/emails.js';
import { draftsRouter } from './routes/drafts.js';
import { sendRouter } from './routes/send.js';

const app = express();
app.use(express.json());

app.use(loginRouter); // unauthenticated - IMAP login itself is the credential check

app.use(authMiddleware);
app.use(foldersRouter);
app.use(quotaRouter);
app.use(emailsRouter);
app.use(draftsRouter);
app.use(sendRouter);

// Express 5 forwards rejected async handlers here automatically.
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(config.port, () => {
  console.log(`mail-api listening on :${config.port}`);
});
