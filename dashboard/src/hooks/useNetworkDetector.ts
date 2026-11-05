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

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
  const currentPort = window.location.port
    ? parseInt(window.location.port, 10)
    : (window.location.protocol === 'https:' ? 443 : 80);

  let localIp: string | null = null;
  let localPort = 3000;
  let baseDir: string | null = null;
  let cfDomain = '';

  // 1. Try authenticated /api/network/info first (contains full metadata when logged in)
  try {
    const infoRes = await fetch('/api/network/info');
    if (infoRes.ok) {
      const info = await infoRes.json();
      localIp = info.serverLocalIp;
      localPort = info.serverLocalPort || 3000;
      baseDir = info.baseDir || null;
      cfDomain = info.cfDomain || '';
    }
  } catch {
    /* not authenticated or network error */
  }

  // 2. Fallback to localStorage if the authenticated network call did not return an address.
  // Public unauthenticated ping endpoints must not be trusted for server identity.
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

  // Persist discovered IP & port in localStorage for future pre-auth discovery
  if (localIp) {
    try {
      localStorage.setItem(LOCAL_STORAGE_IP_KEY, localIp);
      localStorage.setItem(LOCAL_STORAGE_PORT_KEY, String(localPort));
    } catch {
      /* ignore storage quota/security errors */
    }
  }

  // Determine if the current window is ALREADY directly loaded from the server's local IP and port
  const isDirectLocal = Boolean(
    localIp
      ? hostname === localIp && currentPort === localPort
      : (hostname === 'localhost' || hostname === '127.0.0.1') && currentPort === localPort
  );

  const baseResult: NetworkDetectorResult = {
    isLocalLAN: isDirectLocal,
    isDirectLocal,
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

  // If running in development (Vite dev server) or explicitly on dev port 5173, stay on dev server
  const isDevEnvironment = Boolean(import.meta.env.DEV || currentPort === 5173);
  if (isDevEnvironment) {
    const devResult: NetworkDetectorResult = {
      ...baseResult,
      isLocalLAN: true,
      isDirectLocal: true,
      checking: false,
    };
    cachedResult = devResult;
    return devResult;
  }

  // If already running directly on the local IP:port, we're done!
  if (isDirectLocal) {
    cachedResult = baseResult;
    return baseResult;
  }

  // Cryptographic challenge-response check if on remote hostname, proxy, or dev port
  const stayRemote =
    new URLSearchParams(window.location.search).has('stay_remote') ||
    new URLSearchParams(window.location.search).has('stay_dev');
  if (localIp && !stayRemote) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    try {
      const nonce = generateNonce();
      const proofUrl = `http://${localIp}:${localPort}/api/lan-identity/proof?nonce=${encodeURIComponent(nonce)}`;

      const proofRes = await fetch(proofUrl, {
        signal: controller.signal,
        mode: 'cors',
        // @ts-expect-error - Chromium Private Network Access specification
        targetAddressSpace: 'private',
      }).catch(() => null);

      if (proofRes && proofRes.ok) {
        const proofData = await proofRes.json().catch(() => null);
        if (proofData && typeof proofData.proof === 'string') {
          // Verify proof through current trusted origin
          const verifyRes = await fetch('/api/lan-identity/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ nonce, proof: proofData.proof }),
            signal: controller.signal,
          }).catch(() => null);

          if (verifyRes && verifyRes.ok) {
            const verifyData = await verifyRes.json().catch(() => null);
            if (verifyData && verifyData.valid === true) {
              clearTimeout(timer);
              const lanResult: NetworkDetectorResult = {
                ...baseResult,
                isLocalLAN: true,
                isDirectLocal: false,
              };
              cachedResult = lanResult;

              // Auto-redirect to local IP only after cryptographic verification
              window.location.href = `http://${localIp}:${localPort}${window.location.pathname}${window.location.search}`;
              return lanResult;
            }
          }
        }
      }
    } catch {
      /* proof/verify failed -> remote mode */
    } finally {
      clearTimeout(timer);
    }
  }

  cachedResult = baseResult;
  return baseResult;
}

export function useNetworkDetector(): NetworkDetectorResult {
  const [state, setState] = useState<NetworkDetectorResult>(() => {
    if (cachedResult) return cachedResult;
    const hostname = window.location.hostname;
    const currentPort = window.location.port
      ? parseInt(window.location.port, 10)
      : (window.location.protocol === 'https:' ? 443 : 80);

    let storedIp: string | null = null;
    let storedPort = 3000;
    try {
      storedIp = localStorage.getItem(LOCAL_STORAGE_IP_KEY);
      storedPort = parseInt(localStorage.getItem(LOCAL_STORAGE_PORT_KEY) || '3000', 10);
    } catch {
      /* ignore */
    }

    const isDirectLocal = Boolean(
      storedIp
        ? hostname === storedIp && currentPort === storedPort
        : /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) && hostname !== '127.0.0.1' && currentPort === 3000
    );

    const isDevEnvironment = Boolean(import.meta.env.DEV || currentPort === 5173);

    if (isDirectLocal || isDevEnvironment) {
      return {
        isLocalLAN: true,
        isDirectLocal: true,
        serverLocalIp: storedIp || hostname,
        serverLocalPort: storedPort,
        baseDir: null,
        cfDomain: '',
        checking: false,
        redirectToLocal: () => {},
      };
    }

    return {
      isLocalLAN: false,
      isDirectLocal: false,
      serverLocalIp: storedIp,
      serverLocalPort: storedPort,
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
