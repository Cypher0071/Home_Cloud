import { useState, useEffect, useCallback, useRef, useMemo, Suspense, createElement } from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Trash2,
  Box,
  AlertCircle,
  X,
  Cpu,
  HardDrive,
  Plus,
  Globe,
  ExternalLink,
  GlobeLock,
  Layers,
  FileText,
  Zap,
  Terminal,
  Search,
  Check,
  Copy,
  ChevronRight,
  ChevronDown,
  Download,
  Activity,
  Code,
  Eye,
  EyeOff,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Upload,
} from 'lucide-react';
import { getLazyWindowApp } from '../../utils/windowAppRegistry';
import WindowSkeleton from '../skeletons/WindowSkeleton';
import WindowErrorBoundary from '../WindowErrorBoundary';

import styles from './docker.module.css';
import { useNetworkDetector } from '../../hooks/useNetworkDetector';
import * as yaml from 'js-yaml';

/* ─── Types ─── */

interface DockerPort {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}

interface ExposedRule {
  url: string;
  subdomain: string;
  hostname: string;
  port: string | null;
}

interface Container {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Ports: DockerPort[];
  Created: number;
  exposedRule?: ExposedRule | null;
}

interface DockerImage {
  Id: string;
  RepoTags: string[] | null;
  Size: number;
  Created: number;
}

interface PullLayer {
  id: string;
  status: string;
  progress: string;
  current: number;
  total: number;
}

type ActionKind = 'start' | 'stop' | 'restart' | 'delete';

export interface ComposeContainer {
  id: string;
  name: string;
  service: string;
  image: string;
  state: string;
  status: string;
}

export type StackContainer = ComposeContainer;

export interface ComposeProject {
  name: string;
  status: 'running' | 'partial' | 'stopped' | 'uncreated';
  servicesCount: number;
  runningServicesCount: number;
  containers: ComposeContainer[];
  yamlExists: boolean;
}

export type Stack = ComposeProject;

interface LogLine {
  timestamp: string | null;
  text: string;
}

interface FormPort {
  id: string;
  host: string;
  container: string;
}

interface FormEnv {
  id: string;
  key: string;
  value: string;
}

interface FormVolume {
  id: string;
  host: string;
  container: string;
}

interface FormService {
  id: string;
  name: string;
  image: string;
  restart: string;
  ports: FormPort[];
  env: FormEnv[];
  volumes: FormVolume[];
  command: string;
}

const generateRandomPassword = (length = 16): string => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
};

const createDefaultService = (index = 1): FormService => ({
  id: Math.random().toString(36).substring(2, 9),
  name: index === 1 ? 'web' : `service-${index}`,
  image: '',
  restart: 'always',
  ports: [{ id: 'p1', host: '8080', container: '80' }],
  env: [],
  volumes: [],
  command: '',
});

function isDockerNamedVolume(val: string): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('.') ||
    trimmed.startsWith('~') ||
    trimmed.includes('/') ||
    trimmed.includes('\\')
  ) {
    return false;
  }
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(trimmed);
}

function generateComposeYamlFromServices(services: FormService[]): string {
  if (!services || services.length === 0) {
    return 'version: "3.8"\n\nservices:\n  app:\n    image: nginx:alpine\n    restart: always\n    ports:\n      - "8080:80"\n';
  }

  let yaml = 'version: "3.8"\n\nservices:\n';
  const namedVolumes = new Set<string>();

  for (const s of services) {
    const sName = (s.name || 'app').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'app';
    const sImg = (s.image || '').trim() || 'nginx:alpine';
    const restart = s.restart || 'always';

    yaml += `  ${sName}:\n`;
    yaml += `    image: ${sImg}\n`;
    yaml += `    restart: ${restart}\n`;

    if (s.command && s.command.trim()) {
      yaml += `    command: ${s.command.trim()}\n`;
    }

    const validPorts = s.ports.filter((p) => p.container.trim() !== '');
    if (validPorts.length > 0) {
      yaml += `    ports:\n`;
      for (const p of validPorts) {
        const h = p.host.trim();
        const c = p.container.trim();
        if (h) {
          yaml += `      - "${h}:${c}"\n`;
        } else {
          yaml += `      - "${c}"\n`;
        }
      }
    }

    const validEnvs = s.env.filter((e) => e.key.trim() !== '');
    if (validEnvs.length > 0) {
      yaml += `    environment:\n`;
      for (const e of validEnvs) {
        yaml += `      ${e.key.trim()}: "${e.value}"\n`;
      }
    }

    const validVols = s.volumes.filter((v) => v.container.trim() !== '');
    if (validVols.length > 0) {
      yaml += `    volumes:\n`;
      for (const v of validVols) {
        const h = v.host.trim();
        const c = v.container.trim();
        if (h) {
          yaml += `      - ${h}:${c}\n`;
          if (isDockerNamedVolume(h)) {
            namedVolumes.add(h);
          }
        } else {
          yaml += `      - ${c}\n`;
        }
      }
    }

    yaml += `\n`;
  }

  if (namedVolumes.size > 0) {
    yaml += `volumes:\n`;
    for (const vol of Array.from(namedVolumes)) {
      yaml += `  ${vol}:\n`;
    }
    yaml += `\n`;
  }

  return yaml.trimEnd();
}

interface ParseYamlResult {
  success: boolean;
  services?: FormService[];
  error?: string;
}

