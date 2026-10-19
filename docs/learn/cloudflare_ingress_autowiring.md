# Phase 1 Pre-Study: Cloudflare Tunnel Auto-Wiring

> Written for: Home Cloud V2 Phase 1 implementation
> Prerequisite: Read `cloudflare_tunnels.md` first for the theory (SIGHUP, ingress rules, config.yml structure).
> This doc covers only the **new implementation concepts** you need to write the code.

---

## What Phase 1 actually does (one sentence)

When a user clicks "Expose" on a container, the backend:
1. Finds which host port that container is listening on
2. Appends a new ingress rule to `~/.cloudflared/config.yml`
3. Creates a DNS CNAME record on Cloudflare via their REST API
4. Sends `SIGHUP` to the running `cloudflared` process so it reloads — no downtime

Four distinct steps. Four new concepts.

---

## New Concept 1: Safely editing `config.yml` with `js-yaml`

You already read about `config.yml` structure in `cloudflare_tunnels.md`. The challenge here is **reading, modifying, and writing it back without corrupting it**. A broken `config.yml` takes the entire tunnel down.

The existing file looks like this:

```yaml
tunnel: <tunnel-id>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: dash.home-cloud.live
    service: http://localhost:3000
  - service: http_status:404   # ← catch-all, MUST always be last
```

You need to insert a new ingress rule **before** the catch-all `http_status:404` entry.

### The safe edit pattern

```js
const fs   = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const CONFIG_PATH = path.join(process.env.HOME, '.cloudflared', 'config.yml');

function addIngressRule(hostname, localPort) {
  // 1. Read current config
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');

  // 2. Parse to a JS object
  const config = yaml.load(raw);

  // 3. Guard: check if this hostname already exists
  const alreadyExists = config.ingress.some(r => r.hostname === hostname);
  if (alreadyExists) {
    throw new Error(`Rule for ${hostname} already exists`);
  }

  // 4. Find the catch-all (last entry, the one with no hostname)
  const catchAllIndex = config.ingress.findIndex(r => !r.hostname);
  if (catchAllIndex === -1) {
    throw new Error('config.yml is missing the catch-all fallback rule');
  }

  // 5. Insert the new rule before the catch-all
  const newRule = {
    hostname: hostname,
    service: `http://localhost:${localPort}`,
  };
  config.ingress.splice(catchAllIndex, 0, newRule);

  // 6. Write back — yaml.dump() converts the JS object back to YAML text
  fs.writeFileSync(CONFIG_PATH, yaml.dump(config, { lineWidth: -1 }), 'utf8');
}
```

> **Why `lineWidth: -1`?** By default `js-yaml` wraps long lines at 80 characters, which can split URLs or service strings across lines and produce invalid YAML. `-1` disables line wrapping.

### Removing a rule (when user "un-exposes" a container)

```js
function removeIngressRule(hostname) {
  const raw    = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = yaml.load(raw);

  config.ingress = config.ingress.filter(r => r.hostname !== hostname);

  fs.writeFileSync(CONFIG_PATH, yaml.dump(config, { lineWidth: -1 }), 'utf8');
}
```

---

## New Concept 2: The Cloudflare REST API

Cloudflare has a public REST API for managing everything in your account — DNS records, zones, tunnels, etc. You call it from the backend using regular HTTP requests (just like how your Docker routes call the Docker socket over HTTP with Dockerode).

### What you need from the user (stored as environment variables)

```
CF_API_TOKEN   — Cloudflare API token with DNS edit + Zone read permissions
CF_ZONE_ID     — The Zone ID of your domain (found in the Cloudflare dashboard right sidebar)
CF_DOMAIN      — Your root domain, e.g. "home-cloud.live"
CF_TUNNEL_ID   — Your tunnel UUID, e.g. "<tunnel-id>"
```

> These go in the `.env` file in the agent directory. Never hardcode them.

### Creating a DNS CNAME record

When you expose a container as `jellyfin`, you need a DNS record:
```
jellyfin.home-cloud.live  CNAME  <tunnel-id>.cfargotunnel.com
```

This is done via a single `POST` to the Cloudflare API:

```js
async function createDnsRecord(subdomain) {
  const hostname   = `${subdomain}.${process.env.CF_DOMAIN}`;
  const tunnelCname = `${process.env.CF_TUNNEL_ID}.cfargotunnel.com`;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${process.env.CF_ZONE_ID}/dns_records`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type:    'CNAME',
        name:    hostname,           // "jellyfin.home-cloud.live"
        content: tunnelCname,        // "<tunnel-id>.cfargotunnel.com"
        proxied: true,               // must be true — routes through Cloudflare edge
        ttl:     1,                  // 1 = Auto (only valid when proxied: true)
        comment: 'Home Cloud auto-wired',
      }),
    }
  );

  const data = await res.json();

  if (!data.success) {
    // Cloudflare returns errors like: [{ code: 81057, message: "The record already exists." }]
    throw new Error(data.errors.map(e => e.message).join(', '));
  }

  // data.result.id is the record ID — store this so you can delete the record later
  return data.result.id;
}
```

### Deleting a DNS record

You need the `recordId` returned by `createDnsRecord`. Store it alongside the ingress rule (e.g. in a JSON file next to `config.yml`, or in the rule's YAML comment).

```js
async function deleteDnsRecord(recordId) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${process.env.CF_ZONE_ID}/dns_records/${recordId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${process.env.CF_API_TOKEN}` },
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.errors.map(e => e.message).join(', '));
}
```

### Testing without a frontend

You can test Cloudflare API calls directly with `curl`:

```bash
# List DNS records (sanity check your token + zone ID work)
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[].name'
```

---

## New Concept 3: Finding a process PID and sending `SIGHUP`

You already know from `cloudflare_tunnels.md` *what* SIGHUP does. Now here's how to send it from Node.js.

### Option A: `process.kill()` — if cloudflared PID is known

Node.js has a built-in function for sending signals to any process:

```js
process.kill(pid, 'SIGHUP');
```

This is not killing the process — despite the function name, you are sending it a signal. `cloudflared` catches `SIGHUP` and reloads its config.

### Option B: Finding the PID by name (most likely approach)

You won't hardcode a PID. You need to find the PID of the running `cloudflared` daemon. The simplest reliable approach is to spawn `pgrep`:

```js
const { execSync } = require('child_process');

