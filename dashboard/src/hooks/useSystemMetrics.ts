import { useState, useEffect } from 'react';
import { memInUse } from '../utils/memory';

export interface CpuLoad {
  avgLoad?: number;
  currentLoad: number;
  currentLoadUser: number;
  currentLoadSystem: number;
  currentLoadIdle: number;
  cpus?: { load: number }[];
}

export interface MemData {
  total: number;
  used: number;
  free: number;
  active?: number;
  available: number;
  swaptotal: number;
  swapused: number;
  swapfree: number;
}

export interface DiskPartition {
  fs: string;
  type: string;
  size: number;
  used: number;
  available: number;
  use: number;
  mount: string;
}

export interface NetworkInterfaceStats {
  iface: string;
  operstate?: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_sec?: number | null;
  tx_sec?: number | null;
  ms?: number;
}

export interface MetricsPayload {
  cpu: CpuLoad;
  mem: MemData;
  disk: DiskPartition[];
  network?: NetworkInterfaceStats[];
}

// ─── Module-Level Singleton & Pub-Sub Manager ───

let sharedEventSource: EventSource | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let cachedData: MetricsPayload | null = null;
let isConnected = false;
const subscribers = new Set<(data: MetricsPayload | null, connected: boolean) => void>();
const cpuHistoryBuffer: number[] = [];

function notifySubscribers() {
  subscribers.forEach((cb) => {
    try {
      cb(cachedData, isConnected);
    } catch (e) {
      console.error('[useSystemMetrics] Error notifying subscriber:', e);
    }
  });
}

function startSSE() {
  if (sharedEventSource || typeof window === 'undefined') return;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  try {
    const es = new EventSource('/api/metrics');
    sharedEventSource = es;

    es.onopen = () => {
      isConnected = true;
      notifySubscribers();
    };

    es.onmessage = (event) => {
      try {
        const payload: MetricsPayload = JSON.parse(event.data);
        cachedData = payload;
        isConnected = true;

        if (payload?.cpu?.currentLoad !== undefined) {
          cpuHistoryBuffer.push(payload.cpu.currentLoad);
          if (cpuHistoryBuffer.length > 60) {
            cpuHistoryBuffer.shift();
          }
        }

        notifySubscribers();
      } catch (err) {
        console.error('[useSystemMetrics] SSE JSON parse error:', err);
      }
    };

    es.onerror = () => {
      isConnected = false;
      notifySubscribers();
      if (sharedEventSource) {
        sharedEventSource.close();
        sharedEventSource = null;
      }
      // Reconnect after 5 seconds
      if (subscribers.size > 0 && !reconnectTimeout) {
        reconnectTimeout = setTimeout(startSSE, 5000);
      }
    };
  } catch (err) {
    console.error('[useSystemMetrics] Failed to create EventSource:', err);
  }
}

function stopSSE() {
  if (subscribers.size === 0) {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (sharedEventSource) {
      sharedEventSource.close();
      sharedEventSource = null;
    }
    isConnected = false;
  }
}

export function useSystemMetrics() {
  const [data, setData] = useState<MetricsPayload | null>(cachedData);
  const [connected, setConnected] = useState<boolean>(isConnected);
  const [cpuHistory, setCpuHistory] = useState<number[]>([...cpuHistoryBuffer]);

  useEffect(() => {
    const handleUpdate = (nextData: MetricsPayload | null, nextConnected: boolean) => {
      setData(nextData);
      setConnected(nextConnected);
      setCpuHistory([...cpuHistoryBuffer]);
    };

    subscribers.add(handleUpdate);

    if (subscribers.size === 1) {
      startSSE();
    } else if (cachedData) {
      handleUpdate(cachedData, isConnected);
    }

    return () => {
      subscribers.delete(handleUpdate);
      stopSSE();
    };
  }, []);

  const cpuLoad = data?.cpu?.currentLoad ?? 0;
  const memTotal = data?.mem?.total ?? 0;
  const memUsed = data?.mem ? memInUse(data.mem) : 0;
  const memUsedPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

  // Active network interface download speed
  const activeNet =
    data?.network?.find(
      (n) => n.operstate === 'up' && !n.iface.startsWith('lo') && !n.iface.startsWith('veth'),
    ) || data?.network?.[0];
  const rxSec = activeNet?.rx_sec ?? 0;
  const txSec = activeNet?.tx_sec ?? 0;

  return {
    data,
    connected,
    cpuLoad,
    memTotal,
    memUsed,
    memUsedPct,
    rxSec,
    txSec,
    cpuHistory,
  };
}
