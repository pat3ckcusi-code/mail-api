import { Router } from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { config } from '../config.js';
import { withImap, listMailboxes } from '../imapClient.js';
import { buildRawMessage } from '../mime.js';

export const sendRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // matches the app's own 25MB cap (compose_screen.dart)
});

// POST /send (multipart/form-data): to, subject, text, cc?, bcc?,
// forwardFrom? (JSON string {uid,folder}), attachments? (files)
sendRouter.post('/send', upload.array('attachments'), async (req, res) => {
  const { to, subject, text, cc, bcc, forwardFrom } = req.body || {};
  if (!to) return res.status(400).json({ error: 'to is required' });

  let forwardMeta = null;
  if (forwardFrom) {
    try {
      forwardMeta = JSON.parse(forwardFrom);
    } catch {
      return res.status(400).json({ error: 'Invalid forwardFrom' });
    }
  }

  const uploaded = (req.files || []).map((f) => ({
    filename: f.originalname,
    content: f.buffer,
    contentType: f.mimetype,
  }));

  const { email, password } = req.imapCreds;

  await withImap({ email, password }, async (client) => {
    // Forwarding re-fetches the source message's attachments here, server-side,
    // rather than having the phone download-then-reupload them (see
    // ForwardFrom's doc comment in the app's api_client.dart).
    let forwarded = [];
    if (forwardMeta?.uid && forwardMeta?.folder) {
      await client.mailboxOpen(forwardMeta.folder, { readOnly: true });
      let source = null;
      for await (const msg of client.fetch(String(forwardMeta.uid), { source: true }, { uid: true })) {
        source = msg.source;
      }
      if (source) {
        const parsed = await simpleParser(source);
        forwarded = parsed.attachments.map((att) => ({
          filename: att.filename || 'attachment',
          content: att.content,
          contentType: att.contentType,
        }));
      }
    }

    const mailOptions = {
      from: email,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject: subject || '',
      text: text || '',
      attachments: [...uploaded, ...forwarded],
    };

    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      tls: config.smtp.tlsServername ? { servername: config.smtp.tlsServername } : undefined,
      auth: { user: email, pass: password },
    });
    await transporter.sendMail(mailOptions);

    // Best-effort Sent copy: mailcow's submission port doesn't auto-append
    // like SOGo's own send path does, so this server does it explicitly. A
    // successfully delivered message shouldn't fail the request just
    // because the account has no Sent folder or the append itself fails.
    try {
      const mailboxes = await listMailboxes(client);
      const sentPath = mailboxes.find((m) => m.specialUse === '\\Sent')?.path;
      if (sentPath) {
        const raw = await buildRawMessage(mailOptions);
        await client.append(sentPath, raw, ['\\Seen'], new Date());
      }
    } catch {
      // ignore - see comment above
    }
  });

  res.json({ success: true });
});