function getCloudflaredPid() {
  try {
    // pgrep returns the PID(s) of processes matching the name
    const output = execSync('pgrep -x cloudflared', { encoding: 'utf8' }).trim();
    const pid = parseInt(output.split('\n')[0], 10);
    if (isNaN(pid)) throw new Error('Could not parse PID');
    return pid;
  } catch (err) {
    throw new Error('cloudflared is not running. Start it first.');
  }
}

function reloadCloudflared() {
  const pid = getCloudflaredPid();
  process.kill(pid, 'SIGHUP');
}
```

> Note: `execSync` (synchronous) is fine here because `pgrep` is instantaneous. You do not need `spawn`'s streaming for something this fast.

### Full expose flow combining everything

```js
router.post('/containers/:id/expose', requireAuth, async (req, res) => {
  const { subdomain } = req.body;
  const { id } = req.params;

  // Validate subdomain (lowercase alphanumeric + hyphens only)
  if (!/^[a-z0-9-]+$/.test(subdomain)) {
    return res.status(400).json({ error: 'Subdomain must be lowercase letters, numbers, and hyphens only' });
  }

  try {
    // 1. Get the container's host port
    const container = docker.getContainer(id);
    const info = await container.inspect();
    const portBindings = info.HostConfig?.PortBindings ?? {};

    // PortBindings format: { "8080/tcp": [{ "HostPort": "3000" }] }
    const hostPort = Object.values(portBindings)
      .flat()
      .map(b => b?.HostPort)
      .filter(Boolean)[0];

    if (!hostPort) {
      return res.status(400).json({ error: 'Container has no exposed ports' });
    }

    const hostname = `${subdomain}.${process.env.CF_DOMAIN}`;

    // 2. Edit config.yml (throws if rule already exists)
    addIngressRule(hostname, hostPort);

    // 3. Create DNS record on Cloudflare
    const dnsRecordId = await createDnsRecord(subdomain);

    // 4. Store the mapping (so we can delete it later)
    saveExposedMapping({ containerId: id, subdomain, hostname, hostPort, dnsRecordId });

    // 5. Send SIGHUP to cloudflared — zero downtime reload
    reloadCloudflared();

    res.json({ success: true, url: `https://${hostname}` });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## New Concept 4: Persisting exposed mappings

When you expose a container, you need to remember:
- Which container was exposed
- What subdomain it got
- What DNS record ID Cloudflare assigned (to delete it later)

Since there's no database, store this in a simple JSON file:

```js
const EXPOSED_FILE = path.join(process.env.HOME, '.home-cloud', 'exposed.json');

function loadExposedMappings() {
  if (!fs.existsSync(EXPOSED_FILE)) return {};
  return JSON.parse(fs.readFileSync(EXPOSED_FILE, 'utf8'));
}

function saveExposedMapping(entry) {
  const mappings = loadExposedMappings();
  mappings[entry.subdomain] = entry;
  fs.mkdirSync(path.dirname(EXPOSED_FILE), { recursive: true });
  fs.writeFileSync(EXPOSED_FILE, JSON.stringify(mappings, null, 2), 'utf8');
}

function deleteExposedMapping(subdomain) {
  const mappings = loadExposedMappings();
  delete mappings[subdomain];
  fs.writeFileSync(EXPOSED_FILE, JSON.stringify(mappings, null, 2), 'utf8');
}
```

The file will look like:

```json
{
  "jellyfin": {
    "containerId": "a3f2e...",
    "subdomain": "jellyfin",
    "hostname": "jellyfin.home-cloud.live",
    "hostPort": "8096",
    "dnsRecordId": "372e67954025e0ba6aaa07d81bff6000"
  }
}
```

---

## The full backend API shape for Phase 1

```
POST   /api/docker/containers/:id/expose      Expose container (body: { subdomain })
DELETE /api/docker/containers/:id/expose      Un-expose container (remove ingress + DNS record)
GET    /api/docker/exposed                    List all currently exposed containers
```

---

## Error handling surface area

Phase 1 has more failure modes than most features. Plan for all of these:

| Failure | Cause | Handle by |
|---|---|---|
| `cloudflared not running` | Daemon stopped | Return clear error, don't touch config |
| `subdomain already taken` | Duplicate rule in config.yml | Check before writing |
| `container has no ports` | Container not publishing any ports | Return 400 before any API calls |
| `Cloudflare API 403` | Bad token or wrong permissions | Surface the CF error message |
| `DNS record already exists` | CF error code 81057 | Check or catch and treat as idempotent |
| `config.yml parse error` | Manually edited file is broken | Catch `yaml.load` throw, abort |
| `SIGHUP fails` | cloudflared crashed after config write | Log warning — config is already written, tunnel will pick it up on next start |

The key principle: **do the cheap/safe operations first**. Check the container has ports → validate subdomain → edit config.yml → call Cloudflare API → send SIGHUP. If the Cloudflare API call fails, roll back the config.yml edit.

---

## What you already know that carries over

| Existing skill | How it applies |
|---|---|
| `fetch()` for HTTP calls | Cloudflare API is just REST — same pattern as any API call |
| `container.inspect()` via Dockerode | Getting the container's port bindings |
| `express` routing + `requireAuth` | Identical |
| `fs.readFileSync / writeFileSync` | Config file and exposed.json persistence |
| React state + loading/error pattern | "Expose" button with pending/success/error states |

## What is genuinely new (summary)

1. **`js-yaml` for safe config.yml editing** — parse → mutate JS object → write back. The catch-all rule insertion order is critical.
2. **Cloudflare REST API** — authenticated `fetch` calls to create/delete DNS CNAME records. Requires `CF_API_TOKEN`, `CF_ZONE_ID`, `CF_TUNNEL_ID` in `.env`.
3. **`pgrep` + `process.kill(pid, 'SIGHUP')`** — finding the cloudflared daemon PID and signaling it to reload without restart.
4. **Flat JSON file for state persistence** — storing the exposed mappings (subdomain → container → DNS record ID) so they can be reversed.

---

## Suggested implementation order

```
1. Implement addIngressRule() and removeIngressRule() — test by editing config.yml manually and verifying yaml.dump output
2. Implement reloadCloudflared() — test that SIGHUP reaches the daemon (check cloudflared logs)
3. Implement createDnsRecord() + deleteDnsRecord() — test with curl first
4. Wire together in POST /containers/:id/expose with rollback on CF API failure
5. Implement GET /exposed + DELETE /containers/:id/expose
6. Frontend: "Expose" button on container rows → subdomain input modal → show resulting URL
```

Test steps 1–3 with `curl` and manual inspection before writing a single line of frontend code.
