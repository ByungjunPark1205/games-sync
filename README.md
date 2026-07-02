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
- Environment variable `DATABASE_PATH`: `/var/data/games-sync.localdb`
- Persistent disk mount path: `/var/data`

Render services use an ephemeral filesystem by default, so a persistent disk is recommended for real events.
