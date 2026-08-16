# Deploying mail-api

This server's actual setup (confirmed by inspecting it directly, not assumed): mailcow is
deployed via Komodo at `/etc/komodo/stacks/mail-lgucalapan-ph/`, but mailcow's own nginx only
listens on `127.0.0.1:8443`/`127.0.0.1:8080` - it is **not** internet-facing. A separate,
standalone `traefik:v3.6` container (running with `network_mode: host`, not managed as a Komodo
Stack or Deployment) is the actual public-facing proxy for `*.lgucalapan.ph`. It routes using a
file it watches at `/etc/traefik/dynamic.yml` on the host (Traefik tags these `@file` in its
logs), reaching backends via `http://127.0.0.1:<port>` - e.g. its existing `dozzle` and `komodo`
routers point at `127.0.0.1:8082` and `127.0.0.1:9120` respectively. Traefik also owns its own
ACME/Let's Encrypt cert issuance (mailcow's own is disabled - `SKIP_LETS_ENCRYPT: "y"` in its
`acme-mailcow` service), per-router, via a `certResolver` name set in `dynamic.yml`.

mail-api itself deploys as its own Komodo Stack, built directly from
`github.com/pat3ckcusi-code/mail-api` - no manual file-copying onto the server needed for this
part. Its `docker-compose.yml` publishes port 3100 to `127.0.0.1` (what Traefik needs) and joins
mailcow's Docker network as `external: true` so it can reach Dovecot/Postfix by container name.
Only steps 2 and 3 below need someone with actual filesystem access to the server.

## 1. Deploy the Stack in Komodo

In the `mail-api` Stack you already created:
1. **Choose Mode** → **Git Repo**
2. Repo: `pat3ckcusi-code/mail-api`, branch: `main`, compose file path: `docker-compose.yml`
   (the default - it's at the repo root)
3. Add an **Environment** entry with two variables:
   ```
   JWT_SECRET=<generate below>
   CRED_ENC_KEY=<generate below>
   ```
   Generate each with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   (run this on any machine with Node - it doesn't need to be the server)
4. Click **Deploy**. Watch the stack's Log tab - it should build the image and start; `docker ps`
   equivalent in Komodo's Containers page should show `mail-api` as `RUNNING`.

## 2. DNS (needs server/DNS admin access)

Add an A (and AAAA, if `mail.lgucalapan.ph` has one) record for `api.lgucalapan.ph` pointing at
the server's IP - same as `mail.lgucalapan.ph`'s.

## 3. Add a Traefik route (needs server filesystem access)

Open `/etc/traefik/dynamic.yml` on the server and find the existing `dozzle` or `komodo` router
entry (both already work over HTTPS, so copying one's shape - especially its `certResolver` value,
which isn't guessable from outside the file - guarantees this new one works the same way). Add a
new router+service block next to it, e.g.:

```yaml
http:
  routers:
    mail-api:
      rule: "Host(`api.lgucalapan.ph`)"
      service: mail-api
      entryPoints:
        - websecure          # confirmed from traefik's own access logs
      tls:
        certResolver: REPLACE_WITH_THE_SAME_VALUE_DOZZLE_OR_KOMODO_USES
  services:
    mail-api:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:3100"   # matches docker-compose.yml's published port
```

If `dynamic.yml` already has top-level `http:`/`routers:`/`services:` keys (it will, since dozzle
and komodo are already in there), merge `mail-api` in as a sibling entry under the existing
`routers:`/`services:` maps rather than duplicating the top-level keys.

Traefik's file provider hot-reloads on save - no restart needed, but `docker logs traefik` (or
Komodo's Log tab for the `traefik` container) will show it picking up the new router.

## 4. Verify

```bash
curl -i -X POST https://api.lgucalapan.ph/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@lgucalapan.ph","password":"wrong-on-purpose"}'
# expect 401 {"error":"Invalid email or password"} - proves DNS, Traefik's
# new route + cert, and mail-api's internal dovecot connection all work end to end.
```
Komodo's Log tab for the `mail-api` Stack is the equivalent of `docker compose logs -f` if
something doesn't connect.

## 5. Point the app at it

`mail_app_flutter/dart_define.prod.json` is already set to `https://api.lgucalapan.ph` (no `/api`
suffix - mail-api's routes are mounted at the root: `/login`, `/folders`, etc.). Once step 4
passes, rebuild: `flutter build apk --release --dart-define-from-file=dart_define.prod.json`.
