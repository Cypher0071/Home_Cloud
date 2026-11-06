import * as yaml from 'js-yaml';

/**
 * Flags Compose settings that give a container control of the host.
 *
 * This is a heads-up, not a policy: anyone signed in to the dashboard already has a host
 * shell and the Docker socket, so the deploy still goes through. Single-container create
 * enforces the storage scope; Compose deploys do not (see docs/TECHNICAL_DEBT.md).
 */

const SENSITIVE_HOST_PATHS = ['/', '/etc', '/root', '/boot', '/proc', '/sys', '/dev', '/var/run', '/run'];
const DOCKER_SOCKET_RE = /(^|\/)docker\.sock$/;
const POWERFUL_CAPS = new Set(['ALL', 'SYS_ADMIN', 'SYS_MODULE', 'SYS_PTRACE', 'NET_ADMIN']);

function bindSource(volume: unknown): string | null {
  if (typeof volume === 'string') {
    const source = volume.split(':')[0]?.trim();
    // Named volumes ("data:/var/lib") have no slash; only host paths can reach the host.
    return source && (source.startsWith('/') || source.startsWith('~') || source.startsWith('.')) ? source : null;
  }
  if (volume && typeof volume === 'object') {
    const v = volume as { type?: unknown; source?: unknown };
    if (v.type === 'bind' && typeof v.source === 'string') return v.source;
  }
  return null;
}

function normalize(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Returns one human-readable warning per risky setting; empty when nothing stands out or the YAML does not parse. */
export function findRiskyComposeSettings(yamlStr: string): string[] {
  let doc: unknown;
  try {
    doc = yaml.load(yamlStr);
  } catch {
    return [];
  }
  const services = (doc as { services?: unknown } | null)?.services;
  if (!services || typeof services !== 'object' || Array.isArray(services)) return [];

  const warnings: string[] = [];
  for (const [name, raw] of Object.entries(services as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const svc = raw as Record<string, unknown>;

    if (svc.privileged === true) warnings.push(`${name}: runs privileged (full access to host devices)`);
    if (svc.network_mode === 'host') warnings.push(`${name}: uses the host network`);
    if (svc.pid === 'host') warnings.push(`${name}: shares the host process namespace`);
    if (Array.isArray(svc.devices) && svc.devices.length > 0) warnings.push(`${name}: maps host devices`);
    if (Array.isArray(svc.cap_add)) {
      const caps = svc.cap_add.map(c => String(c).toUpperCase().replace(/^CAP_/, '')).filter(c => POWERFUL_CAPS.has(c));
      if (caps.length > 0) warnings.push(`${name}: adds capabilities ${caps.join(', ')}`);
    }

    if (Array.isArray(svc.volumes)) {
      for (const volume of svc.volumes) {
        const source = bindSource(volume);
        if (!source) continue;
        if (DOCKER_SOCKET_RE.test(source)) {
          warnings.push(`${name}: mounts the Docker socket (${source}), which is root on the host`);
        } else if (SENSITIVE_HOST_PATHS.includes(normalize(source))) {
          warnings.push(`${name}: bind-mounts the host path ${normalize(source)}`);
        }
      }
    }
  }
  return warnings;
}
