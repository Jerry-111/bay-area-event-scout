# Admin UI Railway Deployment

The admin UI is a Node HTTP server in `apps/admin`. It should be deployed as a
Railway web service. Trigger.dev only runs the scheduled scout tasks; it does
not host this UI.

## Railway Service Settings

Create or update a Railway service that points at this repository.

- Service root: repo root
- Build command: `pnpm install --frozen-lockfile && pnpm --filter @event-scout/admin build`
- Start command: `pnpm --filter @event-scout/admin start`

Railway provides `PORT` automatically. In production or Railway, the admin
server binds to `0.0.0.0` and uses `PORT`. For local development, it falls back
to `ADMIN_PORT` or `4310` and binds to `127.0.0.1`.

## Required Environment Variables

Set these variables on the Railway admin UI service:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<generate-a-long-random-password>
MOCK_MODE=false
NODE_ENV=production
```

Also set `SCOUT_PROFILE` (or commit a `scout.profile.yaml`) to the same profile the worker uses,
so the dashboard's score bands match the recommendations.

`DATABASE_URL` should reference the Railway Postgres service. Replace
`Postgres` in `${{Postgres.DATABASE_URL}}` with the actual Railway service name
if your Postgres service uses a different name.

Do not commit real passwords or database values.

## Public Domain

In the Railway service settings, open Networking and generate a public domain
for the admin UI web service. Railway will route that domain to the service
through the `PORT` value it injects at runtime. If Railway asks for a target
port, use `8080`.

## Access

After deployment, share the public dashboard URL:

```text
https://<railway-public-domain>/
```

Users who are not signed in will see a login page. Send `ADMIN_USERNAME` and
`ADMIN_PASSWORD` separately; after sign-in the server stores a signed HttpOnly
session cookie.

Use the public domain as `APP_BASE_URL` so Telegram can link to the dashboard.
The health endpoint requires the same browser session cookie when admin auth is
enabled:

```text
https://<railway-public-domain>/health
```
