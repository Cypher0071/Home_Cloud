import { useEffect, useRef, useState } from 'react';
import { memInUse } from '../utils/memory';
import styles from './metrics.module.css';

// ─── Types matching systeminformation output ───

interface CpuLoad {
  avgLoad: number;
  currentLoad: number;
  currentLoadUser: number;
  currentLoadSystem: number;
  currentLoadIdle: number;
  cpus: { load: number }[];
}

interface MemData {
  total: number;
  used: number;
  free: number;
  active: number;
  available: number;
  swaptotal: number;
  swapused: number;
  swapfree: number;
}

interface DiskPartition {
  fs: string;
  type: string;
  size: number;
  used: number;
  available: number;
  use: number;
  mount: string;
}

interface MetricsPayload {
  cpu: CpuLoad;
  mem: MemData;
  disk: DiskPartition[];
}

// ─── Helpers ───

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${units[i]}`;
}

// ─── Gauge Component ───

function GaugeRing({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color?: string;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className={styles.gaugeWrapper}>
      <div className={styles.gauge}>
        <svg className={styles.gaugeSvg} viewBox="0 0 130 130">
          <circle className={styles.gaugeBg} cx="65" cy="65" r={radius} />
          <circle
            className={styles.gaugeFill}
            cx="65"
            cy="65"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={color ? { stroke: color } : undefined}
          />
        </svg>
        <div className={styles.gaugeCenter}>
          <span className={styles.gaugeValue}>{Math.round(value)}</span>
          <span className={styles.gaugeUnit}>{label}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───

export default function Metrics() {
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/metrics');
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const parsed: MetricsPayload = JSON.parse(event.data);
        setData(parsed);
        setConnected(true);
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  // ─── Connecting state ───
  if (!data) {
    return (
      <div className={styles.container}>
        <div className={styles.connectingOverlay}>
          <div className={styles.connectingSpinner} />
          <span className={styles.connectingText}>
            Connecting to server&hellip;
          </span>
        </div>
      </div>
    );
  }

  const { cpu, mem, disk } = data;

  const memUsedPercent = mem.total > 0 ? (memInUse(mem) / mem.total) * 100 : 0;
  const swapUsedPercent =
    mem.swaptotal > 0 ? (mem.swapused / mem.swaptotal) * 100 : 0;

  return (
    <div className={styles.container}>
      {/* ─── Header ─── */}
      <div className={styles.header}>
        <h1 className={styles.title}>System Metrics</h1>
        <p className={styles.subtitle}>
          <span
            className={`${styles.statusDot} ${!connected ? styles.statusDotDisconnected : ''}`}
          />
          {connected ? 'Live — streaming every second' : 'Disconnected — reconnecting…'}
        </p>
      </div>

      {/* ─── CPU / Memory / Swap Gauges ─── */}
      <div className={styles.grid}>
        {/* CPU Card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <path d="M15 2v2" /><path d="M15 20v2" />
                <path d="M2 15h2" /><path d="M2 9h2" />
                <path d="M20 15h2" /><path d="M20 9h2" />
                <path d="M9 2v2" /><path d="M9 20v2" />
              </svg>
            </div>
            <div>
              <p className={styles.cardTitle}>CPU</p>
              <p className={styles.cardSubtitle}>{cpu.cpus?.length ?? '—'} cores</p>
            </div>
          </div>

          <GaugeRing value={cpu.currentLoad} label="% used" />

          <div className={styles.statsRow}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>User</div>
              <div className={styles.statValue}>{cpu.currentLoadUser?.toFixed(1)}%</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>System</div>
              <div className={styles.statValue}>{cpu.currentLoadSystem?.toFixed(1)}%</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Idle</div>
              <div className={styles.statValue}>{cpu.currentLoadIdle?.toFixed(1)}%</div>
            </div>
          </div>
        </div>

        {/* Memory Card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 19v-8a6 6 0 0 1 12 0v8" />
                <rect x="2" y="19" width="20" height="2" rx="1" />
                <path d="M12 11v-1" />
              </svg>
            </div>
            <div>
              <p className={styles.cardTitle}>Memory</p>
              <p className={styles.cardSubtitle}>{formatBytes(mem.total)} total</p>
            </div>
          </div>

          <GaugeRing
            value={memUsedPercent}
            label="% used"
            color={memUsedPercent > 90 ? '#ef4444' : memUsedPercent > 75 ? '#f59e0b' : undefined}
          />

          <div className={styles.statsRow}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Used</div>
              <div className={styles.statValue}>{formatBytes(memInUse(mem))}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Free</div>
              <div className={styles.statValue}>{formatBytes(mem.free)}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Available</div>
              <div className={styles.statValue}>{formatBytes(mem.available)}</div>
            </div>
          </div>
        </div>

        {/* Swap Card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3h5v5" /><path d="M8 3H3v5" />
                <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.828L3 3" />
                <path d="m15 9 6-6" />
              </svg>
            </div>
            <div>
              <p className={styles.cardTitle}>Swap</p>
              <p className={styles.cardSubtitle}>
                {mem.swaptotal > 0 ? formatBytes(mem.swaptotal) + ' total' : 'Not configured'}
              </p>
            </div>
          </div>

          <GaugeRing
            value={mem.swaptotal > 0 ? swapUsedPercent : 0}
            label={mem.swaptotal > 0 ? '% used' : 'N/A'}
            color={swapUsedPercent > 80 ? '#ef4444' : swapUsedPercent > 50 ? '#f59e0b' : undefined}
          />

          <div className={styles.statsRow}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Used</div>
              <div className={styles.statValue}>
                {mem.swaptotal > 0 ? formatBytes(mem.swapused) : '—'}
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Free</div>
              <div className={styles.statValue}>
                {mem.swaptotal > 0 ? formatBytes(mem.swapfree) : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Disk Partitions ─── */}
      <div className={styles.gridFull}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                <path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
            </div>
            <div>
              <p className={styles.cardTitle}>Disk Partitions</p>
              <p className={styles.cardSubtitle}>{disk.length} partition{disk.length !== 1 ? 's' : ''} detected</p>
            </div>
          </div>

          <table className={styles.diskTable}>
            <thead>
              <tr>
                <th>Mount</th>
                <th>Filesystem</th>
                <th>Size</th>
                <th>Used</th>
                <th>Available</th>
                <th>Usage</th>
              </tr>
            </thead>
            <tbody>
              {disk.map((d) => {
                const barClass = d.use > 90
                  ? styles.diskBarFillDanger
                  : d.use > 75
                    ? styles.diskBarFillWarn
                    : '';

                return (
                  <tr key={d.mount}>
                    <td>
                      <span className={styles.diskMount}>{d.mount}</span>
                    </td>
                    <td>{d.fs}</td>
                    <td>{formatBytes(d.size)}</td>
                    <td>{formatBytes(d.used)}</td>
                    <td>{formatBytes(d.available)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className={styles.diskBar}>
                          <div
                            className={`${styles.diskBarFill} ${barClass}`}
                            style={{ width: `${d.use}%` }}
                          />
                        </div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', whiteSpace: 'nowrap' }}>
                          {d.use.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
