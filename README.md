# mail-api

REST middleware between `mail_app_flutter` and a mailcow-hosted mailbox. Every route this
Flutter app calls (`lib/services/api/api_client.dart`) is implemented here, translated into
IMAP (via `imapflow`) and SMTP (via `nodemailer`) against mailcow's Dovecot/Postfix.

## Setup

```bash
npm install
cp .env.example .env   # fill in IMAP_HOST/SMTP_HOST + generate JWT_SECRET/CRED_ENC_KEY
npm start
```

Generate the two secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## How auth works

`POST /login` opens an IMAP connection with the submitted email/password - that connection
attempt *is* the credential check (Dovecot rejects bad credentials, no separate verification
needed). On success it issues a JWT containing the email and the IMAP password, AES-256-GCM
encrypted with `CRED_ENC_KEY` (a different secret than the one that signs the JWT, so a leaked
`JWT_SECRET` alone doesn't expose credentials). Every other route decrypts that password from
the bearer token and opens its own short-lived IMAP connection per request - there's no
server-side session store or connection pool. Fine for a single mobile client; would need
pooling before this serves meaningfully concurrent traffic.

## Known first-pass assumptions worth verifying against your real mailcow deployment

- **Pagination order**: IMAP has no native "give me page N newest-first" - `GET /emails` slices
  sequence numbers from the high (newest) end of the mailbox as a stand-in for sorting by date.
  This tracks arrival order closely but isn't a true date sort.
- **Folder name resolution**: the app passes folder names back verbatim from whatever `/folders`
  returned (e.g. "Trash", "Archive"). `resolveFolderPath` (`src/imapClient.js`) does a best-effort
  match against the real IMAP mailbox list; if mailcow's actual folder names/hierarchy don't match
  what's assumed, moves/drafts could target the wrong path. Worth confirming against `mailboxOpen`
  logs the first time you archive/delete/draft for real.
- **Quota**: assumes Dovecot's `QUOTA` capability is enabled and reports a `STORAGE` resource;
  if not, `/quota` degrades to `{available: false}` rather than erroring (matches the app's own
  tolerant-failure convention for this endpoint).
- **Sent-copy on send**: mailcow's submission port doesn't auto-append a Sent copy the way SOGo's
  own send path does, so `/send` does it explicitly after a successful SMTP send. It's
  best-effort (a slow/missing Sent folder won't fail the request) - worth confirming a sent test
  message actually shows up in Sent.

## Deployment

See `deploy/DEPLOY.md` for the full walkthrough. Short version: this server's actual public-facing
proxy is a standalone Traefik container (not mailcow's own nginx, which is loopback-only) using a
file-based dynamic config - deployment means publishing mail-api's port to `127.0.0.1` (already
wired in `deploy/docker-compose.override.yml`) and adding a matching router entry to Traefik's
`/etc/traefik/dynamic.yml`, not an nginx vhost. `mail_app_flutter`'s `dart_define.prod.json` is
already set to the intended final address (`https://api.lgucalapan.ph`, no `/api` suffix - this
server's routes are mounted at the root).
