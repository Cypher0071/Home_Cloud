# 🐳 Docker Deep Dive — From Zero to Building `docker.js`

> Notes from the Home Cloud backend grilling session.
> Covers everything needed to implement `routes/docker.js`.

---

## Chapter 1: What Even Is Docker?

When you run `docker run nginx`, you think a "container" starts. But there's no such thing as a "container" in the Linux kernel. It's not a real object. It's an **illusion** created by combining three Linux kernel features.

### 1. Namespaces — "What can I see?"

A namespace isolates what a process can see. Linux has several:

| Namespace | Isolates |
|-----------|----------|
| `pid` | Process IDs. Container's bash thinks it's PID 1. |
| `net` | Network interfaces. Container gets its own eth0. |
| `mnt` | Filesystem mounts. Container sees its own root `/`. |
| `uts` | Hostname. Container can have its own hostname. |
| `ipc` | Inter-process communication (shared memory, pipes). |
| `user` | User IDs. Root inside container ≠ root on host. |

A process inside a container genuinely **cannot see** your host's processes. It's not blocked — it literally cannot see them because it's in a different PID namespace. PID 1 inside the container is nginx. PID 1 on your host is systemd. These are entirely separate namespaces.

### 2. Cgroups — "How much can I use?"

Control Groups are the kernel's resource accounting and limiting system. Docker creates a cgroup per container and sets limits:

- Max CPU shares
- Max memory
- Max disk I/O bandwidth

This is also where Docker's `stats` API gets its data from. The CPU and memory numbers come from reading cgroup pseudo-files:

```
/sys/fs/cgroup/cpuacct/docker/<container-id>/cpuacct.usage
/sys/fs/cgroup/memory/docker/<container-id>/memory.usage_in_bytes
```

### 3. Union Filesystem (OverlayFS) — "What's on disk?"

Container images are layers. When you do `docker pull nginx`, you get a stack of read-only layers. When the container runs, Docker adds a thin **read-write layer** on top. The container can write files, but the base image layers never change. Delete the container — the writable layer disappears. The image stays intact.

**Mental model:** A container is just a regular Linux process that has been placed into isolated namespaces and has resource limits applied via cgroups. No VM. No hypervisor. No separate kernel.

---

## Chapter 2: The Docker Architecture

When you type `docker run nginx`, you are NOT directly talking to the kernel.

```
You type: docker run nginx
                │
                ▼
        Docker CLI (docker binary)
                │  HTTP request
                ▼
        Docker Daemon (dockerd)   ← the real engine
                │
                ▼
        containerd               ← container lifecycle manager
                │
                ▼
        runc                     ← actually calls clone() + pivot_root()
                │
                ▼
        Linux Kernel (namespaces + cgroups)
```

The **Docker Daemon (`dockerd`)** is a long-running background process. It's the actual engine. The `docker` CLI is just a client that sends it HTTP requests.

How do they talk? Over a **Unix domain socket**.

---

## Chapter 3: The Unix Socket — `/var/run/docker.sock`

### What IS a Unix Socket?

You know TCP sockets — you connect to `ip:port`, data travels over the network stack.

A **Unix domain socket (UDS)** is like a TCP socket but it lives on the **filesystem** instead of the network. It's a file:

```bash
ls -la /var/run/docker.sock
# srw-rw---- 1 root docker 0 Jul 11 17:00 /var/run/docker.sock
```

That `s` at the start means socket. You can't `cat` it. But a process can `connect()` to it by path instead of by `ip:port`.

**Why UDS instead of TCP?**
- **Security**: No network exposure. Only processes on the same machine can connect.
- **Speed**: Skips the entire TCP/IP stack. Data goes kernel to kernel directly.
- **Permissions**: Standard Linux file permissions apply. Docker uses a `docker` group to control access.

### The Docker Remote API

`dockerd` exposes a **REST API** over that Unix socket. It's just HTTP — but over a file path instead of over a network.

When you run `docker ps`, the CLI does this internally:

```
GET /containers/json HTTP/1.1
Host: localhost
(sent over the Unix socket, not over TCP)
```

And `dockerd` responds with JSON. You can test this yourself:

```bash
curl --unix-socket /var/run/docker.sock http://localhost/containers/json
```

That's the entire Docker API. HTTP over a socket file. `dockerode` is just a Node.js HTTP client wrapper that already knows to route requests through that socket path.

### What is `dockerode`?

`dockerode` wraps the raw HTTP-over-socket calls into a clean JavaScript API:

```js
const Docker = require('dockerode');
const docker = new Docker(); // auto-connects to /var/run/docker.sock

docker.listContainers()           // GET /containers/json
container.start()                 // POST /containers/{id}/start
container.stop()                  // POST /containers/{id}/stop
container.stats({ stream: true }) // GET /containers/{id}/stats?stream=true
```

### Permissions — The Security Implication

