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

So: mail-api's port needs to be published to `127.0.0.1` on the host (already done in
`docker-compose.override.yml`, port 3100), and Traefik needs a new router+service block in
`/etc/traefik/dynamic.yml` pointing at it - not an nginx vhost.

## 1. Copy this project to the mailcow host

Put the `mail-api/` directory next to mailcow's own directory, e.g.:
```
/etc/komodo/stacks/mail-lgucalapan-ph/   <- mailcow (has docker-compose.yml, data/, .env)
/opt/mail-api/                           <- this project
```
(Adjust `deploy/docker-compose.override.yml`'s `build.context` if you use a different layout.)

## 2. DNS

Add an A (and AAAA, if `mail.lgucalapan.ph` has one) record for `api.lgucalapan.ph` pointing at
this server's IP - same as `mail.lgucalapan.ph`'s. Outside anything Docker/Traefik controls.

## 3. Add a Traefik route for api.lgucalapan.ph

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
          - url: "http://127.0.0.1:3100"   # matches the port published in docker-compose.override.yml
```

If `dynamic.yml` already has top-level `http:`/`routers:`/`services:` keys (it will, since dozzle
and komodo are already in there), merge `mail-api` in as a sibling entry under the existing
`routers:`/`services:` maps rather than duplicating the top-level keys.

Traefik's file provider hot-reloads on save - no restart needed, but `docker logs traefik` (or
Komodo's Log tab for the `traefik` container) will show it picking up the new router.

## 4. Drop in the compose override and secrets

```bash
cd /etc/komodo/stacks/mail-lgucalapan-ph
cp /opt/mail-api/deploy/docker-compose.override.yml ./docker-compose.override.yml

node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))" >> mail-api.env
node -e "console.log('CRED_ENC_KEY=' + require('crypto').randomBytes(32).toString('hex'))" >> mail-api.env
# no node on the host? `openssl rand -hex 32` works just as well for each line
```

## 5. Bring it up

```bash
docker compose up -d --build mail-api
```
(Run from `/etc/komodo/stacks/mail-lgucalapan-ph` so both `docker-compose.yml` and the override
are picked up together - or use Komodo's own UI to redeploy that stack if it detects the override.)

## 6. Verify

```bash
curl -i -X POST https://api.lgucalapan.ph/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@lgucalapan.ph","password":"wrong-on-purpose"}'
# expect 401 {"error":"Invalid email or password"} - proves DNS, Traefik's
# new route + cert, and the internal dovecot connection all work end to end.
docker compose logs -f mail-api      # watch for connection errors
```

## 7. Point the app at it

`mail_app_flutter/dart_define.prod.json` is already set to `https://api.lgucalapan.ph` (no `/api`
suffix - mail-api's routes are mounted at the root: `/login`, `/folders`, etc.). Once step 6
passes, rebuild: `flutter build apk --release --dart-define-from-file=dart_define.prod.json`.