function parseComposeYamlToServices(yamlStr: string, existingServices: FormService[] = []): ParseYamlResult {
  if (!yamlStr || !yamlStr.trim()) {
    return {
      success: true,
      services: [createDefaultService(1)],
    };
  }

  let doc: any;
  try {
    doc = yaml.load(yamlStr);
  } catch (err: any) {
    return {
      success: false,
      error: `YAML syntax error: ${err.reason || err.message || 'Invalid YAML format'}`,
    };
  }

  if (!doc || typeof doc !== 'object') {
    return {
      success: false,
      error: 'YAML document must define an object with a "services" block.',
    };
  }

  if (!doc.services || typeof doc.services !== 'object' || Array.isArray(doc.services)) {
    return {
      success: false,
      error: 'Missing root "services:" mapping in compose YAML.',
    };
  }

  const existingMap = new Map<string, FormService>();
  for (const s of existingServices) {
    if (s.name) {
      existingMap.set(s.name.toLowerCase(), s);
    }
  }

  const parsedServices: FormService[] = [];
  const serviceKeys = Object.keys(doc.services);

  if (serviceKeys.length === 0) {
    return {
      success: true,
      services: [createDefaultService(1)],
    };
  }

  for (const sKey of serviceKeys) {
    const sVal = doc.services[sKey];
    if (!sVal || typeof sVal !== 'object') continue;

    const existing = existingMap.get(sKey.toLowerCase());
    const serviceId = existing ? existing.id : Math.random().toString(36).substring(2, 9);

    // Image
    const image = typeof sVal.image === 'string' ? sVal.image.trim() : '';

    // Restart policy
    let restart = 'always';
    if (typeof sVal.restart === 'string') {
      const r = sVal.restart.trim().toLowerCase();
      if (['always', 'unless-stopped', 'on-failure', 'no'].includes(r)) {
        restart = r;
      } else {
        restart = sVal.restart.trim();
      }
    }

    // Command
    let command = '';
    if (typeof sVal.command === 'string') {
      command = sVal.command.trim();
    } else if (Array.isArray(sVal.command)) {
      command = sVal.command.map(String).join(' ');
    }

    // Ports
    const ports: FormPort[] = [];
    if (Array.isArray(sVal.ports)) {
      for (const p of sVal.ports) {
        if (typeof p === 'string' || typeof p === 'number') {
          const str = String(p).trim();
          const clean = str.replace(/^['"]|['"]$/g, '');
          const parts = clean.split(':');
          if (parts.length === 1) {
            ports.push({
              id: Math.random().toString(36).substring(2, 7),
              host: '',
              container: parts[0].trim(),
            });
          } else if (parts.length === 2) {
            ports.push({
              id: Math.random().toString(36).substring(2, 7),
              host: parts[0].trim(),
              container: parts[1].trim(),
            });
          } else if (parts.length >= 3) {
            ports.push({
              id: Math.random().toString(36).substring(2, 7),
              host: parts[parts.length - 2].trim(),
              container: parts[parts.length - 1].trim(),
            });
          }
        } else if (p && typeof p === 'object') {
          const target = p.target != null ? String(p.target) : '';
          const published = p.published != null ? String(p.published) : '';
          if (target || published) {
            ports.push({
              id: Math.random().toString(36).substring(2, 7),
              host: published,
              container: target,
            });
          }
        }
      }
    }

    // Environment
    const env: FormEnv[] = [];
    if (sVal.environment) {
      if (Array.isArray(sVal.environment)) {
        for (const item of sVal.environment) {
          if (typeof item === 'string') {
            const eqIdx = item.indexOf('=');
            if (eqIdx !== -1) {
              const k = item.slice(0, eqIdx).trim();
              const v = item.slice(eqIdx + 1).replace(/^['"]|['"]$/g, '');
              if (k) {
                env.push({
                  id: Math.random().toString(36).substring(2, 7),
                  key: k,
                  value: v,
                });
              }
            } else if (item.trim()) {
              env.push({
                id: Math.random().toString(36).substring(2, 7),
                key: item.trim(),
                value: '',
              });
            }
          }
        }
      } else if (typeof sVal.environment === 'object') {
        for (const [k, v] of Object.entries(sVal.environment)) {
          env.push({
            id: Math.random().toString(36).substring(2, 7),
            key: String(k).trim(),
            value: v != null ? String(v) : '',
          });
        }
      }
    }

    // Volumes
    const volumes: FormVolume[] = [];
    if (Array.isArray(sVal.volumes)) {
      for (const v of sVal.volumes) {
        if (typeof v === 'string') {
          const str = v.trim().replace(/^['"]|['"]$/g, '');
          const parts = str.split(':');
          if (parts.length === 1) {
            volumes.push({
              id: Math.random().toString(36).substring(2, 7),
              host: '',
              container: parts[0].trim(),
            });
          } else if (parts.length >= 2) {
            volumes.push({
              id: Math.random().toString(36).substring(2, 7),
              host: parts[0].trim(),
              container: parts[1].trim(),
            });
          }
        } else if (v && typeof v === 'object') {
          const src = v.source != null ? String(v.source) : '';
          const tgt = v.target != null ? String(v.target) : '';
          if (src || tgt) {
            volumes.push({
              id: Math.random().toString(36).substring(2, 7),
              host: src,
              container: tgt,
            });
          }
        }
      }
    }

    parsedServices.push({
      id: serviceId,
      name: sKey,
      image,
      restart,
      ports,
      env,
      volumes,
      command,
    });
  }

  if (parsedServices.length === 0) {
    return {
      success: true,
      services: [createDefaultService(1)],
    };
  }

  return { success: true, services: parsedServices };
}

const POPULAR_DOCKER_IMAGES: string[] = [
  'nginx:alpine',
  'nginx:latest',
  'postgres:16-alpine',
  'postgres:15-alpine',
  'redis:alpine',
  'redis:7',
  'node:20-alpine',
  'node:22-alpine',
  'python:3.12-slim',
  'python:3.11-slim',
  'mysql:8.0',
  'mariadb:latest',
  'mongo:latest',
  'traefik:v3.0',
  'louislam/uptime-kuma:1',
  'portainer/portainer-ce:latest',
  'vaultwarden/server:latest',
  'grafana/grafana:latest',
  'prom/prometheus:latest',
  'wordpress:latest',
  'nextcloud:apache',
  'gitea/gitea:latest',
  'memcached:alpine',
  'rabbitmq:3-management',
  'minio/minio:latest',
];

/* ─── Helpers ─── */

function getStatusClass(state: string): string {
  switch (state.toLowerCase()) {
    case 'running':    return styles.statusRunning;
    case 'exited':     return styles.statusExited;
    case 'paused':     return styles.statusPaused;
    case 'restarting': return styles.statusRestarting;
    default:           return styles.statusDead;
  }
}

function getDotColor(state: string): string {
  switch (state.toLowerCase()) {
    case 'running':    return '#22c55e';
    case 'exited':     return '#737373';
    case 'paused':     return '#facc15';
    case 'restarting': return '#facc15';
    case 'dead':       return '#ef4444';
    default:           return '#737373';
  }
}

function formatAge(unix: number): string {
  const diff = Date.now() / 1000 - unix;
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  if (i < 0) return `${bytes} B`;
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function calculateCpuPercent(stats: any): number {
  if (!stats) return 0;
  const cpuStats = stats.cpu_stats;
  const preCpuStats = stats.precpu_stats;
  if (!cpuStats || !preCpuStats) return 0;

  const cpuDelta = (cpuStats.cpu_usage?.total_usage ?? 0) - (preCpuStats.cpu_usage?.total_usage ?? 0);
  const systemDelta = (cpuStats.system_cpu_usage ?? 0) - (preCpuStats.system_cpu_usage ?? 0);
  const numCpus = cpuStats.online_cpus || (cpuStats.cpu_usage?.percpu_usage ? cpuStats.cpu_usage.percpu_usage.length : 1);

  if (systemDelta > 0 && cpuDelta > 0) {
    return Math.min(100, (cpuDelta / systemDelta) * numCpus * 100.0);
  }
  return 0;
}

function getMemoryUsage(stats: any) {
  if (!stats || !stats.memory_stats) return { usage: 0, limit: 0, percent: 0 };
  const usage = stats.memory_stats.usage ?? 0;
  const limit = stats.memory_stats.limit ?? 0;
  const percent = limit > 0 ? (usage / limit) * 100 : 0;
  return { usage, limit, percent: Math.min(100, percent) };
}

function getNetworkIO(stats: any) {
  if (!stats || !stats.networks) return { rx: 0, tx: 0 };
  let rx = 0;
  let tx = 0;
  Object.values(stats.networks).forEach((n: any) => {
    rx += n.rx_bytes ?? 0;
    tx += n.tx_bytes ?? 0;
  });
  return { rx, tx };
}

function getBlockIO(stats: any) {
  if (!stats || !stats.blkio_stats) return { read: 0, write: 0 };
  let read = 0;
  let write = 0;
  const entries = stats.blkio_stats.io_service_bytes_recursive;
  if (Array.isArray(entries)) {
    entries.forEach((entry: any) => {
      const op = entry.op?.toLowerCase();
      if (op === 'read') read += entry.value ?? 0;
      if (op === 'write') write += entry.value ?? 0;
    });
  }
  return { read, write };
}

/* ─── Vercel / Geist Minimalist Sparkline Chart Component ─── */

function SparklineChart({
  points,
  height = 44,
  strokeColor = '#ffffff',
  fillGradientId = 'spark-grad',
}: {
  points: number[];
  height?: number;
  strokeColor?: string;
  fillGradientId?: string;
}) {
  if (!points || points.length < 2) {
    return (
      <div style={{ height: `${height}px`, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '10px', color: '#525252', fontFamily: 'var(--mono)' }}>Collecting historical data…</span>
      </div>
    );
  }

  const W = 320;
  const H = height;
  const max = 100;

  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W;
    const clampedV = Math.min(100, Math.max(0, v));
    const y = H - (clampedV / max) * (H - 6) - 3;
    return { x, y, str: `${x.toFixed(1)},${y.toFixed(1)}` };
  });

  const polylinePoints = coords.map((c) => c.str).join(' ');
  const areaPath = `M 0,${H} L ${coords[0].str} ${coords.map((c) => `L ${c.str}`).join(' ')} L ${W},${H} Z`;

  return (
    <div style={{ width: '100%', position: 'relative', height: `${height}px` }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: `${height}px`, display: 'block', overflow: 'visible' }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Baseline & mid grid lines */}
        <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke="#262626" strokeWidth="1" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#1c1c1c" strokeWidth="1" strokeDasharray="2 3" />

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${fillGradientId})`} />

        {/* Line stroke */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Current latest point dot */}
        {coords.length > 0 && (
          <circle
            cx={coords[coords.length - 1].x}
            cy={coords[coords.length - 1].y}
            r="3"
            fill={strokeColor}
            stroke="#000000"
            strokeWidth="1.5"
          />
        )}
      </svg>
    </div>
  );
}

/* ─── Interactive Collapsible JSON Tree Component ─── */

function JsonTreeNode({
  name,
  value,
  isLast = true,
  searchQuery = '',
  level = 0,
  defaultExpanded = true,
}: {
  name?: string;
  value: any;
  isLast?: boolean;
  searchQuery?: string;
  level?: number;
  defaultExpanded?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(!defaultExpanded);
  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);

  const renderHighlighted = (text: string) => {
    if (!searchQuery.trim()) return <span>{text}</span>;
    const parts = text.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === searchQuery.toLowerCase() ? (
            <mark key={i} className={styles.jsonKeyMatch}>
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  };

  if (!isObject) {
    let valElement: React.ReactNode;
    if (typeof value === 'string') {
      valElement = <span className={styles.jsonString}>"{renderHighlighted(value)}"</span>;
    } else if (typeof value === 'number') {
      valElement = <span className={styles.jsonNumber}>{value}</span>;
    } else if (typeof value === 'boolean') {
      valElement = <span className={styles.jsonBoolean}>{value ? 'true' : 'false'}</span>;
    } else if (value === null) {
      valElement = <span className={styles.jsonNull}>null</span>;
    } else {
      valElement = <span>{String(value)}</span>;
    }

    return (
      <div className={styles.jsonLine} style={{ paddingLeft: `${level * 16}px` }}>
        {name !== undefined && (
          <>
            <span className={styles.jsonKey}>{renderHighlighted(name)}</span>
            <span style={{ color: '#525252' }}>:&nbsp;</span>
          </>
        )}
        {valElement}
        {!isLast && <span style={{ color: '#525252' }}>,</span>}
      </div>
    );
  }

  const keys = Object.keys(value);
  const isEmpty = keys.length === 0;
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';

  return (
    <div className={styles.jsonNode}>
      <div
        className={styles.jsonLine}
        style={{ paddingLeft: `${level * 16}px`, cursor: isEmpty ? 'default' : 'pointer' }}
        onClick={() => !isEmpty && setCollapsed(!collapsed)}
      >
        {!isEmpty && (
          <span className={styles.jsonToggle}>
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
        )}
        {isEmpty && <span style={{ width: '12px', display: 'inline-block' }} />}
        {name !== undefined && (
          <>
            <span className={styles.jsonKey}>{renderHighlighted(name)}</span>
            <span style={{ color: '#525252' }}>:&nbsp;</span>
          </>
        )}
        <span style={{ color: '#888888' }}>
          {openBracket}
          {collapsed && !isEmpty && <span style={{ color: '#525252', fontSize: '10px' }}>…{keys.length} items…</span>}
          {collapsed && closeBracket}
          {collapsed && !isLast && <span style={{ color: '#525252' }}>,</span>}
        </span>
      </div>

      {!collapsed && !isEmpty && (
        <div>
          {keys.map((k, idx) => (
            <JsonTreeNode
              key={k}
              name={isArray ? undefined : k}
              value={value[k]}
              isLast={idx === keys.length - 1}
              searchQuery={searchQuery}
              level={level + 1}
              defaultExpanded={level < 1}
            />
          ))}
        </div>
      )}

      {!collapsed && !isEmpty && (
        <div className={styles.jsonLine} style={{ paddingLeft: `${level * 16 + 12}px` }}>
          <span style={{ color: '#888888' }}>{closeBracket}</span>
          {!isLast && <span style={{ color: '#525252' }}>,</span>}
        </div>
      )}
    </div>
  );
}

/* ─── Custom Local Image Autocomplete Component ─── */

interface ImageAutocompleteInputProps {
  value: string;
  onChange: (val: string) => void;
  localImages: string[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

function ImageAutocompleteInput({
  value,
  onChange,
  localImages,
  placeholder,
  disabled,
  required,
}: ImageAutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute matching local images only
  const filteredImages = useMemo(() => {
    if (!value) return [];
    const trimmed = value.trim();
    if (trimmed.length === 0) return [];

    // If user types "/", show all locally available images
    if (trimmed === '/') {
      return localImages;
    }

    // If user typed "/query" or "query", search local images
    const query = trimmed.startsWith('/') ? trimmed.slice(1).toLowerCase() : trimmed.toLowerCase();
    if (!query) return localImages;

    return localImages.filter((img) => img.toLowerCase().includes(query));
  }, [value, localImages]);

  // Dropdown visibility rule:
  // - Must be open
  // - Value must have at least 1 character typed
  // - Must have matching local images
  const shouldShow = isOpen && value.trim().length >= 1 && filteredImages.length > 0;

  // Reset highlight on query change
  useEffect(() => {
    setHighlightIndex(-1);
  }, [value]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (img: string) => {
    onChange(img);
    setIsOpen(false);
    setHighlightIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!shouldShow) {
      if (e.key === 'ArrowDown' && value.trim().length >= 1 && filteredImages.length > 0) {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => (prev < filteredImages.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : filteredImages.length - 1));
    } else if (e.key === 'Enter') {
      if (highlightIndex >= 0 && highlightIndex < filteredImages.length) {
        e.preventDefault();
        handleSelect(filteredImages[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={styles.autocompleteInputWrapper}>
      <input
        ref={inputRef}
        className={styles.fieldInput}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          if (value.trim().length >= 1) {
            setIsOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />

      {shouldShow && (
        <div className={styles.autocompleteDropdown}>
          <div
            style={{
              padding: '4px 8px',
              fontSize: '10px',
              color: '#71717a',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderBottom: '1px solid #1f1f23',
              marginBottom: '3px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Local Images ({filteredImages.length})</span>
            <span style={{ fontSize: '9px', color: '#52525b', textTransform: 'none', fontWeight: 400 }}>
              Type / for all
            </span>
          </div>
          {filteredImages.map((img, idx) => (
            <div
              key={img}
              className={`${styles.autocompleteItem} ${idx === highlightIndex ? styles.autocompleteItemHighlighted : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(img);
              }}
              onMouseEnter={() => setHighlightIndex(idx)}
            >
              <div className={styles.autocompleteItemLeft}>
                <Box size={12} className={styles.autocompleteItemIcon} />
                <span className={styles.autocompleteItemText}>{img}</span>
              </div>
              <span className={styles.autocompleteLocalBadge}>local</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Real-Time Live Overlaid Syntax Highlighting YAML Editor ─── */

function highlightYamlValue(val: string): React.ReactNode {
  if (!val) return null;

  const tokens: React.ReactNode[] = [];
  const regex = /("[^"]*"|'[^']*'|\b(?:true|false|yes|no)\b|\b(?:always|unless-stopped|on-failure)\b|\b\d+\b|[^\s"'`]+|\s+)/g;
  let match;

  while ((match = regex.exec(val)) !== null) {
    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith('"') || token.startsWith("'")) {
      tokens.push(<span key={key} style={{ color: '#4ade80' }}>{token}</span>); // Emerald string
    } else if (/^(true|false|yes|no)$/i.test(token)) {
      tokens.push(<span key={key} style={{ color: '#f472b6', fontWeight: 600 }}>{token}</span>); // Pink boolean
    } else if (/^\d+$/.test(token)) {
      tokens.push(<span key={key} style={{ color: '#fb923c' }}>{token}</span>); // Orange number
    } else if (/^(always|unless-stopped|on-failure)$/i.test(token)) {
      tokens.push(<span key={key} style={{ color: '#c084fc', fontWeight: 500 }}>{token}</span>); // Purple restart
    } else if (token.includes(':') && !token.startsWith('http')) {
      const parts = token.split(':');
      tokens.push(
        <span key={key}>
          <span style={{ color: '#e2e8f0' }}>{parts[0]}</span>
          <span style={{ color: '#64748b' }}>:</span>
          <span style={{ color: '#38bdf8' }}>{parts.slice(1).join(':')}</span>
        </span>
      );
    } else {
      tokens.push(<span key={key} style={{ color: '#e2e8f0' }}>{token}</span>);
    }
  }

  return tokens.length > 0 ? tokens : <span>{val}</span>;
}

function highlightYamlLine(line: string): React.ReactNode {
  if (!line) return <span>&nbsp;</span>;

  // Full line comment
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) {
    const indent = line.substring(0, line.length - trimmed.length);
    return (
      <>
        <span>{indent}</span>
        <span style={{ color: '#64748b', fontStyle: 'italic' }}>{trimmed}</span>
      </>
    );
  }

  // Inline comment separation
  let comment = '';
  let content = line;
  const hashIdx = line.indexOf(' #');
  if (hashIdx !== -1) {
    content = line.substring(0, hashIdx);
    comment = line.substring(hashIdx);
  }

  // Key-value detection: indent + optional dash + key + colon + rest
  const keyMatch = content.match(/^(\s*(?:-\s+)?)([a-zA-Z0-9_.-]+)(:)(\s*.*)$/);
  if (keyMatch) {
    const [, indentPrefix, keyName, colon, rest] = keyMatch;
    return (
      <>
        <span style={{ color: '#64748b' }}>{indentPrefix}</span>
        <span style={{ color: '#38bdf8', fontWeight: 600 }}>{keyName}</span>
        <span style={{ color: '#64748b' }}>{colon}</span>
        {highlightYamlValue(rest)}
        {comment && <span style={{ color: '#64748b', fontStyle: 'italic' }}>{comment}</span>}
      </>
    );
  }

  // Dash list item without key (e.g. - "8080:80" or - ./data:/app)
  const listMatch = content.match(/^(\s*-\s+)(.*)$/);
  if (listMatch) {
    const [, dashPrefix, rest] = listMatch;
    return (
      <>
        <span style={{ color: '#64748b' }}>{dashPrefix}</span>
        {highlightYamlValue(rest)}
        {comment && <span style={{ color: '#64748b', fontStyle: 'italic' }}>{comment}</span>}
      </>
    );
  }

  return (
    <>
      {highlightYamlValue(content)}
      {comment && <span style={{ color: '#64748b', fontStyle: 'italic' }}>{comment}</span>}
    </>
  );
}

function LiveYamlEditor({
  value,
  onChange,
  disabled,
  validation,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  validation: { valid: boolean; message: string };
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const underlayRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (!textareaRef.current) return;
    const top = textareaRef.current.scrollTop;
    const left = textareaRef.current.scrollLeft;
    if (underlayRef.current) {
      underlayRef.current.scrollTop = top;
      underlayRef.current.scrollLeft = left;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = top;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const nextVal = val.substring(0, start) + '  ' + val.substring(end);
      onChange(nextVal);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  const lineArray = useMemo(() => {
    return (value || '').split('\n');
  }, [value]);

  return (
    <div className={styles.yamlEditorWrapper}>
      <div className={styles.yamlEditorHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 600, color: '#ededed' }}>docker-compose.yml</span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted, #737373)' }}>
            ({lineArray.length} line{lineArray.length !== 1 ? 's' : ''})
          </span>
        </div>

        <div className={styles.yamlValidationBadge}>
          {validation.valid ? (
            <span className={styles.yamlValid}>
              <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '3px' }} />
              {validation.message}
            </span>
          ) : (
            <span className={styles.yamlInvalid}>
              <AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '3px' }} />
              {validation.message}
            </span>
          )}
        </div>
      </div>

      <div className={styles.yamlLiveContainer}>
        {/* Line Numbers Gutter */}
        <div ref={gutterRef} className={styles.yamlGutter}>
          {lineArray.map((_, i) => (
            <div key={i + 1} className={styles.yamlGutterLine}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Highlighted Underlay + Transparent Textarea Layer */}
        <div className={styles.yamlLiveLayer}>
          <div ref={underlayRef} className={styles.yamlHighlightUnderlay}>
            {lineArray.map((line, i) => (
              <div key={i} className={styles.yamlHighlightLine}>
                {highlightYamlLine(line)}
              </div>
            ))}
          </div>

          <textarea
            ref={textareaRef}
            className={styles.yamlTextareaOverlay}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="services:&#10;  app:&#10;    image: nginx:alpine"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─── */

export default function DockerApp() {
  const net = useNetworkDetector();

  // Top Level Window Navigation
  const [activeWindowTab, setActiveWindowTab] = useState<'containers' | 'images' | 'compose'>('containers');

  // Search & Filter State
  const [containerSearchQuery, setContainerSearchQuery] = useState('');
  const [containerStatusFilter, setContainerStatusFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [imageSearchQuery, setImageSearchQuery]         = useState('');
  const [composeSearchQuery, setComposeSearchQuery]     = useState('');

  // Containers state
  const [containers, setContainers]           = useState<Container[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [refreshing, setRefreshing]           = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [actionLoading, setActionLoading]     = useState<string | null>(null);
  const [actionError, setActionError]         = useState<{ id: string; msg: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [lastSynced, setLastSynced]           = useState('');

  // Compose state
  const [composeProjects, setComposeProjects]         = useState<ComposeProject[]>([]);
  const [composeLoading, setComposeLoading]           = useState(false);
  const [composeError, setComposeError]               = useState<string | null>(null);

  // Deploy Compose Project Modal state
  const [showDeployModal, setShowDeployModal]         = useState(false);
  const [deployMode, setDeployMode]                   = useState<'form' | 'yaml'>('form');
  const [deployProjectName, setDeployProjectName]     = useState('');
  const [formServices, setFormServices]               = useState<FormService[]>([createDefaultService(1)]);
  const [showEnvPasswords, setShowEnvPasswords]       = useState<Record<string, boolean>>({});
  const [deployYaml, setDeployYaml]                   = useState(() => generateComposeYamlFromServices([createDefaultService(1)]));
  const [deploying, setDeploying]                     = useState(false);
  const [deployConsoleLogs, setDeployConsoleLogs]     = useState<string[]>([]);
  const [deployError, setDeployError]                 = useState<string | null>(null);
  const fileInputRef                                  = useRef<HTMLInputElement>(null);

  // In-App Compose Delete Confirmation Dialog state
  const [projectToDelete, setProjectToDelete]         = useState<string | null>(null);

  // Compose Logs Modal state
  const [selectedComposeLogsName, setSelectedComposeLogsName] = useState<string | null>(null);
  const [composeLogLines, setComposeLogLines]         = useState<string[]>([]);
  const [composeLogsLoading, setComposeLogsLoading]   = useState(false);

  // Selected container details pane
  const [selectedId, setSelectedId]           = useState<string | null>(null);
  const [activeTab, setActiveTab]             = useState<'stats' | 'inspect' | 'logs' | 'console'>('stats');
  const [consoleVisitedContainers, setConsoleVisitedContainers] = useState<Record<string, boolean>>({});
  const [consoleRetryVersions, setConsoleRetryVersions]         = useState<Record<string, number>>({});

  // Live stats telemetry state & rolling history
  const [statsData, setStatsData]             = useState<any | null>(null);
  const [statsLoading, setStatsLoading]       = useState(false);
  const [statsError, setStatsError]           = useState<string | null>(null);
  const [cpuHistory, setCpuHistory]           = useState<number[]>([]);
  const [memHistory, setMemHistory]           = useState<number[]>([]);

  // Inspect state
  const [inspectData, setInspectData]         = useState<any | null>(null);
  const [inspectLoading, setInspectLoading]   = useState(false);
  const [inspectError, setInspectError]       = useState<string | null>(null);
  const [inspectSearchQuery, setInspectSearchQuery] = useState('');
  const [jsonCopied, setJsonCopied]           = useState(false);

  // Live Logs state
  const [logLines, setLogLines]               = useState<LogLine[]>([]);
  const [logsLoading, setLogsLoading]         = useState(false);
  const [logsError, setLogsError]             = useState<string | null>(null);
  const [showTimestamps, setShowTimestamps]   = useState(true);
  const [isLogPaused, setIsLogPaused]         = useState(false);
  const [autoScroll, setAutoScroll]           = useState(true);
  const [logSearchQuery, setLogSearchQuery]   = useState('');

  // Refs for tracking pause status and buffering logs
  const isLogPausedRef = useRef(isLogPaused);
  const logBufferRef = useRef<LogLine[]>([]);
  const logsTerminalRef = useRef<HTMLDivElement>(null);

  // Images state
  const [images, setImages]                   = useState<DockerImage[]>([]);
  const [imagesLoading, setImagesLoading]     = useState(true);
  const [imagesError, setImagesError]         = useState<string | null>(null);
  const [imageInput, setImageInput]           = useState('');
  const [pullingImage, setPullingImage]       = useState<string | null>(null);
  const [pullLayers, setPullLayers]           = useState<{ [id: string]: PullLayer }>({});
  const [pullError, setPullError]             = useState<string | null>(null);
  const [pullSuccess, setPullSuccess]         = useState(false);
  const [imageActionLoading, setImageActionLoading] = useState<string | null>(null);
  const [imageActionError, setImageActionError]     = useState<{ id: string; msg: string } | null>(null);
  const [confirmDeleteImageId, setConfirmDeleteImageId] = useState<string | null>(null);
  const [pruningImages, setPruningImages]           = useState(false);
  const [pruneFeedback, setPruneFeedback]           = useState<{ message: string; isError?: boolean } | null>(null);

  // Suggested & local images for autocomplete
  const suggestedImages = useMemo(() => {
    const localTags: string[] = [];
    images.forEach((img) => {
      if (img.RepoTags && Array.isArray(img.RepoTags)) {
        img.RepoTags.forEach((t) => {
          if (t && t !== '<none>:<none>') localTags.push(t);
        });
      }
    });

    const set = new Set(localTags);
    const popularUncached = POPULAR_DOCKER_IMAGES.filter((img) => !set.has(img));

    return {
      local: localTags,
      popular: popularUncached,
    };
  }, [images]);

  // Run Container Modal state
  const [runModalImage, setRunModalImage]           = useState<string | null>(null);
  const [runContainerName, setRunContainerName]     = useState('');
  const [runPorts, setRunPorts]                     = useState<{ hostPort: string; containerPort: string }[]>([]);
  const [runEnvs, setRunEnvs]                       = useState<{ key: string; value: string }[]>([]);
  const [runVolumes, setRunVolumes]                 = useState<{ hostPath: string; containerPath: string }[]>([]);
  const [runRestartPolicy, setRunRestartPolicy]     = useState<string>('no');
  const [runSubmitting, setRunSubmitting]           = useState(false);
  const [runError, setRunError]                     = useState<string | null>(null);

  // Expose container state
  const [exposeModalContainer, setExposeModalContainer] = useState<Container | null>(null);
  const [exposeSubdomain, setExposeSubdomain]           = useState('');
  const [exposeLoading, setExposeLoading]               = useState(false);
  const [exposeError, setExposeError]                   = useState<string | null>(null);
  const [exposeSuccessUrl, setExposeSuccessUrl]         = useState<string | null>(null);

  /* ─── Handlers & Operations ─── */

  const handleExposeContainer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exposeModalContainer || !exposeSubdomain.trim()) return;
    setExposeLoading(true);
    setExposeError(null);
    setExposeSuccessUrl(null);
    try {
      const res = await fetch(`/api/docker/containers/${exposeModalContainer.Id}/expose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: exposeSubdomain.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExposeError(data.error || 'Failed to expose container');
        return;
      }
      setExposeSuccessUrl(data.url);
      fetchContainers(true);
    } catch (err: any) {
      setExposeError(err.message || 'Network error');
    } finally {
      setExposeLoading(false);
    }
  };

  const handleUnexposeContainer = async (container: Container) => {
    if (!container.exposedRule) return;
    setActionLoading(`${container.Id}-unexpose`);
    try {
      const res = await fetch(`/api/docker/containers/${container.Id}/unexpose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: container.exposedRule.subdomain }),
      });
      if (res.ok) {
        setContainers((prev) =>
          prev.map((c) => (c.Id === container.Id ? { ...c, exposedRule: null } : c))
        );
        setTimeout(() => {
          fetchContainers(true);
        }, 1500);
      }
    } catch (err) {
      console.error('Failed to unexpose container:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Sync log pause ref
  useEffect(() => {
    isLogPausedRef.current = isLogPaused;
    if (!isLogPaused && logBufferRef.current.length > 0) {
      setLogLines((prev) => [...prev, ...logBufferRef.current].slice(-1000));
      logBufferRef.current = [];
    }
  }, [isLogPaused]);

  // Parse Docker logs timestamp prefix
  const parseLogLine = (rawLine: string): LogLine => {
    const firstSpace = rawLine.indexOf(' ');
    if (firstSpace > 0) {
      const possibleTs = rawLine.substring(0, firstSpace);
      if (possibleTs.includes('T') && possibleTs.endsWith('Z')) {
        let localTimestamp = possibleTs;
        try {
          const date = new Date(possibleTs);
          if (!isNaN(date.getTime())) {
            localTimestamp = date.toLocaleTimeString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });
          }
        } catch (e) {
          console.error('[logs] Timestamp conversion failed', e);
        }
        return {
          timestamp: localTimestamp,
          text: rawLine.substring(firstSpace + 1)
        };
      }
    }
    return { timestamp: null, text: rawLine };
  };

  const containersRef = useRef<Container[]>([]);
  const consecutiveFailuresRef = useRef(0);
  useEffect(() => { containersRef.current = containers; }, [containers]);

  const fetchContainers = useCallback(async (silent = false) => {
    if (!silent && containersRef.current.length === 0) setLoading(true);
    setRefreshing(true);
    try {
      const res = await fetch('/api/docker/containers');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { containers: list } = await res.json();
      setContainers(list ?? []);
      setLastSynced(
        new Date().toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        })
      );
      consecutiveFailuresRef.current = 0;
      setError(null);
    } catch (e) {
      consecutiveFailuresRef.current += 1;
      if (containersRef.current.length === 0 || consecutiveFailuresRef.current >= 3) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchImages = useCallback(async (silent = false) => {
    if (!silent) setImagesLoading(true);
    try {
      const res = await fetch('/api/docker/images');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { images: list } = await res.json();
      setImages(list ?? []);
      setImagesError(null);
    } catch (e: any) {
      setImagesError(e.message);
    } finally {
      if (!silent) setImagesLoading(false);
    }
  }, []);

  const fetchCompose = useCallback(async (silent = false) => {
    if (!silent) setComposeLoading(true);
    try {
      const res = await fetch('/api/docker/compose');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setComposeProjects(data.compose ?? data.projects ?? data.stacks ?? []);
      setComposeError(null);
    } catch (e: any) {
      setComposeError(e.message || 'Failed to load compose projects');
    } finally {
      if (!silent) setComposeLoading(false);
    }
  }, []);

  const handleOpenComposeLogs = (name: string) => {
    setSelectedComposeLogsName(name);
  };

  const handleStartCompose = async (name: string) => {
    setActionLoading(`start-${name}`);
    try {
      const res = await fetch(`/api/docker/compose/${name}/start`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start compose project');
      }
      fetchCompose(true);
      fetchContainers(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStopCompose = async (name: string) => {
    setActionLoading(`stop-${name}`);
    try {
      const res = await fetch(`/api/docker/compose/${name}/stop`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to stop compose project');
      }
      fetchCompose(true);
      fetchContainers(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteCompose = (name: string) => {
    setProjectToDelete(name);
  };

  const confirmAndExecuteDeleteCompose = async (name: string) => {
    setActionLoading(`delete-${name}`);
    try {
      const res = await fetch(`/api/docker/compose/${name}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete compose project');
      }
      fetchCompose(true);
      fetchContainers(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
      setProjectToDelete(null);
    }
  };

  const openDeployModal = () => {
    const initialServices = [createDefaultService(1)];
    setDeployProjectName('');
    setFormServices(initialServices);
    setDeployMode('form');
    setDeployYaml(generateComposeYamlFromServices(initialServices));
    setDeployConsoleLogs([]);
    setDeployError(null);
    setShowDeployModal(true);
  };

  const handleAddService = () => {
    setFormServices((prev) => {
      const next = [...prev, createDefaultService(prev.length + 1)];
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleRemoveService = (serviceId: string) => {
    setFormServices((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((s) => s.id !== serviceId);
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleServiceChange = (serviceId: string, field: keyof FormService, value: any) => {
    setFormServices((prev) => {
      const next = prev.map((s) => (s.id === serviceId ? { ...s, [field]: value } : s));
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleAddPort = (serviceId: string) => {
    setFormServices((prev) => {
      const next = prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          ports: [...s.ports, { id: Math.random().toString(36).substring(2, 7), host: '', container: '' }],
        };
      });
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handlePortChange = (serviceId: string, portId: string, field: 'host' | 'container', val: string) => {
    setFormServices((prev) => {
      const next = prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          ports: s.ports.map((p) => (p.id === portId ? { ...p, [field]: val } : p)),
        };
      });
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleRemovePort = (serviceId: string, portId: string) => {
    setFormServices((prev) => {
      const next = prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          ports: s.ports.filter((p) => p.id !== portId),
        };
      });
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleAddEnv = (serviceId: string) => {
    setFormServices((prev) => {
      const next = prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          env: [...s.env, { id: Math.random().toString(36).substring(2, 7), key: '', value: '' }],
        };
      });
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleEnvChange = (serviceId: string, envId: string, field: 'key' | 'value', val: string) => {
    setFormServices((prev) => {
      const next = prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          env: s.env.map((e) => (e.id === envId ? { ...e, [field]: val } : e)),
        };
      });
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleGenerateEnvPassword = (serviceId: string, envId: string) => {
    const pass = generateRandomPassword(16);
    handleEnvChange(serviceId, envId, 'value', pass);
  };

  const handleRemoveEnv = (serviceId: string, envId: string) => {
    setFormServices((prev) => {
      const next = prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          env: s.env.filter((e) => e.id !== envId),
        };
      });
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleAddVolume = (serviceId: string) => {
    setFormServices((prev) => {
      const next = prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          volumes: [...s.volumes, { id: Math.random().toString(36).substring(2, 7), host: '', container: '' }],
        };
      });
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleVolumeChange = (serviceId: string, volumeId: string, field: 'host' | 'container', val: string) => {
    setFormServices((prev) => {
      const next = prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          volumes: s.volumes.map((v) => (v.id === volumeId ? { ...v, [field]: val } : v)),
        };
      });
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleRemoveVolume = (serviceId: string, volumeId: string) => {
    setFormServices((prev) => {
      const next = prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          volumes: s.volumes.filter((v) => v.id !== volumeId),
        };
      });
      setDeployYaml(generateComposeYamlFromServices(next));
      return next;
    });
  };

  const handleYamlFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setDeployYaml(content);
        const parsed = parseComposeYamlToServices(content, formServices);
        if (parsed.success && parsed.services) {
          setFormServices(parsed.services);
        }
        const baseName = file.name.replace(/\.(ya?ml)$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (baseName && !deployProjectName.trim()) {
          setDeployProjectName(baseName === 'docker-compose' ? 'custom-compose' : baseName);
        }
        setDeployMode('yaml');
        setDeployError(null);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleEditCompose = async (name: string) => {
    try {
      const res = await fetch(`/api/docker/compose/${name}`);
      if (res.ok) {
        const data = await res.json();
        const yamlContent = data.yaml || '';
        setDeployProjectName(name);
        setDeployYaml(yamlContent);
        const parsed = parseComposeYamlToServices(yamlContent);
        if (parsed.success && parsed.services) {
          setFormServices(parsed.services);
        }
        setDeployMode('yaml');
        setDeployConsoleLogs([]);
        setDeployError(null);
        setShowDeployModal(true);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `Failed to load Compose project '${name}'`);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const switchToFormView = () => {
    if (!deployYaml.trim()) {
      const initial = [createDefaultService(1)];
      setFormServices(initial);
      setDeployYaml(generateComposeYamlFromServices(initial));
      setDeployMode('form');
      setDeployError(null);
      return;
    }

    const parseResult = parseComposeYamlToServices(deployYaml, formServices);
    if (!parseResult.success || !parseResult.services) {
      setDeployError(parseResult.error || 'Failed to parse Compose YAML for Form View');
      return;
    }

    setFormServices(parseResult.services);
    setDeployMode('form');
    setDeployError(null);
  };

  const switchToYamlView = () => {
    const updatedYaml = generateComposeYamlFromServices(formServices);
    setDeployYaml(updatedYaml);
    setDeployMode('yaml');
    setDeployError(null);
  };

  // YAML Validation Check
  const yamlValidation = useMemo(() => {
    if (!deployYaml.trim()) return { valid: false, message: 'YAML cannot be empty' };
    if (deployYaml.includes('\t')) return { valid: false, message: 'Tabs are forbidden in YAML (use 2 spaces)' };
    const lines = deployYaml.split('\n');
    let hasServices = false;
    for (const l of lines) {
      if (l.trim().startsWith('services:')) hasServices = true;
    }
    if (!hasServices) return { valid: false, message: "Missing root 'services:' block" };
    return { valid: true, message: 'Valid compose syntax structure' };
  }, [deployYaml]);

  const handleDeploySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Ensure deployed YAML reflects current Form View state if submitting from Form View
    const yamlToDeploy = deployMode === 'form'
      ? generateComposeYamlFromServices(formServices)
      : deployYaml;

    if (!deployProjectName.trim() || !yamlToDeploy.trim()) {
      setDeployError('Project name and YAML content are required.');
      return;
    }

    if (deployMode === 'form' && yamlToDeploy !== deployYaml) {
      setDeployYaml(yamlToDeploy);
    }

    setDeploying(true);
    setDeployError(null);
    setDeployConsoleLogs(['Deploying compose project…']);

    try {
      const res = await fetch('/api/docker/compose/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: deployProjectName.trim(), yaml: yamlToDeploy }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Deployment failed');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response stream');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.text) {
                setDeployConsoleLogs((prev) => [...prev, payload.text]);
              }
              if (payload.status === 'success') {
                setDeployConsoleLogs((prev) => [...prev, '✓ Deployment finished successfully!']);
                fetchCompose(true);
                fetchContainers(true);
              } else if (payload.status === 'failed') {
                const reason = payload.error
                  ? payload.error
                  : payload.exitCode != null
                    ? `exit code ${payload.exitCode}`
                    : `process was killed (${payload.signal || 'unknown signal'}) before completing`;
                setDeployConsoleLogs((prev) => [...prev, `✗ ${reason}`]);
                setDeployError(`Deployment failed — ${reason}`);
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }
    } catch (err: any) {
      setDeployError(err.message || 'Deployment failed');
    } finally {
      setDeploying(false);
    }
  };

  // Compose Logs SSE effect
  useEffect(() => {
    if (!selectedComposeLogsName) {
      setComposeLogLines([]);
      setComposeLogsLoading(false);
      return;
    }
    setComposeLogsLoading(true);
    setComposeLogLines([]);
    const es = new EventSource(`/api/docker/compose/${selectedComposeLogsName}/logs`);

    es.onmessage = (event) => {
      setComposeLogsLoading(false);
      try {
        const data = JSON.parse(event.data);
        if (data.text) {
          setComposeLogLines((prev) => [...prev, data.text]);
        }
      } catch {
        setComposeLogLines((prev) => [...prev, event.data]);
      }
    };

    es.onerror = () => {
      setComposeLogsLoading(false);
    };

    return () => {
      es.close();
    };
  }, [selectedComposeLogsName]);

  // Polling loop
  useEffect(() => {
    fetchContainers();
    fetchImages();
    fetchCompose();
    const id = setInterval(() => {
      fetchContainers(true);
      fetchImages(true);
      fetchCompose(true);
    }, 5000);
    return () => clearInterval(id);
  }, [fetchContainers, fetchImages, fetchCompose]);

  // Tab auto-switch on selection
  useEffect(() => {
    if (!selectedId) {
      setStatsData(null);
      setCpuHistory([]);
      setMemHistory([]);
      setInspectData(null);
      setLogLines([]);
      return;
    }
    const container = containers.find((c) => c.Id === selectedId);
    if (container && container.State !== 'running') {
      setActiveTab('inspect');
    } else {
      setActiveTab('stats');
    }
  }, [selectedId, containers]);

  // Stream stats via SSE with rolling sparkline history
  useEffect(() => {
    if (!selectedId || activeTab !== 'stats') return;

    const initial = containersRef.current.find((c) => c.Id === selectedId);
    if (!initial || initial.State !== 'running') {
      setStatsData(null);
      setCpuHistory([]);
      setMemHistory([]);
      return;
    }

    setStatsLoading(true);
    setStatsError(null);

    const es = new EventSource(`/api/docker/containers/${selectedId}/stats`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setStatsData(data);
        setStatsError(null);
        setStatsLoading(false);

        const cpu = calculateCpuPercent(data);
        const mem = getMemoryUsage(data);

        setCpuHistory((prev) => [...prev, cpu].slice(-30));
        setMemHistory((prev) => [...prev, mem.percent].slice(-30));
      } catch (e) {
        console.error('[stats] JSON parse error', e);
      }
    };

    es.onerror = () => {
      setStatsError('Stats stream disconnected');
      setStatsLoading(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [selectedId, activeTab]);

  // Fetch inspect data
  useEffect(() => {
    if (!selectedId || activeTab !== 'inspect') return;

    let active = true;
    const fetchInspect = async () => {
      setInspectLoading(true);
      setInspectError(null);
      try {
        const res = await fetch(`/api/docker/containers/${selectedId}/inspect`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { data } = await res.json();
        if (active) {
          setInspectData(data);
        }
      } catch (err: any) {
        if (active) setInspectError(err.message);
      } finally {
        if (active) setInspectLoading(false);
      }
    };

    fetchInspect();
    return () => {
      active = false;
    };
  }, [selectedId, activeTab]);

  // Stream logs via SSE
  useEffect(() => {
    if (!selectedId || activeTab !== 'logs') return;

    setLogsLoading(true);
    setLogsError(null);
    setLogLines([]);
    logBufferRef.current = [];

    const es = new EventSource(`/api/docker/containers/${selectedId}/logs`);

    es.onmessage = (event) => {
      setLogsLoading(false);
      const chunk = event.data;
      if (!chunk) return;

      const newLines = chunk.split('\n');
      const parsed = newLines
        .filter((l: string) => l.trim() !== '')
        .map(parseLogLine);

      setLogLines((prev) => {
        if (isLogPausedRef.current) {
          logBufferRef.current = [...logBufferRef.current, ...parsed].slice(-1000);
          return prev;
        }
        return [...prev, ...parsed].slice(-1000);
      });
    };

    es.onerror = () => {
      setLogsError('Logs stream disconnected');
      setLogsLoading(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [selectedId, activeTab]);

  // Auto-scroll logs terminal to bottom
  useEffect(() => {
    if (logsTerminalRef.current && !isLogPaused && autoScroll) {
      logsTerminalRef.current.scrollTop = logsTerminalRef.current.scrollHeight;
    }
  }, [logLines, isLogPaused, autoScroll, activeTab]);

  const doAction = async (containerId: string, action: ActionKind) => {
    setActionLoading(`${containerId}-${action}`);
    setActionError(null);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/docker/containers/${containerId}/${action}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.error ?? `Action failed (${res.status})`;
        setActionError({ id: containerId, msg });
        setTimeout(() => setActionError(null), 3500);
        return;
      }
      await fetchContainers(true);
    } catch (e) {
      console.error('Docker action failed:', e);
    } finally {
      setActionLoading(null);
    }
  };

  /* ─── Image Pull & Prune Handlers ─── */

  const handlePullImage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageInput.trim()) return;

    const imageName = imageInput.trim();
    setPullingImage(imageName);
    setPullLayers({});
    setPullError(null);
    setPullSuccess(false);
    setImageInput('');

    const es = new EventSource(`/api/docker/images/pull?image=${encodeURIComponent(imageName)}`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.error) {
          setPullError(data.error);
          es.close();
          setTimeout(() => {
            setPullingImage(null);
            setPullError(null);
          }, 5000);
          return;
        }

        if (data.status === 'success') {
          setPullSuccess(true);
          es.close();
          fetchImages(true);
          setTimeout(() => {
            setPullingImage(null);
            setPullSuccess(false);
          }, 3000);
          return;
        }

        if (data.id) {
          setPullLayers((prev) => {
            const currentLayer = prev[data.id] || { id: data.id, status: '', progress: '', current: 0, total: 0 };
            return {
              ...prev,
              [data.id]: {
                ...currentLayer,
                status: data.status,
                progress: data.progress || '',
                current: data.progressDetail?.current || 0,
                total: data.progressDetail?.total || 0,
              },
            };
          });
        }
      } catch (err) {
        console.error('[pull] Parse error', err);
      }
    };

    es.onerror = () => {
      setPullError('Image pull failed or repository does not exist');
      es.close();
      setTimeout(() => {
        setPullingImage(null);
        setPullError(null);
      }, 5000);
    };
  };

  const deleteImage = async (imageId: string) => {
    setImageActionLoading(imageId);
    setImageActionError(null);
    setConfirmDeleteImageId(null);
    try {
      const res = await fetch(`/api/docker/images/${encodeURIComponent(imageId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.error ?? `Deletion failed (${res.status})`;
        setImageActionError({ id: imageId, msg });
        setTimeout(() => setImageActionError(null), 4000);
        return;
      }
      await fetchImages(true);
    } catch (e: any) {
      console.error('Delete image failed:', e);
    } finally {
      setImageActionLoading(null);
    }
  };

  const pruneImages = async () => {
    if (pruningImages) return;
    setPruningImages(true);
    setPruneFeedback(null);
    try {
      const res = await fetch('/api/docker/images/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        const data = await res.json();
        const count = data.deletedCount ?? 0;
        const space = data.spaceReclaimed ?? 0;
        if (count > 0) {
          setPruneFeedback({
            message: `Successfully pruned ${count} unused image${count !== 1 ? 's' : ''} (${formatBytes(space)} reclaimed)`,
            isError: false,
          });
        } else {
          setPruneFeedback({
            message: 'No unused images to prune. All images are currently in use.',
            isError: false,
          });
        }
        await fetchImages(true);
      } else {
        const errData = await res.json().catch(() => ({}));
        setPruneFeedback({
          message: errData.error || `Prune failed with status ${res.status}`,
          isError: true,
        });
      }
    } catch (e: any) {
      console.error('Prune images failed:', e);
      setPruneFeedback({
        message: e?.message || 'Failed to prune unused images',
        isError: true,
      });
    } finally {
      setPruningImages(false);
    }
  };

  /* ─── Run Container Modal Handlers ─── */

  const openRunModal = (repoTag: string) => {
    setRunModalImage(repoTag);
    setRunContainerName('');
    setRunPorts([{ hostPort: '', containerPort: '' }]);
    setRunEnvs([]);
    setRunVolumes([]);
    setRunRestartPolicy('no');
    setRunError(null);
  };

  const addPortRow = () => setRunPorts((prev) => [...prev, { hostPort: '', containerPort: '' }]);
  const removePortRow = (idx: number) => setRunPorts((prev) => prev.filter((_, i) => i !== idx));

  const addEnvRow = () => setRunEnvs((prev) => [...prev, { key: '', value: '' }]);
  const removeEnvRow = (idx: number) => setRunEnvs((prev) => prev.filter((_, i) => i !== idx));

  const addVolumeRow = () => setRunVolumes((prev) => [...prev, { hostPath: '', containerPath: '' }]);
  const removeVolumeRow = (idx: number) => setRunVolumes((prev) => prev.filter((_, i) => i !== idx));

  const handleCreateContainer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!runModalImage) return;

    setRunSubmitting(true);
    setRunError(null);

    const volumes = runVolumes.filter((v) => v.hostPath.trim() && v.containerPath.trim());
    if (net.baseDir) {
      const escaped = volumes.find((v) => {
        const h = v.hostPath.trim();
        if (h.includes('..')) return true;
        if (h.startsWith('/') && h !== net.baseDir && !h.startsWith(net.baseDir + '/')) return true;
        return false;
      });
      if (escaped) {
        setRunError(`Host path must be inside ${net.baseDir}`);
        setRunSubmitting(false);
        return;
      }
    }

    const payload = {
      image: runModalImage,
      name: runContainerName.trim() || undefined,
      ports: runPorts.filter((p) => p.hostPort.trim() && p.containerPort.trim()),
      env: runEnvs.filter((ev) => ev.key.trim()).map((ev) => `${ev.key.trim()}=${ev.value}`),
      volumes,
      restartPolicy: runRestartPolicy,
    };

    try {
      const res = await fetch('/api/docker/containers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to create container (${res.status})`);
      }

      setRunModalImage(null);
      setActiveWindowTab('containers');
      fetchContainers(true);
    } catch (err: any) {
      setRunError(err.message);
    } finally {
      setRunSubmitting(false);
    }
  };

  /* ─── Filtering & Selection Computations ─── */

  const runningCount = containers.filter((c) => c.State === 'running').length;
  const stoppedCount = containers.filter((c) => c.State === 'exited').length;

  const filteredContainers = useMemo(() => {
    return containers.filter((c) => {
      // Status filter
      if (containerStatusFilter === 'running' && c.State !== 'running') return false;
      if (containerStatusFilter === 'stopped' && c.State === 'running') return false;

      // Text search filter
      if (containerSearchQuery.trim()) {
        const q = containerSearchQuery.toLowerCase();
        const name = (c.Names[0] ?? '').toLowerCase();
        const image = (c.Image ?? '').toLowerCase();
        const id = c.Id.toLowerCase();
        return name.includes(q) || image.includes(q) || id.includes(q);
      }
      return true;
    });
  }, [containers, containerStatusFilter, containerSearchQuery]);

  const filteredImages = useMemo(() => {
    if (!imageSearchQuery.trim()) return images;
    const q = imageSearchQuery.toLowerCase();
    return images.filter((img) => {
      const tag = (img.RepoTags?.[0] ?? '').toLowerCase();
      const id = img.Id.toLowerCase();
      return tag.includes(q) || id.includes(q);
    });
  }, [images, imageSearchQuery]);

  const filteredComposeProjects = useMemo(() => {
    if (!composeSearchQuery.trim()) return composeProjects;
    const q = composeSearchQuery.toLowerCase();
    return composeProjects.filter((p) => p.name.toLowerCase().includes(q));
  }, [composeProjects, composeSearchQuery]);

  const selectedContainer = containers.find((c) => c.Id === selectedId);

  /* ─── Detail Panels Content Renderers ─── */

  const renderStatsContent = () => {
    if (selectedContainer?.State !== 'running') {
      return (
        <div className={styles.comingSoon}>
          <AlertCircle size={28} style={{ color: 'var(--text-muted, #737373)' }} />
          <span className={styles.comingSoonText}>
            Telemetry unavailable. Real-time stats are only available for running containers.
          </span>
        </div>
      );
    }

    if (statsLoading && !statsData) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px', gap: '10px' }}>
          <div className={styles.spinner} />
          <span style={{ fontSize: '11px', color: 'var(--text-muted, #737373)' }}>Querying container telemetry…</span>
        </div>
      );
    }

    if (statsError && !statsData) {
      return (
        <div className={styles.alertError}>
          <AlertCircle size={14} />
          <span>Error streaming stats: {statsError}</span>
        </div>
      );
    }

    if (!statsData) return null;

    const cpuPercent = calculateCpuPercent(statsData);
    const memInfo = getMemoryUsage(statsData);
    const netIO = getNetworkIO(statsData);
    const diskIO = getBlockIO(statsData);

    const cpuColor = cpuPercent > 85 ? '#ef4444' : cpuPercent > 60 ? '#facc15' : '#22c55e';
    const memColor = memInfo.percent > 85 ? '#ef4444' : memInfo.percent > 60 ? '#facc15' : '#ffffff';

    return (
      <>
        {/* CPU Card with Sparkline */}
        <div className={styles.statsCard}>
          <div className={styles.statsHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Cpu size={13} style={{ color: 'var(--text-secondary, #a1a1a1)' }} />
              <span>Processor (CPU)</span>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: cpuColor }}>
              {cpuPercent.toFixed(1)}%
            </span>
          </div>

          <div className={styles.statsMetricRow}>
            <div className={styles.statsVal}>{cpuPercent.toFixed(1)}%</div>
            <div className={styles.statsSubVal}>Rolling 30s trend</div>
          </div>

          <SparklineChart points={cpuHistory} height={42} strokeColor={cpuColor} fillGradientId="cpu-grad" />

          <div className={styles.statsProgress}>
            <div className={styles.statsProgressFill} style={{ width: `${cpuPercent}%`, background: cpuColor }} />
          </div>
        </div>

        {/* Memory Card with Sparkline */}
        <div className={styles.statsCard}>
          <div className={styles.statsHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <HardDrive size={13} style={{ color: 'var(--text-secondary, #a1a1a1)' }} />
              <span>Memory (RAM)</span>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: memColor }}>
              {memInfo.percent.toFixed(1)}%
            </span>
          </div>

          <div className={styles.statsMetricRow}>
            <div className={styles.statsVal}>{memInfo.percent.toFixed(1)}%</div>
            <div className={styles.statsSubVal}>
              {formatBytes(memInfo.usage)} / {formatBytes(memInfo.limit)}
            </div>
          </div>

          <SparklineChart points={memHistory} height={42} strokeColor={memColor} fillGradientId="mem-grad" />

          <div className={styles.statsProgress}>
            <div className={styles.statsProgressFill} style={{ width: `${memInfo.percent}%`, background: memColor }} />
          </div>
        </div>

        {/* Network & Disk I/O Cards */}
        <div className={styles.statsGrid}>
          <div className={styles.statsCard}>
            <div className={styles.statsHeader}>
              <span>Network I/O</span>
              <Activity size={12} style={{ color: 'var(--text-muted, #737373)' }} />
            </div>
            <div style={{ fontSize: '11px', color: '#ededed', fontFamily: 'var(--mono)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: '#22c55e' }}>▼</span> In: {formatBytes(netIO.rx)}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: '#3b82f6' }}>▲</span> Out: {formatBytes(netIO.tx)}
              </span>
            </div>
          </div>

          <div className={styles.statsCard}>
            <div className={styles.statsHeader}>
              <span>Disk I/O</span>
              <Sliders size={12} style={{ color: 'var(--text-muted, #737373)' }} />
            </div>
            <div style={{ fontSize: '11px', color: '#ededed', fontFamily: 'var(--mono)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span>Read: {formatBytes(diskIO.read)}</span>
              <span>Write: {formatBytes(diskIO.write)}</span>
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderInspectContent = () => {
    if (inspectLoading) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px', gap: '10px' }}>
          <div className={styles.spinner} />
          <span style={{ fontSize: '11px', color: 'var(--text-muted, #737373)' }}>Loading container metadata…</span>
        </div>
      );
    }

    if (inspectError) {
      return (
        <div className={styles.alertError}>
          <AlertCircle size={14} />
          <span>Error fetching metadata: {inspectError}</span>
        </div>
      );
    }

    if (!inspectData) return null;

    const envVars = inspectData.Config?.Env ?? [];
    const mounts = inspectData.Mounts ?? [];
    const gateway = inspectData.NetworkSettings?.Gateway || inspectData.NetworkSettings?.Networks?.bridge?.Gateway || '—';
    const ipAddress = inspectData.NetworkSettings?.IPAddress || inspectData.NetworkSettings?.Networks?.bridge?.IPAddress || '—';

    const handleCopyJson = () => {
      navigator.clipboard.writeText(JSON.stringify(inspectData, null, 2));
      setJsonCopied(true);
      setTimeout(() => setJsonCopied(false), 2000);
    };

    return (
      <>
        {/* Inspect Toolbar: Search + Copy + Expand/Collapse */}
        <div className={styles.inspectToolbar}>
          <input
            className={styles.inspectSearchInput}
            type="text"
            placeholder="Search JSON keys or values…"
            value={inspectSearchQuery}
            onChange={(e) => setInspectSearchQuery(e.target.value)}
          />
          <button className={styles.inspectActionBtn} onClick={handleCopyJson} title="Copy inspect JSON to clipboard">
            {jsonCopied ? <Check size={12} style={{ color: '#22c55e' }} /> : <Copy size={12} />}
            {jsonCopied ? 'Copied' : 'Copy JSON'}
          </button>
        </div>

        {/* System Configuration Overview Card */}
        <div className={styles.inspectGroup}>
          <span className={styles.inspectTitle}>System Configuration</span>
          <div className={styles.inspectCard}>
            <table className={styles.inspectTable}>
              <tbody>
                <tr className={styles.inspectTr}>
                  <td className={styles.inspectTdLabel}>Image ID</td>
                  <td className={styles.inspectTdValue}>{inspectData.Image?.replace('sha256:', '').substring(0, 12)}</td>
                </tr>
                <tr className={styles.inspectTr}>
                  <td className={styles.inspectTdLabel}>Path</td>
                  <td className={styles.inspectTdValue}>{inspectData.Path}</td>
                </tr>
                <tr className={styles.inspectTr}>
                  <td className={styles.inspectTdLabel}>Restart Policy</td>
                  <td className={styles.inspectTdValue}>{inspectData.HostConfig?.RestartPolicy?.Name || 'no'}</td>
                </tr>
                <tr className={styles.inspectTr}>
                  <td className={styles.inspectTdLabel}>IP Address</td>
                  <td className={styles.inspectTdValue}>{ipAddress}</td>
                </tr>
                <tr className={styles.inspectTr}>
                  <td className={styles.inspectTdLabel}>Gateway</td>
                  <td className={styles.inspectTdValue}>{gateway}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Volumes / Mounts Card */}
        {mounts.length > 0 && (
          <div className={styles.inspectGroup}>
            <span className={styles.inspectTitle}>Volume Mounts ({mounts.length})</span>
            {mounts.map((m: any, idx: number) => (
              <div key={idx} className={styles.inspectCard} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#737373' }}>
                  <span>{m.Type?.toUpperCase()}</span>
                  <span>{m.RW ? 'READ/WRITE' : 'READ-ONLY'}</span>
                </div>
                <div style={{ fontSize: '11px', color: '#ededed', wordBreak: 'break-all', fontFamily: 'var(--mono)' }}>
                  <span style={{ color: '#525252' }}>Host:</span> {m.Source}
                </div>
                <div style={{ fontSize: '11px', color: '#ededed', wordBreak: 'break-all', fontFamily: 'var(--mono)' }}>
                  <span style={{ color: '#525252' }}>Container:</span> {m.Destination}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Environment Variables Card */}
        {envVars.length > 0 && (
          <div className={styles.inspectGroup}>
            <span className={styles.inspectTitle}>Environment Variables ({envVars.length})</span>
            <div className={styles.inspectCard} style={{ maxHeight: '160px', overflowY: 'auto' }}>
              <table className={styles.inspectTable}>
                <tbody>
                  {envVars.map((env: string, idx: number) => {
                    const eqIndex = env.indexOf('=');
                    const k = eqIndex > -1 ? env.substring(0, eqIndex) : env;
                    const v = eqIndex > -1 ? env.substring(eqIndex + 1) : '';
                    return (
                      <tr key={idx} className={styles.inspectTr}>
                        <td className={styles.inspectTdLabel} style={{ width: '40%' }}>{k}</td>
                        <td className={styles.inspectTdValue} style={{ color: '#34d399' }}>{v}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Collapsible Interactive JSON Tree Inspector */}
        <div className={styles.inspectGroup}>
          <span className={styles.inspectTitle}>Raw JSON Inspection</span>
          <div className={styles.jsonTreeContainer}>
            <JsonTreeNode value={inspectData} searchQuery={inspectSearchQuery} defaultExpanded={false} />
          </div>
        </div>
      </>
    );
  };

  const renderLogsContent = () => {
    if (logsLoading && logLines.length === 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px', gap: '10px' }}>
          <div className={styles.spinner} />
          <span style={{ fontSize: '11px', color: 'var(--text-muted, #737373)' }}>Connecting to logs stream…</span>
        </div>
      );
    }

    if (logsError && logLines.length === 0) {
      return (
        <div className={styles.alertError}>
          <AlertCircle size={14} />
          <span>Error streaming logs: {logsError}</span>
        </div>
      );
    }

    const filteredLogLines = logSearchQuery.trim()
      ? logLines.filter((line) => line.text.toLowerCase().includes(logSearchQuery.toLowerCase()))
      : logLines;

    const highlightText = (text: string) => {
      if (!logSearchQuery.trim()) return <span>{text}</span>;
      const parts = text.split(new RegExp(`(${logSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
      return (
        <>
          {parts.map((part, i) =>
            part.toLowerCase() === logSearchQuery.toLowerCase() ? (
              <mark key={i} className={styles.logHighlight}>
                {part}
              </mark>
            ) : (
              <span key={i}>{part}</span>
            )
          )}
        </>
      );
    };

    return (
      <div className={styles.logsContainer}>
        {/* Logs controls toolbar */}
        <div className={styles.logsToolbar}>
          <div className={styles.logsToolbarLeft}>
            <input
              className={styles.logsSearchInput}
              type="text"
              placeholder="Search logs…"
              value={logSearchQuery}
              onChange={(e) => setLogSearchQuery(e.target.value)}
            />
            {logSearchQuery.trim() && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                {filteredLogLines.length} match{filteredLogLines.length !== 1 ? 'es' : ''}
              </span>
            )}
          </div>

          <div className={styles.logsToolbarRight}>
            <button
              className={`${styles.logsControlBtn} ${showTimestamps ? styles.logsControlBtnActive : ''}`}
              onClick={() => setShowTimestamps(!showTimestamps)}
              title="Toggle Timestamps"
            >
              Timestamps
            </button>
            <button
              className={`${styles.logsControlBtn} ${isLogPaused ? styles.logsControlBtnActive : ''}`}
              onClick={() => setIsLogPaused(!isLogPaused)}
              title={isLogPaused ? 'Resume live log stream' : 'Pause live log stream'}
            >
              {isLogPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button
              className={`${styles.logsControlBtn} ${autoScroll ? styles.logsControlBtnActive : ''}`}
              onClick={() => setAutoScroll(!autoScroll)}
              title={autoScroll ? 'Disable automatic scrolling' : 'Enable automatic scrolling to latest log line'}
            >
              {autoScroll ? '↓ Auto ON' : '↓ Auto OFF'}
            </button>
            <button
              className={styles.logsControlBtn}
              onClick={() => setLogLines([])}
              title="Clear current screen logs"
            >
              Clear
            </button>
            <a
              href={`/api/docker/containers/${selectedId}/logs/download`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.logsControlBtn}
              title="Download full container logs file"
            >
              <Download size={11} />
              Download
            </a>
          </div>
        </div>

        {/* Live log lines terminal */}
        <div className={styles.logsTerminal} ref={logsTerminalRef}>
          {filteredLogLines.length === 0 ? (
            <span style={{ color: '#525252', fontStyle: 'italic' }}>
              {logSearchQuery.trim() ? 'No log lines match your search filter.' : 'No logs generated yet.'}
            </span>
          ) : (
            filteredLogLines.map((line, idx) => (
              <div key={idx} className={styles.logsLine}>
                {showTimestamps && line.timestamp && (
                  <span className={styles.logsTimestamp}>[{line.timestamp}]</span>
                )}
                <span className={styles.logsText}>{highlightText(line.text)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  /* ── Loading Screen ── */
  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.spinner} />
        <span className={styles.loadingText}>Connecting to Docker daemon…</span>
      </div>
    );
  }

  /* ── Engine Error Screen ── */
  if (error) {
    return (
      <div className={styles.errorState}>
        <AlertCircle size={32} style={{ color: '#ef4444' }} />
        <p className={styles.errorTitle}>Docker Engine Unavailable</p>
        <span className={styles.errorCode}>{error}</span>
        <button className={styles.retryBtn} onClick={() => fetchContainers()}>
          Retry Connection
        </button>
      </div>
    );
  }

  /* ── Main App Layout ── */
  return (
    <div className={styles.container}>
      {/* ── Top Level App Navigation Header ── */}
      <div className={styles.tabHeader}>
        <div className={styles.tabNavGroup}>
          <button
            className={`${styles.tabBtn} ${activeWindowTab === 'containers' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveWindowTab('containers')}
          >
            <Box size={13} />
            <span>Containers</span>
            <span className={styles.tabCountBadge}>{containers.length}</span>
          </button>
          <button
            className={`${styles.tabBtn} ${activeWindowTab === 'images' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              setActiveWindowTab('images');
              fetchImages(true);
            }}
          >
            <HardDrive size={13} />
            <span>Images</span>
            <span className={styles.tabCountBadge}>{images.length}</span>
          </button>
          <button
            className={`${styles.tabBtn} ${activeWindowTab === 'compose' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              setActiveWindowTab('compose');
              fetchCompose(true);
            }}
          >
            <Layers size={13} />
            <span>Compose</span>
            <span className={styles.tabCountBadge}>{composeProjects.length}</span>
          </button>
        </div>

        {/* Global Action Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className={styles.refreshBtn}
            onClick={() => {
              if (activeWindowTab === 'containers') fetchContainers(true);
              else if (activeWindowTab === 'images') fetchImages(true);
              else if (activeWindowTab === 'compose') fetchCompose(true);
            }}
            disabled={refreshing || imagesLoading || composeLoading}
            title="Refresh current view"
          >
            <RefreshCw size={11} className={refreshing ? styles.spinning : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ───── CONTAINERS VIEW ───── */}
      {activeWindowTab === 'containers' && (
        <>
          {/* Action Bar with Search & Filter Pills */}
          <div className={styles.actionBar}>
            <div className={styles.actionLeft}>
              <div className={styles.searchWrapper}>
                <Search size={13} className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  type="text"
                  placeholder="Search containers by name, image, ID…"
                  value={containerSearchQuery}
                  onChange={(e) => setContainerSearchQuery(e.target.value)}
                />
                {containerSearchQuery && (
                  <button
                    className={styles.searchClearBtn}
                    onClick={() => setContainerSearchQuery('')}
                    title="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <div className={styles.filterPills}>
                <button
                  className={`${styles.filterPill} ${containerStatusFilter === 'all' ? styles.filterPillActive : ''}`}
                  onClick={() => setContainerStatusFilter('all')}
                >
                  All ({containers.length})
                </button>
                <button
                  className={`${styles.filterPill} ${containerStatusFilter === 'running' ? styles.filterPillActive : ''}`}
                  onClick={() => setContainerStatusFilter('running')}
                >
                  <span className={styles.liveDot} />
                  Running ({runningCount})
                </button>
                <button
                  className={`${styles.filterPill} ${containerStatusFilter === 'stopped' ? styles.filterPillActive : ''}`}
                  onClick={() => setContainerStatusFilter('stopped')}
                >
                  <span className={styles.liveDotStopped} />
                  Stopped ({stoppedCount})
                </button>
              </div>
            </div>

            <div className={styles.actionRight}>
              <div className={styles.healthSummary}>
                <span className={runningCount > 0 ? styles.liveDot : styles.liveDotStopped} />
                <span>{runningCount} running · {stoppedCount} stopped</span>
              </div>
            </div>
          </div>

          {/* Workspace Area: Table + Sliding Detail Drawer */}
          <div className={styles.workspace}>
            <div className={styles.tableArea}>
              {filteredContainers.length === 0 ? (
                <div className={styles.emptyState}>
                  <Box size={32} style={{ opacity: 0.15 }} />
                  <p className={styles.emptyTitle}>
                    {containerSearchQuery || containerStatusFilter !== 'all'
                      ? 'No containers match your filter'
                      : 'No containers running'}
                  </p>
                  <p className={styles.emptySubtext}>
                    {containerSearchQuery || containerStatusFilter !== 'all'
                      ? 'Try adjusting your search query or status filter'
                      : 'Containers you run will appear here automatically'}
                  </p>
                </div>
              ) : (
                <>
                  <table className={styles.table}>
                  <thead className={styles.thead}>
                    <tr className={styles.theadRow}>
                      <th className={styles.th} style={{ width: '32px' }}></th>
                      <th className={styles.th}>Container</th>
                      <th className={styles.th}>Image</th>
                      <th className={styles.th}>Status</th>
                      <th className={styles.th}>Ports</th>
                      <th className={styles.th}>Age</th>
                      <th className={styles.th} style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContainers.map((c) => {
                      const name = (c.Names[0] ?? c.Id).replace(/^\//, '');
                      const shortId = c.Id.substring(0, 12);
                      const isRunning = c.State === 'running';
                      const busy = (suf: string) => actionLoading === `${c.Id}-${suf}`;
                      const anyBusy = ['start', 'stop', 'restart', 'delete'].some(busy);
                      const isConfirm = confirmDeleteId === c.Id;
                      const isSelected = selectedId === c.Id;

                      return (
                        <tr
                          key={c.Id}
                          className={`${styles.tr} ${isConfirm ? styles.trConfirm : ''} ${isSelected ? styles.trSelected : ''}`}
                          onClick={() => setSelectedId(c.Id)}
                          style={{ cursor: 'pointer' }}
                        >
                          {/* Status dot */}
                          <td className={styles.td} style={{ paddingRight: 0 }}>
                            <span className={styles.containerDot} style={{ background: getDotColor(c.State) }} />
                          </td>

                          {/* Name + Subdomain / LAN Badges */}
                          <td className={styles.td}>
                            <div className={styles.nameInfo}>
                              <div className={styles.nameRow}>
                                <span className={styles.nameText}>{name}</span>

                                {c.exposedRule && (
                                  <a
                                    href={c.exposedRule.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.exposedBadge}
                                    title={`Public Cloudflare URL: ${c.exposedRule.url}`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Globe size={9} />
                                    <span>{c.exposedRule.subdomain}</span>
                                    <ExternalLink size={8} />
                                  </a>
                                )}

                                {net.serverLocalIp && c.Ports && c.Ports.some((p) => p.PublicPort) && (
                                  <a
                                    href={`http://${net.serverLocalIp}:${c.Ports.find((p) => p.PublicPort)?.PublicPort}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.exposedBadge}
                                    style={{ color: '#22c55e', borderColor: 'rgba(34, 197, 94, 0.25)' }}
                                    title={`Direct Local LAN URL: http://${net.serverLocalIp}:${c.Ports.find((p) => p.PublicPort)?.PublicPort}`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Zap size={9} fill="currentColor" />
                                    <span>LAN:{c.Ports.find((p) => p.PublicPort)?.PublicPort}</span>
                                    <ExternalLink size={8} />
                                  </a>
                                )}
                              </div>
                              <span className={styles.idText}>{shortId}</span>
                            </div>
                          </td>

                          {/* Image */}
                          <td className={styles.td}>
                            <span className={styles.imageBadge}>{c.Image}</span>
                          </td>

                          {/* Status */}
                          <td className={styles.td}>
                            <span className={`${styles.statusBadge} ${getStatusClass(c.State)}`}>
                              {c.Status}
                            </span>
                          </td>

                          {/* Ports with direct one-click links */}
                          <td className={styles.td}>
                            {c.Ports && c.Ports.length > 0 ? (
                              <div className={styles.portLinkGroup}>
                                {c.Ports.map((p, pIdx) => {
                                  if (p.PublicPort && net.serverLocalIp) {
                                    return (
                                      <a
                                        key={pIdx}
                                        href={`http://${net.serverLocalIp}:${p.PublicPort}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={styles.portLink}
                                        title={`Open http://${net.serverLocalIp}:${p.PublicPort}`}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <span>{p.PublicPort}→{p.PrivatePort}</span>
                                        <ExternalLink size={8} />
                                      </a>
                                    );
                                  }
                                  return (
                                    <span key={pIdx} className={styles.mono}>
                                      {p.PublicPort ? `${p.PublicPort}→${p.PrivatePort}` : `${p.PrivatePort}`}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className={styles.mono}>—</span>
                            )}
                          </td>

                          {/* Created Time */}
                          <td className={styles.td}>
                            <span className={styles.dimText}>{formatAge(c.Created)}</span>
                          </td>

                          {/* Quick Actions */}
                          <td className={styles.td} onClick={(e) => e.stopPropagation()}>
                            {isConfirm ? (
                              <div className={styles.deleteConfirm} style={{ justifyContent: 'flex-end' }}>
                                <span className={styles.deleteConfirmText}>Delete?</span>
                                <button className={styles.confirmBtn} onClick={() => doAction(c.Id, 'delete')}>
                                  Yes
                                </button>
                                <button className={styles.cancelBtn} onClick={() => setConfirmDeleteId(null)}>
                                  No
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                <div className={styles.actionsCell}>
                                  {isRunning ? (
                                    <>
                                      <button
                                        className={`${styles.actionBtn} ${styles.btnStop}`}
                                        title="Stop container"
                                        disabled={anyBusy}
                                        onClick={() => doAction(c.Id, 'stop')}
                                      >
                                        <Square size={11} fill="currentColor" />
                                      </button>
                                      <button
                                        className={`${styles.actionBtn} ${styles.btnRestart}`}
                                        title="Restart container"
                                        disabled={anyBusy}
                                        onClick={() => doAction(c.Id, 'restart')}
                                      >
                                        <RefreshCw size={11} />
                                      </button>
                                      <button
                                        className={`${styles.actionBtn} ${styles.btnNav}`}
                                        title="Open interactive shell console"
                                        onClick={() => {
                                          setSelectedId(c.Id);
                                          setActiveTab('console');
                                        }}
                                      >
                                        <Terminal size={11} />
                                      </button>
                                      <button
                                        className={`${styles.actionBtn} ${styles.btnNav}`}
                                        title="View live container logs"
                                        onClick={() => {
                                          setSelectedId(c.Id);
                                          setActiveTab('logs');
                                        }}
                                      >
                                        <FileText size={11} />
                                      </button>
                                      {c.exposedRule ? (
                                        <button
                                          className={`${styles.actionBtn} ${styles.btnUnexpose}`}
                                          title={`Unexpose ${c.exposedRule.url}`}
                                          disabled={anyBusy}
                                          onClick={() => handleUnexposeContainer(c)}
                                        >
                                          <GlobeLock size={11} />
                                        </button>
                                      ) : (
                                        <button
                                          className={`${styles.actionBtn} ${styles.btnExpose}`}
                                          title="Expose container via Cloudflare Tunnel"
                                          disabled={anyBusy}
                                          onClick={() => {
                                            const rawName = (c.Names[0] ?? c.Id)
                                              .replace(/^\//, '')
                                              .toLowerCase()
                                              .replace(/[^a-z0-9-]/g, '-');
                                            setExposeModalContainer(c);
                                            setExposeSubdomain(rawName);
                                            setExposeError(null);
                                            setExposeSuccessUrl(null);
                                          }}
                                        >
                                          <Globe size={11} />
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        className={`${styles.actionBtn} ${styles.btnStart}`}
                                        title="Start container"
                                        disabled={anyBusy}
                                        onClick={() => doAction(c.Id, 'start')}
                                      >
                                        <Play size={11} fill="currentColor" />
                                      </button>
                                      <button
                                        className={`${styles.actionBtn} ${styles.btnNav}`}
                                        title="View container logs"
                                        onClick={() => {
                                          setSelectedId(c.Id);
                                          setActiveTab('logs');
                                        }}
                                      >
                                        <FileText size={11} />
                                      </button>
                                    </>
                                  )}

                                  <button
                                    className={`${styles.actionBtn} ${styles.btnDelete}`}
                                    title="Delete container"
                                    disabled={anyBusy}
                                    onClick={() => setConfirmDeleteId(c.Id)}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>

                                {actionError?.id === c.Id && (
                                  <span style={{ fontSize: '9.5px', color: '#f87171', whiteSpace: 'nowrap' }}>
                                    ⚠ {actionError.msg}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Mobile Responsive Container Cards (< 768px) */}
                <div className={styles.mobileCardsContainer}>
                  {filteredContainers.map((c) => {
                    const name = (c.Names[0] ?? c.Id).replace(/^\//, '');
                    const shortId = c.Id.substring(0, 12);
                    const isRunning = c.State === 'running';
                    const busy = (suf: string) => actionLoading === `${c.Id}-${suf}`;
                    const anyBusy = ['start', 'stop', 'restart', 'delete'].some(busy);
                    const isConfirm = confirmDeleteId === c.Id;
                    const isSelected = selectedId === c.Id;

                    return (
                      <div
                        key={c.Id}
                        className={`${styles.mobileCard} ${isSelected ? styles.mobileCardSelected : ''}`}
                        onClick={() => setSelectedId(c.Id)}
                      >
                        <div className={styles.mobileCardHeader}>
                          <div className={styles.mobileCardTitleGroup}>
                            <span className={styles.containerDot} style={{ background: getDotColor(c.State) }} />
                            <span className={styles.mobileCardName}>{name}</span>
                          </div>
                          <span className={`${styles.statusBadge} ${getStatusClass(c.State)}`}>
                            {c.Status}
                          </span>
                        </div>

                        <div className={styles.mobileCardBadges}>
                          <span className={styles.imageBadge}>{c.Image}</span>
                          {c.exposedRule && (
                            <a
                              href={c.exposedRule.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.exposedBadge}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Globe size={9} />
                              <span>{c.exposedRule.subdomain}</span>
                              <ExternalLink size={8} />
                            </a>
                          )}
                          {net.serverLocalIp && c.Ports && c.Ports.some((p) => p.PublicPort) && (
                            <a
                              href={`http://${net.serverLocalIp}:${c.Ports.find((p) => p.PublicPort)?.PublicPort}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.exposedBadge}
                              style={{ color: '#22c55e', borderColor: 'rgba(34, 197, 94, 0.25)' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Zap size={9} fill="currentColor" />
                              <span>LAN:{c.Ports.find((p) => p.PublicPort)?.PublicPort}</span>
                              <ExternalLink size={8} />
                            </a>
                          )}
                        </div>

                        <div className={styles.mobileCardMeta}>
                          <div className={styles.mobileCardMetaRow}>
                            <span className={styles.dimText}>ID: {shortId}</span>
                            <span className={styles.dimText}>{formatAge(c.Created)}</span>
                          </div>
                        </div>

                        {/* Quick Action Buttons */}
                        <div className={styles.mobileCardActions} onClick={(e) => e.stopPropagation()}>
                          {isConfirm ? (
                            <div className={styles.deleteConfirm} style={{ width: '100%', justifyContent: 'space-between' }}>
                              <span className={styles.deleteConfirmText}>Confirm delete?</span>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button className={styles.confirmBtn} onClick={() => doAction(c.Id, 'delete')}>
                                  Yes
                                </button>
                                <button className={styles.cancelBtn} onClick={() => setConfirmDeleteId(null)}>
                                  No
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {isRunning ? (
                                <>
                                  <button
                                    type="button"
                                    className={`${styles.mobileActionBtn} ${styles.mobileActionBtnDanger}`}
                                    disabled={anyBusy}
                                    onClick={() => doAction(c.Id, 'stop')}
                                  >
                                    <Square size={12} fill="currentColor" />
                                    <span>Stop</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.mobileActionBtn}
                                    disabled={anyBusy}
                                    onClick={() => doAction(c.Id, 'restart')}
                                  >
                                    <RefreshCw size={12} />
                                    <span>Restart</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.mobileActionBtn}
                                    onClick={() => {
                                      setSelectedId(c.Id);
                                      setActiveTab('console');
                                    }}
                                  >
                                    <Terminal size={12} />
                                    <span>Shell</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.mobileActionBtn}
                                    onClick={() => {
                                      setSelectedId(c.Id);
                                      setActiveTab('logs');
                                    }}
                                  >
                                    <FileText size={12} />
                                    <span>Logs</span>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className={`${styles.mobileActionBtn} ${styles.mobileActionBtnPrimary}`}
                                    disabled={anyBusy}
                                    onClick={() => doAction(c.Id, 'start')}
                                  >
                                    <Play size={12} fill="currentColor" />
                                    <span>Start</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.mobileActionBtn}
                                    onClick={() => {
                                      setSelectedId(c.Id);
                                      setActiveTab('logs');
                                    }}
                                  >
                                    <FileText size={12} />
                                    <span>Logs</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.mobileActionBtn} ${styles.mobileActionBtnDanger}`}
                                    disabled={anyBusy}
                                    onClick={() => setConfirmDeleteId(c.Id)}
                                  >
                                    <Trash2 size={12} />
                                    <span>Delete</span>
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            </div>

            {/* ─── Sliding Detail Drawer ─── */}
            {selectedId && selectedContainer && (
              <div className={styles.detailPane}>
                {/* Detail Header */}
                <div className={styles.detailHeader}>
                  <div className={styles.detailHeaderLeft}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={styles.containerDot} style={{ background: getDotColor(selectedContainer.State) }} />
                      <span className={styles.detailHeaderTitle} title={selectedContainer.Names[0]?.replace(/^\//, '')}>
                        {selectedContainer.Names[0]?.replace(/^\//, '')}
                      </span>
                    </div>
                    <div className={styles.detailHeaderSub}>
                      <span>{selectedContainer.Id.substring(0, 12)}</span>
                      <span>·</span>
                      <span>{selectedContainer.Image}</span>
                    </div>
                  </div>

                  <button className={styles.detailCloseBtn} onClick={() => setSelectedId(null)} title="Close detail drawer">
                    <X size={14} />
                  </button>
                </div>

                {/* Sub-Tab Navigation Bar */}
                <div className={styles.detailTabs}>
                  <button
                    className={`${styles.detailTab} ${activeTab === 'stats' ? styles.detailTabActive : ''}`}
                    onClick={() => setActiveTab('stats')}
                  >
                    Stats
                  </button>
                  <button
                    className={`${styles.detailTab} ${activeTab === 'inspect' ? styles.detailTabActive : ''}`}
                    onClick={() => setActiveTab('inspect')}
                  >
                    Inspect
                  </button>
                  <button
                    className={`${styles.detailTab} ${activeTab === 'logs' ? styles.detailTabActive : ''}`}
                    onClick={() => setActiveTab('logs')}
                  >
                    Logs
                  </button>
                  <button
                    className={`${styles.detailTab} ${activeTab === 'console' ? styles.detailTabActive : ''}`}
                    onClick={() => {
                      setActiveTab('console');
                      if (selectedContainer) {
                        setConsoleVisitedContainers(prev => ({ ...prev, [selectedContainer.Id]: true }));
                      }
                    }}
                  >
                    Console
                  </button>
                </div>

                {/* Sub-Tab Content Area */}
                <div className={styles.detailContent}>
                  {activeTab === 'stats' && renderStatsContent()}
                  {activeTab === 'inspect' && renderInspectContent()}
                  {activeTab === 'logs' && renderLogsContent()}

                  {/* Console Tab: Persistent Mount once opened to Maintain WebSocket Connection */}
                  {(activeTab === 'console' || !!consoleVisitedContainers[selectedContainer.Id]) && (
                    <div style={{ display: activeTab === 'console' ? 'flex' : 'none', height: '100%', width: '100%' }}>
                      <WindowErrorBoundary
                        key={`${selectedContainer.Id}@${consoleRetryVersions[selectedContainer.Id] ?? 0}`}
                        label={`${selectedContainer.Names[0]?.replace(/^\//, '') ?? 'Container'} Console`}
                        onRetry={() =>
                          setConsoleRetryVersions(prev => ({
                            ...prev,
                            [selectedContainer.Id]: (prev[selectedContainer.Id] ?? 0) + 1,
                          }))
                        }
                      >
                        <Suspense fallback={<WindowSkeleton type="terminal" />}>
                          {createElement(
                            getLazyWindowApp(
                              'docker-console',
                              consoleRetryVersions[selectedContainer.Id] ?? 0
                            ),
                            {
                              key: selectedContainer.Id,
                              containerId: selectedContainer.Id,
                              containerName: selectedContainer.Names[0]?.replace(/^\//, '') ?? selectedContainer.Id,
                              isRunning: selectedContainer.State === 'running',
                            }
                          )}
                        </Suspense>
                      </WindowErrorBoundary>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Status Bar */}
          <div className={styles.statusBar}>
            <span>{containers.length} container{containers.length !== 1 ? 's' : ''} ({runningCount} active)</span>
            {lastSynced && <span>Last synced {lastSynced}</span>}
          </div>
        </>
      )}

      {/* ───── IMAGES VIEW ───── */}
      {activeWindowTab === 'images' && (
        <>
          {/* Action Bar */}
          <div className={styles.actionBar}>
            <div className={styles.actionLeft}>
              <div className={styles.searchWrapper}>
                <Search size={13} className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  type="text"
                  placeholder="Search local images by name or tag…"
                  value={imageSearchQuery}
                  onChange={(e) => setImageSearchQuery(e.target.value)}
                />
                {imageSearchQuery && (
                  <button className={styles.searchClearBtn} onClick={() => setImageSearchQuery('')}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className={styles.actionRight}>
              <form className={styles.pullForm} onSubmit={handlePullImage}>
                <input
                  className={styles.pullInput}
                  type="text"
                  value={imageInput}
                  onChange={(e) => setImageInput(e.target.value)}
                  placeholder="Pull image (e.g. redis:alpine, postgres:15)"
                  disabled={!!pullingImage}
                  autoComplete="off"
                />
                <button className={styles.pullBtn} type="submit" disabled={!!pullingImage || !imageInput.trim() || pruningImages}>
                  {pullingImage ? 'Pulling…' : 'Pull Image'}
                </button>
              </form>
              <button
                className={styles.btnSecondary}
                onClick={pruneImages}
                disabled={refreshing || !!pullingImage || pruningImages}
                title="Remove unused Docker images not attached to any container"
              >
                {pruningImages ? (
                  <>
                    <RefreshCw size={11} className={styles.spin} />
                    <span>Pruning…</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={11} />
                    <span>Prune</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Prune Status Feedback Banner */}
          {pruneFeedback && (
            <div
              className={pruneFeedback.isError ? styles.alertError : styles.alertSuccess}
              style={{ margin: '8px 16px 0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {pruneFeedback.isError ? <AlertCircle size={13} /> : <CheckCircle2 size={13} style={{ color: '#22c55e' }} />}
                <span>{pruneFeedback.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setPruneFeedback(null)}
                style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', padding: '2px' }}
                title="Dismiss message"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Real-time Pull Progress Card */}
          {pullingImage && (
            <div className={styles.pullProgressCard}>
              <div className={styles.pullProgressTitle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div className={styles.spinner} style={{ width: '12px', height: '12px', borderWidth: '1.5px' }} />
                  <span>Downloading {pullingImage}</span>
                </div>
                {pullSuccess && <span style={{ color: '#22c55e' }}>✓ Pull Complete</span>}
                {pullError && <span style={{ color: '#ef4444' }}>✗ Pull Failed</span>}
              </div>

              {pullError && (
                <div className={styles.alertError}>
                  <span>⚠ {pullError}</span>
                </div>
              )}

              {Object.keys(pullLayers).length === 0 && !pullError && !pullSuccess && (
                <span style={{ fontSize: '11px', color: '#737373', fontFamily: 'var(--mono)' }}>
                  Contacting Docker registry index…
                </span>
              )}

              <div className={styles.pullProgressLayers}>
                {Object.values(pullLayers).map((layer) => {
                  const pct = layer.total > 0 ? (layer.current / layer.total) * 100 : 0;
                  return (
                    <div key={layer.id} className={styles.pullProgressLayer}>
                      <div className={styles.pullProgressLayerHeader}>
                        <span>{layer.id}</span>
                        <span>{layer.status} {layer.progress && `(${layer.progress})`}</span>
                      </div>
                      {layer.total > 0 && (
                        <div className={styles.pullProgressLayerBar}>
                          <div className={styles.pullProgressLayerBarFill} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Images Table */}
          <div className={styles.tableWrapper}>
            {imagesLoading && images.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px', gap: '10px' }}>
                <div className={styles.spinner} />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loading local image catalog…</span>
              </div>
            ) : imagesError ? (
              <div className={styles.alertError} style={{ margin: '16px' }}>
                <AlertCircle size={14} />
                <span>Error listing images: {imagesError}</span>
              </div>
            ) : filteredImages.length === 0 ? (
              <div className={styles.emptyState}>
                <HardDrive size={32} style={{ opacity: 0.15 }} />
                <p className={styles.emptyTitle}>No Docker images found</p>
                <p className={styles.emptySubtext}>Pulled images will appear here. Pull an image above to get started!</p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead className={styles.thead}>
                  <tr className={styles.theadRow}>
                    <th className={styles.th}>Repository / Name</th>
                    <th className={styles.th}>Tag</th>
                    <th className={styles.th}>Image ID</th>
                    <th className={styles.th}>Size</th>
                    <th className={styles.th}>Created</th>
                    <th className={styles.th} style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredImages.map((img) => {
                    const idShort = img.Id.replace('sha256:', '').substring(0, 12);
                    const tagString = img.RepoTags?.[0] ?? '<none>:<none>';
                    const separatorIndex = tagString.lastIndexOf(':');
                    const repoName = separatorIndex > -1 ? tagString.substring(0, separatorIndex) : tagString;
                    const tag = separatorIndex > -1 ? tagString.substring(separatorIndex + 1) : '';

                    const isDangling = repoName === '<none>';
                    const isBusy = imageActionLoading === img.Id;
                    const isConfirm = confirmDeleteImageId === img.Id;

                    return (
                      <tr key={img.Id} className={styles.tr}>
                        <td className={styles.td}>
                          <span style={{
                            color: isDangling ? '#737373' : '#ffffff',
                            fontWeight: isDangling ? 'normal' : 600,
                            fontFamily: isDangling ? 'inherit' : 'var(--mono)',
                            fontSize: '12px'
                          }}>
                            {repoName}
                          </span>
                        </td>

                        <td className={styles.td}>
                          <span className={styles.imageBadge}>{tag || '<none>'}</span>
                        </td>

                        <td className={styles.td}>
                          <span className={styles.mono}>{idShort}</span>
                        </td>

                        <td className={styles.td}>
                          <span className={styles.dimText}>{formatBytes(img.Size)}</span>
                        </td>

                        <td className={styles.td}>
                          <span className={styles.dimText}>{formatAge(img.Created)}</span>
                        </td>

                        <td className={styles.td}>
                          {isConfirm ? (
                            <div className={styles.deleteConfirm} style={{ justifyContent: 'flex-end' }}>
                              <span className={styles.deleteConfirmText}>Delete?</span>
                              <button className={styles.confirmBtn} onClick={() => deleteImage(img.Id)}>
                                Yes
                              </button>
                              <button className={styles.cancelBtn} onClick={() => setConfirmDeleteImageId(null)}>
                                No
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                              <div className={styles.actionsCell}>
                                <button
                                  className={`${styles.actionBtn} ${styles.btnStart}`}
                                  title="Run container from image"
                                  disabled={isDangling || isBusy || !!pullingImage}
                                  onClick={() => openRunModal(tagString)}
                                >
                                  <Play size={11} fill="currentColor" />
                                </button>
                                <button
                                  className={`${styles.actionBtn} ${styles.btnDelete}`}
                                  title="Delete image"
                                  disabled={isBusy || !!pullingImage}
                                  onClick={() => setConfirmDeleteImageId(img.Id)}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                              {imageActionError?.id === img.Id && (
                                <span style={{ fontSize: '9.5px', color: '#f87171', whiteSpace: 'nowrap' }}>
                                  ⚠ {imageActionError.msg}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Status Bar */}
          <div className={styles.statusBar}>
            <span>{images.length} image{images.length !== 1 ? 's' : ''}</span>
            <span>Total size: {formatBytes(images.reduce((acc, img) => acc + img.Size, 0))}</span>
          </div>
        </>
      )}

      {/* ───── COMPOSE VIEW ───── */}
      {activeWindowTab === 'compose' && (
        <>
          {/* Action Bar */}
          <div className={styles.actionBar}>
            <div className={styles.actionLeft}>
              <div className={styles.searchWrapper}>
                <Search size={13} className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  type="text"
                  placeholder="Search compose projects by name…"
                  value={composeSearchQuery}
                  onChange={(e) => setComposeSearchQuery(e.target.value)}
                />
                {composeSearchQuery && (
                  <button className={styles.searchClearBtn} onClick={() => setComposeSearchQuery('')}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className={styles.actionRight}>
              <div className={styles.healthSummary}>
                <span className={styles.liveDot} />
                <span>{composeProjects.filter((p) => p.status === 'running').length} active compose projects</span>
              </div>
              <button
                className={styles.btnPrimary}
                onClick={openDeployModal}
                title="Deploy a new multi-container compose project"
              >
                <Plus size={12} /> Deploy Compose
              </button>
            </div>
          </div>

          <div className={styles.composeContainer}>
            {composeError && (
              <div className={styles.alertError} style={{ marginBottom: '12px' }}>
                <AlertCircle size={14} />
                <span>{composeError}</span>
              </div>
            )}

            {composeLoading && composeProjects.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px', gap: '10px' }}>
                <div className={styles.spinner} />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loading Docker compose projects…</span>
              </div>
            ) : filteredComposeProjects.length === 0 ? (
              <div className={styles.emptyState}>
                <Layers size={32} style={{ opacity: 0.15 }} />
                <p className={styles.emptyTitle}>
                  {composeSearchQuery ? 'No compose projects match your query' : 'No Docker compose projects deployed'}
                </p>
                <p className={styles.emptySubtext}>
                  Deploy multi-container applications easily with guided templates or custom Compose YAML
                </p>
                <button
                  className={styles.btnPrimary}
                  style={{ marginTop: '12px' }}
                  onClick={openDeployModal}
                >
                  <Plus size={13} /> Deploy Compose Project
                </button>
              </div>
            ) : (
              <div className={styles.composeGrid}>
                {filteredComposeProjects.map((p) => {
                  const isRunning = p.status === 'running';
                  const isPartial = p.status === 'partial';
                  const isActioning =
                    actionLoading === `start-${p.name}` ||
                    actionLoading === `stop-${p.name}` ||
                    actionLoading === `delete-${p.name}`;

                  return (
                    <div key={p.name} className={styles.composeCard}>
                      <div className={styles.composeCardHeader}>
                        <div className={styles.composeNameGroup}>
                          <p className={styles.composeTitle}>{p.name}</p>
                          <span
                            className={`${styles.composeStatusBadge} ${
                              isRunning
                                ? styles.composeStatusRunning
                                : isPartial
                                ? styles.composeStatusPartial
                                : styles.composeStatusStopped
                            }`}
                          >
                            <span
                              className={styles.serviceDot}
                              style={{
                                background: isRunning ? '#22c55e' : isPartial ? '#facc15' : '#737373',
                              }}
                            />
                            {p.status} ({p.runningServicesCount}/{p.servicesCount})
                          </span>
                        </div>

                        <div className={styles.composeActions}>
                          {isRunning || isPartial ? (
                            <button
                              className={styles.composeActionBtn}
                              title="Stop Compose Project"
                              disabled={isActioning}
                              onClick={() => handleStopCompose(p.name)}
                            >
                              <Square size={12} />
                            </button>
                          ) : (
                            <button
                              className={styles.composeActionBtn}
                              title="Start Compose Project"
                              disabled={isActioning}
                              onClick={() => handleStartCompose(p.name)}
                            >
                              <Play size={12} fill="currentColor" />
                            </button>
                          )}

                          <button
                            className={styles.composeActionBtn}
                            title="Compose Logs"
                            onClick={() => handleOpenComposeLogs(p.name)}
                          >
                            <FileText size={12} />
                          </button>

                          <button
                            className={styles.composeActionBtn}
                            title="Edit & Redeploy Compose Project"
                            onClick={() => handleEditCompose(p.name)}
                          >
                            <RefreshCw size={12} />
                          </button>

                          <button
                            className={`${styles.composeActionBtn} ${styles.composeActionDelete}`}
                            title="Delete Compose Project"
                            disabled={isActioning}
                            onClick={() => handleDeleteCompose(p.name)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {/* Services list pills */}
                      <div className={styles.composeServicesList}>
                        {p.containers.length > 0 ? (
                          p.containers.map((sc) => (
                            <span key={sc.id} className={styles.servicePill} title={`${sc.image} (${sc.status})`}>
                              <span
                                className={`${styles.serviceDot} ${
                                  sc.state === 'running' ? styles.serviceDotRunning : styles.serviceDotStopped
                                }`}
                              />
                              {sc.service}: {sc.state}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            No active containers associated with compose project
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Status Bar */}
          <div className={styles.statusBar}>
            <span>{composeProjects.length} compose project{composeProjects.length !== 1 ? 's' : ''}</span>
            <span>{composeProjects.filter((p) => p.status === 'running').length} running</span>
          </div>
        </>
      )}

      {/* ───── Deploy Compose Project Modal ───── */}
      {showDeployModal && (
        <div className={styles.modalOverlay} onClick={() => !deploying && setShowDeployModal(false)}>
          <div className={styles.modalCard} style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <Layers size={15} style={{ color: '#ededed' }} />
                <span>Deploy Docker Compose Project</span>
              </div>
              <button
                className={styles.modalCloseBtn}
                onClick={() => !deploying && setShowDeployModal(false)}
                disabled={deploying}
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleDeploySubmit} className={styles.modalForm}>
              <div className={styles.modalBody}>
                {deployError && (
                  <div className={styles.alertError}>
                    <AlertCircle size={14} />
                    <span>{deployError}</span>
                  </div>
                )}

                {/* Project Name & Controls Bar */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div className={styles.fieldGroup} style={{ flex: 1, marginBottom: 0 }}>
                    <label className={styles.fieldLabel}>Project Name</label>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      value={deployProjectName}
                      onChange={(e) => {
                        const name = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                        setDeployProjectName(name);
                      }}
                      placeholder="e.g. my-app, production-compose, backend"
                      required
                      disabled={deploying}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <label className={styles.fieldLabel} style={{ marginBottom: 0 }}>Mode & Import</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".yml,.yaml,text/yaml,text/plain"
                        onChange={handleYamlFileUpload}
                        style={{ display: 'none' }}
                      />
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', height: '26px' }}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={deploying}
                        title="Upload a docker-compose.yml file from disk"
                      >
                        <Upload size={11} /> Upload YAML
                      </button>

                      <div className={styles.filterPills}>
                        <button
                          type="button"
                          className={`${styles.filterPill} ${deployMode === 'form' ? styles.filterPillActive : ''}`}
                          onClick={switchToFormView}
                          disabled={deploying}
                          title="Configure any compose project using simple visual form fields"
                        >
                          <Sliders size={11} /> Form View
                        </button>
                        <button
                          type="button"
                          className={`${styles.filterPill} ${deployMode === 'yaml' ? styles.filterPillActive : ''}`}
                          onClick={switchToYamlView}
                          disabled={deploying}
                          title="Edit raw Compose YAML with live line numbers and syntax validation"
                        >
                          <Code size={11} /> YAML Editor
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mode 1: Universal Multi-Service Form View */}
                {deployMode === 'form' ? (
                  <div className={styles.servicesList}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span className={styles.modalSectionTitle} style={{ margin: 0 }}>
                        Defined Services ({formServices.length})
                      </span>
                      <button
                        type="button"
                        className={styles.addBtnSub}
                        onClick={handleAddService}
                        disabled={deploying}
                      >
                        <Plus size={11} /> Add Service
                      </button>
                    </div>

                    {formServices.map((service, sIdx) => (
                      <div key={service.id} className={styles.serviceCard}>
                        {/* Service Card Header */}
                        <div className={styles.serviceCardHeader}>
                          <div className={styles.serviceCardTitle}>
                            <Box size={13} style={{ color: '#3b82f6' }} />
                            <span>Service #{sIdx + 1}: {service.name || 'Untitled'}</span>
                          </div>
                          {formServices.length > 1 && (
                            <button
                              type="button"
                              className={styles.iconBtnSmall}
                              title="Delete service"
                              onClick={() => handleRemoveService(service.id)}
                              disabled={deploying}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                        {/* Service Name & Image */}
                        <div className={styles.formGrid}>
                          <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel}>Service Name</label>
                            <input
                              className={styles.fieldInput}
                              type="text"
                              value={service.name}
                              onChange={(e) => handleServiceChange(service.id, 'name', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                              placeholder="e.g. web, api, db, redis"
                              required
                              disabled={deploying}
                            />
                          </div>

                          <div className={styles.fieldGroup}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <label className={styles.fieldLabel}>Container Image</label>
                              {suggestedImages.local.length > 0 && (
                                <span style={{ fontSize: '10px', color: '#22c55e', fontFamily: 'var(--mono)' }}>
                                  {suggestedImages.local.length} local available
                                </span>
                              )}
                            </div>
                            <ImageAutocompleteInput
                              value={service.image}
                              onChange={(val) => handleServiceChange(service.id, 'image', val)}
                              localImages={suggestedImages.local}
                              placeholder="e.g. nginx:alpine (type / for all)"
                              required
                              disabled={deploying}
                            />
                          </div>
                        </div>

                        {/* Restart Policy & Command */}
                        <div className={styles.formGrid}>
                          <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel}>Restart Policy</label>
                            <select
                              className={styles.selectInput}
                              value={service.restart}
                              onChange={(e) => handleServiceChange(service.id, 'restart', e.target.value)}
                              disabled={deploying}
                            >
                              <option value="always">always</option>
                              <option value="unless-stopped">unless-stopped</option>
                              <option value="on-failure">on-failure</option>
                              <option value="no">no</option>
                            </select>
                          </div>

                          <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel}>Custom Command (Optional)</label>
                            <input
                              className={styles.fieldInput}
                              type="text"
                              value={service.command}
                              onChange={(e) => handleServiceChange(service.id, 'command', e.target.value)}
                              placeholder="e.g. npm start, python app.py"
                              disabled={deploying}
                            />
                          </div>
                        </div>

                        {/* Port Mappings */}
                        <div className={styles.subSection}>
                          <div className={styles.subSectionHeader}>
                            <span>Port Mappings (Host:Container)</span>
                            <button
                              type="button"
                              className={styles.addBtnSub}
                              onClick={() => handleAddPort(service.id)}
                              disabled={deploying}
                            >
                              <Plus size={10} /> Add Port
                            </button>
                          </div>
                          {service.ports.length === 0 ? (
                            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              No port mappings defined
                            </span>
                          ) : (
                            service.ports.map((p) => (
                              <div key={p.id} className={styles.subRow}>
                                <input
                                  className={`${styles.fieldInput} ${styles.subRowInput}`}
                                  type="text"
                                  value={p.host}
                                  onChange={(e) => handlePortChange(service.id, p.id, 'host', e.target.value)}
                                  placeholder="Host Port (e.g. 8080)"
                                  disabled={deploying}
                                />
                                <span style={{ color: '#525252', fontSize: '12px' }}>:</span>
                                <input
                                  className={`${styles.fieldInput} ${styles.subRowInput}`}
                                  type="text"
                                  value={p.container}
                                  onChange={(e) => handlePortChange(service.id, p.id, 'container', e.target.value)}
                                  placeholder="Container Port (e.g. 80)"
                                  disabled={deploying}
                                />
                                <button
                                  type="button"
                                  className={styles.iconBtnSmall}
                                  onClick={() => handleRemovePort(service.id, p.id)}
                                  disabled={deploying}
                                  title="Remove port"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))
                          )}
                        </div>

                        {/* Environment Variables */}
                        <div className={styles.subSection}>
                          <div className={styles.subSectionHeader}>
                            <span>Environment Variables (KEY=VALUE)</span>
                            <button
                              type="button"
                              className={styles.addBtnSub}
                              onClick={() => handleAddEnv(service.id)}
                              disabled={deploying}
                            >
                              <Plus size={10} /> Add Variable
                            </button>
                          </div>
                          {service.env.length === 0 ? (
                            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              No environment variables defined
                            </span>
                          ) : (
                            service.env.map((e) => {
                              const showVal = showEnvPasswords[e.id];
                              return (
                                <div key={e.id} className={styles.subRow}>
                                  <input
                                    className={`${styles.fieldInput} ${styles.subRowInput}`}
                                    type="text"
                                    value={e.key}
                                    onChange={(evt) => handleEnvChange(service.id, e.id, 'key', evt.target.value)}
                                    placeholder="KEY (e.g. DB_PASS)"
                                    disabled={deploying}
                                  />
                                  <span style={{ color: '#525252', fontSize: '12px' }}>=</span>
                                  <div className={styles.passwordInputWrapper}>
                                    <input
                                      className={styles.fieldInput}
                                      type={showVal ? 'text' : 'password'}
                                      value={e.value}
                                      onChange={(evt) => handleEnvChange(service.id, e.id, 'value', evt.target.value)}
                                      placeholder="VALUE"
                                      disabled={deploying}
                                    />
                                    <button
                                      type="button"
                                      className={styles.passwordToggleBtn}
                                      onClick={() => setShowEnvPasswords((prev) => ({ ...prev, [e.id]: !prev[e.id] }))}
                                      title={showVal ? 'Hide password' : 'Show password'}
                                    >
                                      {showVal ? <EyeOff size={12} /> : <Eye size={12} />}
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className={styles.iconBtnSmall}
                                    onClick={() => handleGenerateEnvPassword(service.id, e.id)}
                                    title="Generate random password"
                                    disabled={deploying}
                                  >
                                    <Sparkles size={12} style={{ color: '#60a5fa' }} />
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.iconBtnSmall}
                                    onClick={() => handleRemoveEnv(service.id, e.id)}
                                    disabled={deploying}
                                    title="Remove variable"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* Volume Mounts */}
                        <div className={styles.subSection}>
                          <div className={styles.subSectionHeader}>
                            <span>Volume Mounts (Host:Container)</span>
                            <button
                              type="button"
                              className={styles.addBtnSub}
                              onClick={() => handleAddVolume(service.id)}
                              disabled={deploying}
                            >
                              <Plus size={10} /> Add Volume
                            </button>
                          </div>
                          {service.volumes.length === 0 ? (
                            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              No volume mounts defined
                            </span>
                          ) : (
                            service.volumes.map((v) => (
                              <div key={v.id} className={styles.subRow}>
                                <input
                                  className={`${styles.fieldInput} ${styles.subRowInput}`}
                                  type="text"
                                  value={v.host}
                                  onChange={(e) => handleVolumeChange(service.id, v.id, 'host', e.target.value)}
                                  placeholder="Host Path or Volume (e.g. ./data)"
                                  disabled={deploying}
                                />
                                <span style={{ color: '#525252', fontSize: '12px' }}>:</span>
                                <input
                                  className={`${styles.fieldInput} ${styles.subRowInput}`}
                                  type="text"
                                  value={v.container}
                                  onChange={(e) => handleVolumeChange(service.id, v.id, 'container', e.target.value)}
                                  placeholder="Container Path (e.g. /var/lib/data)"
                                  disabled={deploying}
                                />
                                <button
                                  type="button"
                                  className={styles.iconBtnSmall}
                                  onClick={() => handleRemoveVolume(service.id, v.id)}
                                  disabled={deploying}
                                  title="Remove volume"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      className={styles.addServiceBtn}
                      onClick={handleAddService}
                      disabled={deploying}
                    >
                      <Plus size={13} /> Add Another Service
                    </button>

                    {/* Summary Bar linking to YAML */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid #1a1a1a', fontSize: '11px', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <CheckCircle2 size={12} style={{ color: '#22c55e' }} />
                        <span>Compose YAML synchronized ({deployYaml.split('\n').length} lines)</span>
                      </div>
                      <button
                        type="button"
                        onClick={switchToYamlView}
                        style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}
                      >
                        View in YAML Editor →
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Mode 2: Live Overlaid Syntax Highlighting YAML Editor */
                  <div className={styles.fieldGroup} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', margin: 0 }}>
                    <LiveYamlEditor
                      value={deployYaml}
                      onChange={setDeployYaml}
                      disabled={deploying}
                      validation={yamlValidation}
                    />
                  </div>
                )}

                {/* Deployment Progress Logs */}
                {deployConsoleLogs.length > 0 && (
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Deployment Progress Console</label>
                    <div className={styles.deployConsole}>
                      {deployConsoleLogs.map((line, idx) => (
                        <div key={idx}>{line}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setShowDeployModal(false)}
                  disabled={deploying}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.btnPrimary}
                  disabled={deploying || !yamlValidation.valid || !deployProjectName.trim()}
                >
                  {deploying ? 'Deploying Project…' : 'Deploy Compose Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───── In-App Remove Compose Project Confirmation Modal ───── */}
      {projectToDelete && (
        <div className={styles.modalOverlay} onClick={() => !actionLoading && setProjectToDelete(null)}>
          <div
            className={styles.modalCard}
            style={{ maxWidth: '440px', border: '1px solid #ef4444' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle} style={{ color: '#ef4444' }}>
                <AlertTriangle size={15} />
                <span>Remove Compose Project</span>
              </div>
              <button
                className={styles.modalCloseBtn}
                onClick={() => !actionLoading && setProjectToDelete(null)}
                disabled={Boolean(actionLoading)}
              >
                <X size={14} />
              </button>
            </div>

            <div className={styles.modalBody} style={{ padding: '16px', gap: '12px' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#ededed', lineHeight: '1.5' }}>
                Are you sure you want to remove compose project{' '}
                <strong style={{ color: '#ffffff', fontFamily: 'var(--mono)' }}>{projectToDelete}</strong>?
              </p>
              <div
                style={{
                  padding: '10px 12px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#fca5a5',
                  lineHeight: '1.4',
                }}
              >
                ⚠ This will permanently stop and remove all associated containers, networks, and volumes managed by this compose project.
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setProjectToDelete(null)}
                disabled={Boolean(actionLoading)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                disabled={Boolean(actionLoading)}
                onClick={() => confirmAndExecuteDeleteCompose(projectToDelete)}
              >
                <Trash2 size={13} />
                {actionLoading === `delete-${projectToDelete}` ? 'Removing…' : 'Remove Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Compose Logs Modal ───── */}
      {selectedComposeLogsName && (
        <div className={styles.modalOverlay} onClick={() => setSelectedComposeLogsName(null)}>
          <div className={styles.modalCard} style={{ maxWidth: '720px' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <FileText size={15} style={{ color: '#ededed' }} />
                <span>Compose Logs — {selectedComposeLogsName}</span>
              </div>
              <button className={styles.modalCloseBtn} onClick={() => setSelectedComposeLogsName(null)}>
                <X size={14} />
              </button>
            </div>

            <div className={styles.modalBody} style={{ padding: '12px' }}>
              <div className={styles.deployConsole} style={{ height: '320px' }}>
                {composeLogsLoading && composeLogLines.length === 0 ? (
                  <span style={{ color: 'var(--text-muted)' }}>Connecting to Docker Compose logs stream…</span>
                ) : composeLogLines.length === 0 ? (
                  <span style={{ color: 'var(--text-muted)' }}>No logs emitted yet</span>
                ) : (
                  composeLogLines.map((l, i) => <div key={i}>{l}</div>)
                )}
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setSelectedComposeLogsName(null)}
              >
                Close Logs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Run Container Modal ───── */}
      {runModalImage && (
        <div className={styles.modalOverlay} onClick={() => setRunModalImage(null)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <Play size={14} fill="currentColor" style={{ color: '#ededed' }} />
                <span>Run Container</span>
              </div>
              <button className={styles.modalCloseBtn} onClick={() => setRunModalImage(null)} title="Close modal">
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateContainer} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className={styles.modalBody}>
                {runError && (
                  <div className={styles.alertError}>
                    <AlertCircle size={14} />
                    <span>{runError}</span>
                  </div>
                )}

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Selected Image</label>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    value={runModalImage}
                    readOnly
                    style={{ opacity: 0.8 }}
                  />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Container Name (optional)</label>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    value={runContainerName}
                    onChange={(e) => setRunContainerName(e.target.value)}
                    placeholder="e.g. my-app-service"
                  />
                </div>

                {/* Ports Mapping */}
                <div>
                  <div className={styles.modalSectionTitle}>
                    <span>Port Mappings</span>
                    <button type="button" className={styles.iconAddBtn} onClick={addPortRow}>
                      <Plus size={10} /> Add Port
                    </button>
                  </div>
                  {runPorts.length === 0 ? (
                    <span style={{ fontSize: '11px', color: '#737373', fontStyle: 'italic' }}>No port mappings added</span>
                  ) : (
                    <div className={styles.dynamicList}>
                      {runPorts.map((p, idx) => (
                        <div key={idx} className={styles.dynamicRow}>
                          <input
                            className={styles.fieldInput}
                            type="text"
                            placeholder="Host (e.g. 8080)"
                            value={p.hostPort}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRunPorts((prev) => prev.map((item, i) => (i === idx ? { ...item, hostPort: val } : item)));
                            }}
                          />
                          <span style={{ color: '#737373', fontSize: '12px' }}>→</span>
                          <input
                            className={styles.fieldInput}
                            type="text"
                            placeholder="Container (e.g. 80)"
                            value={p.containerPort}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRunPorts((prev) => prev.map((item, i) => (i === idx ? { ...item, containerPort: val } : item)));
                            }}
                          />
                          <button type="button" className={styles.iconRemoveBtn} onClick={() => removePortRow(idx)}>
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Environment Variables */}
                <div>
                  <div className={styles.modalSectionTitle}>
                    <span>Environment Variables</span>
                    <button type="button" className={styles.iconAddBtn} onClick={addEnvRow}>
                      <Plus size={10} /> Add Var
                    </button>
                  </div>
                  {runEnvs.length === 0 ? (
                    <span style={{ fontSize: '11px', color: '#737373', fontStyle: 'italic' }}>No environment variables added</span>
                  ) : (
                    <div className={styles.dynamicList}>
                      {runEnvs.map((ev, idx) => (
                        <div key={idx} className={styles.dynamicRow}>
                          <input
                            className={styles.fieldInput}
                            type="text"
                            placeholder="KEY (e.g. PORT)"
                            value={ev.key}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRunEnvs((prev) => prev.map((item, i) => (i === idx ? { ...item, key: val } : item)));
                            }}
                          />
                          <span style={{ color: '#737373', fontSize: '12px' }}>=</span>
                          <input
                            className={styles.fieldInput}
                            type="text"
                            placeholder="VALUE (e.g. 3000)"
                            value={ev.value}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRunEnvs((prev) => prev.map((item, i) => (i === idx ? { ...item, value: val } : item)));
                            }}
                          />
                          <button type="button" className={styles.iconRemoveBtn} onClick={() => removeEnvRow(idx)}>
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Volume Mounts */}
                <div>
                  <div className={styles.modalSectionTitle}>
                    <span>Volume Mounts</span>
                    <button type="button" className={styles.iconAddBtn} onClick={addVolumeRow}>
                      <Plus size={10} /> Add Volume
                    </button>
                  </div>
                  {net.baseDir && (
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>
                      Host path must reside inside {net.baseDir}
                    </span>
                  )}
                  {runVolumes.length === 0 ? (
                    <span style={{ fontSize: '11px', color: '#737373', fontStyle: 'italic' }}>No volume mounts added</span>
                  ) : (
                    <div className={styles.dynamicList}>
                      {runVolumes.map((v, idx) => (
                        <div key={idx} className={styles.dynamicRow}>
                          <input
                            className={styles.fieldInput}
                            type="text"
                            placeholder={net.baseDir ? `Host path (${net.baseDir}/…)` : 'Host path'}
                            value={v.hostPath}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRunVolumes((prev) => prev.map((item, i) => (i === idx ? { ...item, hostPath: val } : item)));
                            }}
                          />
                          <span style={{ color: '#737373', fontSize: '12px' }}>→</span>
                          <input
                            className={styles.fieldInput}
                            type="text"
                            placeholder="Container path (e.g. /app/data)"
                            value={v.containerPath}
                            onChange={(e) => {
                              const val = e.target.value;
                              setRunVolumes((prev) => prev.map((item, i) => (i === idx ? { ...item, containerPath: val } : item)));
                            }}
                          />
                          <button type="button" className={styles.iconRemoveBtn} onClick={() => removeVolumeRow(idx)}>
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Restart Policy */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Restart Policy</label>
                  <select
                    className={styles.selectInput}
                    value={runRestartPolicy}
                    onChange={(e) => setRunRestartPolicy(e.target.value)}
                  >
                    <option value="no">Never restart (no)</option>
                    <option value="unless-stopped">Unless stopped (unless-stopped)</option>
                    <option value="always">Always restart (always)</option>
                    <option value="on-failure">On failure only (on-failure)</option>
                  </select>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setRunModalImage(null)}
                  disabled={runSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={runSubmitting}>
                  {runSubmitting ? 'Starting Container…' : 'Run Container'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───── Expose Container Modal ───── */}
      {exposeModalContainer && (
        <div className={styles.modalOverlay} onClick={() => setExposeModalContainer(null)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <Globe size={15} style={{ color: '#ededed' }} />
                <span>Expose Container via Cloudflare</span>
              </div>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setExposeModalContainer(null)}
                title="Close modal"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleExposeContainer} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className={styles.modalBody}>
                {exposeError && (
                  <div className={styles.alertError}>
                    <AlertCircle size={14} />
                    <span>{exposeError}</span>
                  </div>
                )}

                {exposeSuccessUrl ? (
                  <div className={styles.alertSuccess} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontWeight: 600 }}>✓ Container Successfully Exposed!</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Public Endpoint:</span>
                    <a
                      href={exposeSuccessUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '12px',
                        fontFamily: 'var(--mono)',
                        color: '#ededed',
                        wordBreak: 'break-all',
                        textDecoration: 'underline',
                      }}
                    >
                      {exposeSuccessUrl}
                    </a>
                  </div>
                ) : (
                  <>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Container</label>
                      <input
                        className={styles.fieldInput}
                        type="text"
                        value={(exposeModalContainer.Names[0] ?? exposeModalContainer.Id).replace(/^\//, '')}
                        readOnly
                        style={{ opacity: 0.8 }}
                      />
                    </div>

                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>Desired Subdomain</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          className={styles.fieldInput}
                          type="text"
                          value={exposeSubdomain}
                          onChange={(e) => setExposeSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                          placeholder="e.g. my-app"
                          required
                        />
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                          .{net.cfDomain || '…'}
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      This will automatically create a proxied Cloudflare CNAME record and update your tunnel ingress configuration with zero downtime.
                    </div>
                  </>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setExposeModalContainer(null)}
                >
                  {exposeSuccessUrl ? 'Close' : 'Cancel'}
                </button>
                {!exposeSuccessUrl && (
                  <button
                    type="submit"
                    className={styles.btnPrimary}
                    disabled={exposeLoading || !exposeSubdomain.trim()}
                  >
                    {exposeLoading ? 'Exposing…' : 'Expose Container'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