```
srw-rw---- 1 root docker 0 Jul 11 17:00 /var/run/docker.sock
```

Owner: `root`. Group: `docker`. Permissions: `660`.

Your Node.js process needs to be in the `docker` group OR run as root to access it.

> [!CAUTION]
> **Access to the Docker socket = root access to the host machine. Period.**
> A process that can talk to the Docker socket can mount the host filesystem into a container and get a root shell on the host. For a personal home cloud this is acceptable, but you must know this consciously.

```bash
# This is why it's dangerous — full host root access via the socket:
docker run -v /:/host alpine chroot /host
```

To give your user socket access without running as root:

```bash
sudo usermod -aG docker $USER
# then log out and back in
```

---

## Chapter 4: Container States

Before building the API, know what states a container can be in:

```
          docker create
               │
               ▼
           CREATED ──── docker rm ──→ [gone]
               │
          docker start
               │
               ▼
           RUNNING ──── docker pause ──→ PAUSED
               │                              │
          docker stop                    docker unpause
               │                              │
               ▼                              │
           EXITED ◄───────────────────────────┘
               │
          docker start  (restart)
               │
               ▼
           RUNNING
```

States returned by the Docker API:

| State | Meaning |
|-------|---------|
| `created` | Container exists but has never started |
| `running` | Process is active |
| `paused` | Process is frozen (SIGSTOP sent) |
| `restarting` | In the middle of a restart cycle |
| `exited` | Process ended — code 0 = success, non-zero = crash |
| `dead` | Docker couldn't remove it cleanly |

---

## Chapter 5: The CPU Metrics Formula

This is where everyone gets confused. `container.stats()` returns **raw counters**, not percentages.

### The Raw Stats Object

```json
{
  "cpu_stats": {
    "cpu_usage": {
      "total_usage": 1234567890
    },
    "system_cpu_usage": 9876543210,
    "online_cpus": 8
  },
  "precpu_stats": {
    "cpu_usage": {
      "total_usage": 1234000000
    },
    "system_cpu_usage": 9876000000
  }
}
```

**What these numbers mean:**
- `cpu_usage.total_usage` — total CPU nanoseconds consumed by this container, ever since it started (always increasing)
- `system_cpu_usage` — total CPU nanoseconds consumed by the ENTIRE SYSTEM across all cores (always increasing)
- `precpu_stats` — the exact same fields, but from the PREVIOUS sample

Since these are ever-increasing counters, a single snapshot is useless. You need TWO snapshots to calculate a rate.

### The Formula

```
cpu_delta    = current.cpu_usage.total_usage  -  previous.cpu_usage.total_usage
system_delta = current.system_cpu_usage       -  previous.system_cpu_usage

cpu_percent  = (cpu_delta / system_delta) * online_cpus * 100
```

**Walk-through:**
1. `cpu_delta` — how many nanoseconds did this container use between the two snapshots?
2. `system_delta` — how many nanoseconds did the whole system use between the two snapshots? (all cores combined)
3. `cpu_delta / system_delta` — what fraction of total system CPU did this container consume? (0.0 to 1.0 across all cores)
4. `* online_cpus * 100` — scale it so that 100% = one full core maxed out. 800% = all 8 cores maxed out.

### Concrete Example

```
cpu_delta    = 500,000,000 ns   (container used 500ms of CPU)
system_delta = 8,000,000,000 ns (8 cores x 1 second = 8000ms total)
online_cpus  = 8

cpu% = (500ms / 8000ms) x 8 x 100
     = 0.0625 x 8 x 100
     = 50%
```

The container used 50% of one CPU core.

### Why Does the First Sample Always Return 0%?

On the very first `stats` call, `precpu_stats` is empty — all zeros. Docker actually sends `precpu_stats` as empty on the first emission, so `cpu_delta = 0`. **Always skip the first sample.** Use the stream's second and subsequent readings only.

### Memory Is Simpler

```json
{
  "memory_stats": {
    "usage": 52428800,
    "limit": 8589934592
  }
}
```

```
memory_percent = (usage / limit) x 100
memory_MB      = usage / 1024 / 1024
```

`usage` is current bytes. `limit` is the container's memory cap (or host total RAM if no limit is set).

---

## Chapter 6: The Stats Stream

`container.stats()` with `stream: true` is a **long-lived HTTP request**:

```
GET /containers/{id}/stats?stream=true HTTP/1.1
```

Docker's daemon keeps the connection open and emits one JSON object per second, each terminated by a newline:

```
{"read":"2024-...","cpu_stats":{...},"memory_stats":{...}}
{"read":"2024-...","cpu_stats":{...},"memory_stats":{...}}
```

Your Node.js code needs to:
1. Open the stream
2. Buffer incoming chunks (TCP can split a JSON object across multiple chunks)
3. Parse each complete JSON object
4. Calculate the delta vs. the previous sample
5. Emit to the browser via SSE (same pattern as the existing `/api/metrics` route)

