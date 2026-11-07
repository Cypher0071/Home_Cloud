/**
 * Port suggestions and checks for the Run Container form.
 *
 * Each container has its own network, so any number of containers can listen on port 80
 * inside. Only the host port (left side of the mapping) has to be unique on the machine.
 * The agent repeats the hard checks (format, duplicates, port in use) on create.
 */

// Ports Chrome and Firefox refuse to open (ERR_UNSAFE_PORT).
// Keep in sync with agent/services/portCheck.js (agent/tests/verify_port_check.mjs compares them).
export const BROWSER_UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

export interface UsedPort {
  port: number;
  owner: string;
  /** false: a stopped container has it reserved. Usable now, but that container can't start again. */
  active: boolean;
}

export interface PortRow {
  hostPort: string;
  containerPort: string;
}

export interface PortIssue {
  level: 'error' | 'warning';
  field: 'host' | 'container';
  message: string;
  /** One-click fix offered next to the message. */
  fix?: { field: 'host' | 'container'; value: string; label: string };
}

export function parsePort(value: string): number | null {
  const s = value.trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
}

/**
 * A free, browser-safe host port for a container port: the same number when it is >= 1024 and
 * free, otherwise the next free one (web ports below 1024 start from 8080).
 */
export function suggestHostPort(containerPort: number, taken: Set<number>): number {
  const usable = (p: number) => !taken.has(p) && !BROWSER_UNSAFE_PORTS.has(p);
  const start = containerPort >= 1024 ? containerPort : 8080;
  for (let p = start; p <= 65535; p++) if (usable(p)) return p;
  for (let p = 1024; p < start; p++) if (usable(p)) return p;
  return start;
}

/** One row per port the image listens on, each with a suggested host port. */
export function defaultPortRows(exposed: number[], used: UsedPort[], fallbackContainerPort?: string): PortRow[] {
  const containerPorts = exposed.length > 0 ? exposed : (fallbackContainerPort ? [Number(fallbackContainerPort)] : []);
  if (containerPorts.length === 0) return [{ hostPort: '', containerPort: '' }];
  const taken = new Set(used.map((u) => u.port));
  return containerPorts.map((c) => {
    const host = suggestHostPort(c, taken);
    taken.add(host);
    return { hostPort: String(host), containerPort: String(c) };
  });
}

/** Issues for each row (same order as `rows`). Any 'error' should block submitting. */
export function checkPortRows(rows: PortRow[], used: UsedPort[], exposed: number[]): PortIssue[][] {
  const usedByPort = new Map(used.map((u) => [u.port, u]));
  const hostCounts = new Map<number, number>();
  const containerCounts = new Map<number, number>();
  for (const r of rows) {
    const h = parsePort(r.hostPort);
    const c = parsePort(r.containerPort);
    if (h) hostCounts.set(h, (hostCounts.get(h) ?? 0) + 1);
    if (c) containerCounts.set(c, (containerCounts.get(c) ?? 0) + 1);
  }

  return rows.map((r, idx) => {
    const issues: PortIssue[] = [];
    const rawHost = r.hostPort.trim();
    const rawContainer = r.containerPort.trim();
    if (!rawHost && !rawContainer) return issues;

    const host = parsePort(rawHost);
    const container = parsePort(rawContainer);
    // Ports a fix must not suggest: everything in use plus the other rows' host ports.
    const taken = new Set(used.map((u) => u.port));
    rows.forEach((o, i) => {
      const p = parsePort(o.hostPort);
      if (i !== idx && p) taken.add(p);
    });
    const suggestion = String(suggestHostPort(container ?? host ?? 8080, taken));
    const hostFix = { field: 'host' as const, value: suggestion, label: `Use ${suggestion}` };

    if (!rawHost) {
      issues.push({ level: 'error', field: 'host', message: 'Enter a host port, or remove this row.', fix: hostFix });
    } else if (!host) {
      issues.push({ level: 'error', field: 'host', message: 'Host port must be a number from 1 to 65535.' });
    } else if ((hostCounts.get(host) ?? 0) > 1) {
      issues.push({ level: 'error', field: 'host', message: `Host port ${host} is used by another row.`, fix: hostFix });
    } else {
      const u = usedByPort.get(host);
      if (u?.active) {
        issues.push({ level: 'error', field: 'host', message: `Port ${host} is already used by ${u.owner}.`, fix: hostFix });
      } else if (u) {
        issues.push({
          level: 'warning',
          field: 'host',
          message: `Port ${host} is reserved by ${u.owner}. It won't be able to start while this one runs.`,
          fix: hostFix,
        });
      }
      if (BROWSER_UNSAFE_PORTS.has(host)) {
        issues.push({
          level: 'warning',
          field: 'host',
          message: `Browsers block port ${host} (ERR_UNSAFE_PORT). Fine for non-web services, but a web UI here won't open on the LAN.`,
          fix: hostFix,
        });
      }
    }

    if (!rawContainer) {
      const fix = exposed[0] ? { field: 'container' as const, value: String(exposed[0]), label: `Use ${exposed[0]}` } : undefined;
      issues.push({ level: 'error', field: 'container', message: 'Enter the container port, or remove this row.', fix });
    } else if (!container) {
      issues.push({ level: 'error', field: 'container', message: 'Container port must be a number from 1 to 65535.' });
    } else if ((containerCounts.get(container) ?? 0) > 1) {
      issues.push({ level: 'error', field: 'container', message: `Container port ${container} is mapped in another row.` });
    } else if (exposed.length > 0 && !exposed.includes(container)) {
      const list = exposed.join(', ');
      const unmapped = exposed.find((p) => !containerCounts.has(p));
      issues.push({
        level: 'warning',
        field: 'container',
        message: `This image listens on ${list}, not ${container}. Nothing will answer unless you configured it to.`,
        fix: unmapped ? { field: 'container', value: String(unmapped), label: `Use ${unmapped}` } : undefined,
      });
    }
    return issues;
  });
}
