# Games Sync

Private event matching page for a Games club-party event.

## Run

```powershell
npm start
```

If Node is not installed globally, run with any Node 18+ executable:

```powershell
node server.js
```

Open `http://localhost:3000`.

## Admin

- Default admin key: `games-admin`
- Set a safer key before running an event:

```powershell
$env:ADMIN_KEY="your-secret-admin-key"
npm start
```

The default invite code is `SYNC2026`. Use `/admin` to create rooms, change entry codes, and adjust limits.

Changing the invite code starts a fresh SIGNAL round and clears all existing SIGNAL records.
Admins can also adjust the per-user limits:

- `SIGNAL`: default 10
- `OPEN SIGNAL`: default 1

## Data

Event data is stored in an encrypted local database file:

- Default database path: `data/games-sync.localdb`
- Default local key path: `data/encryption.key`
- Recommended production secret: set `DATA_ENCRYPTION_KEY`

- User passwords are stored as salted hashes.
- Contact information is encrypted at rest and shown only after a SYNC or received `OPEN SIGNAL`.
- `OPEN SIGNAL` reveals the sender's contact and optional note immediately.
- Keep the encryption key private. If the key is lost, the encrypted database cannot be recovered.
- Existing `data/store.json` data is migrated into the encrypted database on first run.

## Deploy

This app needs a Node web service because it has API routes and stores event data.

### GitHub

Do not commit anything under `data/`; it can contain encrypted event data and local encryption keys. The folder contents are ignored by `.gitignore`.

### Render

Create a Render Web Service from this repository, or use the included `render.yaml` Blueprint.

Recommended settings:

- Build Command: `npm install`
- Start Command: `npm start`
- Environment variable `ADMIN_KEY`: set this to a private admin password
- Environment variable `DATA_ENCRYPTION_KEY`: set this to a long private secret
- Environment variable `UPSTASH_REDIS_REST_URL`: recommended on free Render services
- Environment variable `UPSTASH_REDIS_REST_TOKEN`: recommended on free Render services
- Environment variable `UPSTASH_STORE_KEY`: optional, defaults to `games-sync:store`
- Environment variable `DATABASE_PATH`: `/var/data/games-sync.localdb`
- Environment variable `ALLOW_DATABASE_BOOTSTRAP`: keep this as `false` after the first database exists
- Persistent disk mount path: `/var/data`

Render services use an ephemeral filesystem by default, so a persistent disk or external datastore is required for real events.
On free Render services, use Upstash Redis instead of Render Disk. When both `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are set, the app stores its encrypted database payload in Upstash under
`UPSTASH_STORE_KEY` and ignores the local file database for normal reads and writes.

If you use the local file database, the
database file is missing in production, the app refuses to create a fresh empty database unless
`ALLOW_DATABASE_BOOTSTRAP=true` is set. This prevents a restart from silently looking like all rooms and members
were reset. Only turn bootstrap on for a first setup, then turn it back off.

The app also keeps encrypted rotating backups next to the database at `/var/data/backups` by default. These backups
help if the primary database file is damaged or accidentally removed while the persistent disk is still intact.
They cannot help if the Render service has no persistent disk attached, because the database and backups would both
live on ephemeral storage.