If you want a one-time snapshot (not a stream):

```js
container.stats({ stream: false })
// Gives ONE sample — CPU will always be 0% (no previous sample to diff against)
```

---

## Chapter 7: Log Streaming

For Phase 2 of the roadmap — container logs — the Docker API endpoint is:

```
GET /containers/{id}/logs?stdout=true&stderr=true&follow=true&tail=100
```

`follow=true` keeps the connection open and streams new log lines as they appear.

### Docker's Binary Log Framing

Docker's log stream uses a **custom binary frame format** (not plain text):

```
[stream_type] [0] [0] [0] [size_byte_1] [size_byte_2] [size_byte_3] [size_byte_4] [message...]
```

- First byte: `1` = stdout, `2` = stderr
- Bytes 5–8: message length as a 32-bit big-endian integer
- Remaining bytes: the actual log message

`dockerode` handles this framing automatically via its `modem.demuxStream()` utility. You just receive clean stdout/stderr strings.

---

## Chapter 8: Image Management

An image is identified by two things: **name** (like `nginx`) and **digest** (a sha256 hash of its content).

`docker pull nginx` fetches layers from Docker Hub (or any registry). The App Catalog feature (Phase 3 roadmap) needs:

```js
docker.pull('nginx:latest', (err, stream) => {
    docker.modem.followProgress(stream, onFinish, onProgress);
});
```

The stream emits per-layer progress events:

```json
{"status": "Pulling from library/nginx", "id": "latest"}
{"status": "Downloading", "progressDetail": {"current": 1024, "total": 20480}, "id": "abc123"}
{"status": "Pull complete", "id": "abc123"}
```

You pipe these via SSE to the browser so the user sees a real-time progress indicator during install.

---

## Chapter 9: Networking and Port Mapping

Inside a container, nginx listens on port `80` (its internal port). Your host has its own port space. To reach nginx from outside, you need a **port mapping**:

```
Host port 8080  →  Container port 80
```

Docker manages this via `iptables` rules it creates automatically.

When creating a container with `dockerode`:

```js
docker.createContainer({
    Image: 'nginx',
    HostConfig: {
        PortBindings: {
            '80/tcp': [{ HostPort: '8080' }]
        }
    }
});
```

### The Port Manager (Phase 3 Roadmap)

Before spinning up a new container, your Port Manager must:
1. Query all running containers and collect their bound host ports
2. Pick a free host port that isn't already taken
3. Pass it to `createContainer`

This prevents conflicts when installing multiple apps from the catalog.

---

## Chapter 10: `docker stop` vs `docker kill`

| Command | Signal sent | What happens |
|---------|------------|--------------|
| `docker stop` | `SIGTERM` first, then `SIGKILL` after 10s | Process gets a chance to clean up and exit gracefully |
| `docker kill` | `SIGKILL` immediately (default) | Process is forcefully terminated, no cleanup |

**At the OS level:**
- `SIGTERM` (signal 15) — polite request to terminate. The process can catch this and do cleanup (flush buffers, close DB connections, etc.)
- `SIGKILL` (signal 9) — cannot be caught, blocked, or ignored. The kernel forcefully destroys the process.

`docker stop` is always preferred. `docker kill` is for when a container is stuck and not responding to SIGTERM.

---

## Self-Test Quiz

1. `docker stats` shows `cpu_delta = 0`. Is this always the first sample, or can it also mean the container is genuinely idle? How do you tell the difference?

2. Your Node.js process needs to access `/var/run/docker.sock`. Run Node as root, or add `<user>` to the `docker` group? Which and why? What's the real risk of either choice?

3. A user wants to move a container's data from one drive to another. They think they can just `docker rename`. Why doesn't that help, and what's the actual correct approach involving volumes?

4. The Docker stats endpoint with `stream: true` is a long-lived HTTP request. Your Express route needs to relay this to the browser. SSE or WebSocket — and why?

5. What's the difference between `docker stop` and `docker kill` at the OS signal level?

---

## Reference — Docker Remote API Endpoints

| Action | Method | Path |
|--------|--------|------|
| List containers | GET | `/containers/json?all=true` |
| Inspect container | GET | `/containers/{id}/json` |
| Start container | POST | `/containers/{id}/start` |
| Stop container | POST | `/containers/{id}/stop` |
| Restart container | POST | `/containers/{id}/restart` |
| Remove container | DELETE | `/containers/{id}` |
| Container stats | GET | `/containers/{id}/stats?stream=true` |
| Container logs | GET | `/containers/{id}/logs?stdout=true&stderr=true&follow=true` |
| List images | GET | `/images/json` |
| Pull image | POST | `/images/create?fromImage=nginx&tag=latest` |
| List volumes | GET | `/volumes` |
