import MailComposer from 'nodemailer/lib/mail-composer/index.js';

/** Builds a raw RFC822 message without sending it - used for IMAP APPEND (drafts, Sent copies). */
export function buildRawMessage(mailOptions) {
  return new Promise((resolve, reject) => {
    new MailComposer(mailOptions).compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}
