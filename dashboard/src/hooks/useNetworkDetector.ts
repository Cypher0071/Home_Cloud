import { useState, useEffect } from 'react';

export interface NetworkDetectorResult {
  isLocalLAN: boolean;
  isDirectLocal: boolean;
  serverLocalIp: string | null;
  serverLocalPort: number;
  baseDir: string | null;
  cfDomain: string;
  checking: boolean;
  redirectToLocal: () => void;
}

const LOCAL_STORAGE_IP_KEY = 'home-cloud:server_local_ip';
const LOCAL_STORAGE_PORT_KEY = 'home-cloud:server_local_port';

// Module-level Singleton Cache
let cachedResult: NetworkDetectorResult | null = null;
let inFlightPromise: Promise<NetworkDetectorResult> | null = null;
const listeners = new Set<(state: NetworkDetectorResult) => void>();

function notifyListeners(state: NetworkDetectorResult) {
  listeners.forEach(fn => fn(state));
}

export function resetNetworkDetectorCache(): Promise<NetworkDetectorResult> {
  cachedResult = null;
  inFlightPromise = null;
  return runDetectionOnce().then(res => {
    notifyListeners(res);
    return res;
  });
}

async function runDetectionOnce(): Promise<NetworkDetectorResult> {
  const hostname = window.location.hostname;
  const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === 'localhost';

  let localIp: string | null = null;
  let localPort = 3000;
  let baseDir: string | null = null;
  let cfDomain = '';

  try {
    const infoRes = await fetch('/api/network/info');
    if (infoRes.ok) {
      const info = await infoRes.json();
      localIp = info.serverLocalIp;
      localPort = info.serverLocalPort || 3000;
      baseDir = info.baseDir || null;
      cfDomain = info.cfDomain || '';

      // Persist in localStorage for returning users on this browser
      if (localIp) {
        try {
          localStorage.setItem(LOCAL_STORAGE_IP_KEY, localIp);
          localStorage.setItem(LOCAL_STORAGE_PORT_KEY, String(localPort));
        } catch {
          /* ignore storage quota/security errors */
        }
      }
    }
  } catch {
    /* network or auth error */
  }

  // If unauthenticated or offline, use cached IP from localStorage if available
  if (!localIp) {
    try {
      const storedIp = localStorage.getItem(LOCAL_STORAGE_IP_KEY);
      const storedPort = parseInt(localStorage.getItem(LOCAL_STORAGE_PORT_KEY) || '3000', 10);
      if (storedIp) {
        localIp = storedIp;
        localPort = storedPort;
      }
    } catch {
      /* ignore */
    }
  }

  const baseResult: NetworkDetectorResult = {
    isLocalLAN: isIpAddress,
    isDirectLocal: isIpAddress,
    serverLocalIp: localIp,
    serverLocalPort: localPort,
    baseDir,
    cfDomain,
    checking: false,
    redirectToLocal: () => {
      if (localIp) {
        window.location.href = `http://${localIp}:${localPort}${window.location.pathname}${window.location.search}`;
      }
    },
  };

  if (isIpAddress) {
    cachedResult = baseResult;
    return baseResult;
  }

  // Micro-ping check if on remote hostname
  const stayRemote = new URLSearchParams(window.location.search).has('stay_remote');
  if (localIp && !stayRemote) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);

    try {
      // Primary: ping /api/ping with PNA header; Fallback: /api/health
      const pingUrl = `http://${localIp}:${localPort}/api/ping`;
      const fallbackUrl = `http://${localIp}:${localPort}/api/health`;

      let pingRes = await fetch(pingUrl, {
        signal: controller.signal,
        mode: 'cors',
        // @ts-expect-error - Chromium Private Network Access specification
        targetAddressSpace: 'private',
      }).catch(() => null);

      if (!pingRes || !pingRes.ok) {
        pingRes = await fetch(fallbackUrl, {
          signal: controller.signal,
          mode: 'cors',
        }).catch(() => null);
      }

      clearTimeout(timer);

      if (pingRes && pingRes.ok) {
        const lanResult: NetworkDetectorResult = {
          ...baseResult,
          isLocalLAN: true,
          isDirectLocal: false,
        };
        cachedResult = lanResult;

        // Auto-redirect to local IP
        window.location.href = `http://${localIp}:${localPort}${window.location.pathname}${window.location.search}`;
        return lanResult;
      }
    } catch {
      /* ping failed -> remote mode */
    }
  }

  cachedResult = baseResult;
  return baseResult;
}

export function useNetworkDetector(): NetworkDetectorResult {
  const [state, setState] = useState<NetworkDetectorResult>(() => {
    if (cachedResult) return cachedResult;
    const hostname = window.location.hostname;
    const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === 'localhost';
    if (isIpAddress) {
      return {
        isLocalLAN: true,
        isDirectLocal: true,
        serverLocalIp: hostname,
        serverLocalPort: parseInt(window.location.port || '3000', 10),
        baseDir: null,
        cfDomain: '',
        checking: false,
        redirectToLocal: () => {},
      };
    }
    return {
      isLocalLAN: false,
      isDirectLocal: false,
      serverLocalIp: null,
      serverLocalPort: 3000,
      baseDir: null,
      cfDomain: '',
      checking: true,
      redirectToLocal: () => {},
    };
  });

  useEffect(() => {
    if (cachedResult) {
      // If cached result has incomplete metadata (e.g. from pre-auth 401 on login page),
      // trigger background revalidation so authenticated views get fresh baseDir and info.
      if (cachedResult.baseDir === null && !cachedResult.isDirectLocal && !inFlightPromise) {
        inFlightPromise = runDetectionOnce().then(res => {
          inFlightPromise = null;
          notifyListeners(res);
          return res;
        });
      }
      return;
    }

    listeners.add(setState);

    if (!inFlightPromise) {
      inFlightPromise = runDetectionOnce().then(res => {
        inFlightPromise = null;
        notifyListeners(res);
        return res;
      });
    }

    return () => {
      listeners.delete(setState);
    };
  }, []);

  return state;
}
