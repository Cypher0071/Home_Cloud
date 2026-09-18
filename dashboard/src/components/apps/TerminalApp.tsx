import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Power, RefreshCw, Trash2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { useIsMobile } from '../../hooks/useIsMobile';
import styles from './terminal.module.css';

const SOFT_KEYS = [
  { label: 'Esc', code: '\x1b' },
  { label: 'Tab', code: '\t' },
  { label: 'Ctrl+C', code: '\x03' },
  { label: 'Clear', code: '\x0c' },
  { label: '↑', code: '\x1b[A' },
  { label: '↓', code: '\x1b[B' },
];

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type ControlMessage = {
  type: string;
  restored?: boolean;
};

type InitialStreamState = {
  hasSeenVisible: boolean;
  pending: string;
};

// Host-side session, not browser storage. Incognito / another device
// must hit the same id or they spawn a second PTY and "lose" the first.
const SESSION_ID = 'term_main';
const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 15000;

function parseControlMessage(data: unknown): ControlMessage | null {
  if (typeof data !== 'string' || !data.startsWith('{"type":')) return null;
  try {
    const msg = JSON.parse(data) as ControlMessage;
    if (msg && typeof msg.type === 'string') return msg;
  } catch {
    /* raw PTY output */
  }
  return null;
}

function isLeadingWhitespace(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    char === '\r' ||
    char === '\n' ||
    char === ' ' ||
    char === '\t' ||
    char === '\v' ||
    char === '\f' ||
    code === 0
  );
}

// Drop zsh PROMPT_SP fill, Starship add_newline, and cursor/erase setup so the
// first glyph (~) lands at row 0. Keep SGR colors and mode CSI (h/l).
// Only used for brand-new shells — restored scrollback is written as-is.
function cleanInitialStream(raw: string, state: InitialStreamState): string {
  const data = state.pending + raw;
  state.pending = '';
  if (state.hasSeenVisible) return data;

  let result = '';
  let i = 0;
  while (i < data.length) {
    if (state.hasSeenVisible) {
      result += data.slice(i);
      break;
    }

    if (isLeadingWhitespace(data[i])) {
      i++;
      continue;
    }

    if (data.charCodeAt(i) === 0x1b) {
      if (i + 1 >= data.length) {
        state.pending = data.slice(i);
        break;
      }

      const next = data[i + 1];

      if (next === ']') {
        const bel = data.indexOf('\x07', i);
        const st = data.indexOf('\x1b\\', i);
        let end = -1;
        if (bel !== -1 && st !== -1) end = Math.min(bel + 1, st + 2);
        else if (bel !== -1) end = bel + 1;
        else if (st !== -1) end = st + 2;
        if (end === -1) {
          state.pending = data.slice(i);
          break;
        }
        result += data.slice(i, end);
        i = end;
        continue;
      }

      if (next === '[') {
        let j = i + 2;
        while (j < data.length && (data.charCodeAt(j) < 0x40 || data.charCodeAt(j) > 0x7e)) {
          j++;
        }
        if (j >= data.length) {
          state.pending = data.slice(i);
          break;
        }
        const final = data[j];
        if (final === 'm' || final === 'h' || final === 'l') {
          result += data.slice(i, j + 1);
        }
        i = j + 1;
        continue;
      }

      if (next === '(' || next === ')' || next === '*' || next === '+') {
        if (i + 2 >= data.length) {
          state.pending = data.slice(i);
          break;
        }
        i += 3;
        continue;
      }

      i += 2;
      continue;
    }

    state.hasSeenVisible = true;
    result += data[i];
    i++;
  }

  return result;
}

export default function TerminalApp() {
  const isMobile = useIsMobile();
  const terminalRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unmountedRef = useRef(false);
  const suppressReconnectRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectSocketRef = useRef<(term: Terminal) => void>(() => {});
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const syncDimensions = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current) {
      try {
        fitAddonRef.current.fit();
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: 'resize',
              cols: xtermRef.current.cols,
              rows: xtermRef.current.rows,
            })
          );
        }
      } catch {
        /* ignore layout errors during resize */
      }
    }
  }, []);

  // Listen to visualViewport resize events (triggered when mobile keyboard opens/closes)
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    const handleViewportResize = () => {
      syncDimensions();
      requestAnimationFrame(() => {
        syncDimensions();
      });
    };

    visualViewport.addEventListener('resize', handleViewportResize);
    visualViewport.addEventListener('scroll', handleViewportResize);

    return () => {
      visualViewport.removeEventListener('resize', handleViewportResize);
      visualViewport.removeEventListener('scroll', handleViewportResize);
    };
  }, [syncDimensions]);

  const lastSoftKeyHandledRef = useRef<number>(0);

  const handleSoftKey = useCallback((code: string) => {
    lastSoftKeyHandledRef.current = Date.now();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(code);
    }
    if (code === '\x0c') {
      xtermRef.current?.clear();
    }
    if (xtermRef.current) {
      xtermRef.current.focus();
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current || suppressReconnectRef.current) return;
    if (reconnectTimerRef.current !== null) return;
    const delay = Math.min(
      BASE_RECONNECT_MS * 2 ** reconnectAttemptRef.current,
      MAX_RECONNECT_MS
    );
    reconnectAttemptRef.current += 1;
    setStatus('connecting');
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (unmountedRef.current || suppressReconnectRef.current) return;
      if (xtermRef.current) connectSocketRef.current(xtermRef.current);
    }, delay);
  }, []);

  const connectSocket = useCallback((term: Terminal) => {
    clearReconnectTimer();

    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      if (
        socketRef.current.readyState === WebSocket.OPEN ||
        socketRef.current.readyState === WebSocket.CONNECTING
      ) {
        socketRef.current.close();
      }
      socketRef.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/terminal?sessionId=${encodeURIComponent(SESSION_ID)}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    const streamState: InitialStreamState = { hasSeenVisible: false, pending: '' };
    let sawHello = false;

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
    };

    socket.onmessage = (event) => {
      const control = parseControlMessage(event.data);

      if (control?.type === 'session') {
        sawHello = true;
        const restored = Boolean(control.restored);
        streamState.hasSeenVisible = restored;
        streamState.pending = '';
        term.reset();
        setStatus('connected');
        syncDimensions();
        return;
      }
      if (control?.type === 'exit') {
        suppressReconnectRef.current = true;
        clearReconnectTimer();
        setStatus('disconnected');
        return;
      }

      if (typeof event.data === 'string') {
        const payload =
          sawHello && !streamState.hasSeenVisible
            ? cleanInitialStream(event.data, streamState)
            : event.data;
        term.write(payload);
      } else {
        term.write(event.data);
      }
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      if (unmountedRef.current) return;
      if (suppressReconnectRef.current) {
        setStatus('disconnected');
        return;
      }
      scheduleReconnect();
    };

    socket.onerror = () => {
      /* onclose handles retry */
    };
  }, [clearReconnectTimer, scheduleReconnect, syncDimensions]);

  useEffect(() => {
    connectSocketRef.current = connectSocket;
  }, [connectSocket]);

  useEffect(() => {
    unmountedRef.current = false;
    suppressReconnectRef.current = false;
    reconnectAttemptRef.current = 0;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      scrollback: 10000,
      fontFamily: "'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
      customGlyphs: true,
      theme: {
        background: '#000000',
        foreground: '#ededed',
        cursor: '#ededed',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(255, 255, 255, 0.18)',
        black: '#000000',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#ededed',
        brightBlack: '#666666',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    if (terminalRef.current) {
      term.open(terminalRef.current);
      try {
        fitAddon.fit();
      } catch {
        /* ignore fit error during initial mount */
      }
    }

    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(() => {
        if (!unmountedRef.current) syncDimensions();
      });
    }

    connectSocket(term);

    const dataDisposable = term.onData((data) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(data);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      syncDimensions();
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    const onOnline = () => {
      if (unmountedRef.current || suppressReconnectRef.current) return;
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) return;
      reconnectAttemptRef.current = 0;
      setStatus('connecting');
      connectSocketRef.current(term);
    };
    window.addEventListener('online', onOnline);

    return () => {
      unmountedRef.current = true;
      window.removeEventListener('online', onOnline);
      clearReconnectTimer();
      resizeObserver.disconnect();
      dataDisposable.dispose();
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        if (
          socketRef.current.readyState === WebSocket.OPEN ||
          socketRef.current.readyState === WebSocket.CONNECTING
        ) {
          socketRef.current.close();
        }
        socketRef.current = null;
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [clearReconnectTimer, connectSocket, syncDimensions]);

  const handleClear = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      // Send Ctrl+L to the shell — it will clear the screen and repaint
      // the full prompt (both directory info line and > cursor line).
      // We intentionally do NOT call xterm.clear() because that would
      // wipe the scrollback before the shell has a chance to redraw.
      socketRef.current.send('\x0c');
    }
    if (xtermRef.current) {
      xtermRef.current.focus();
    }
  };

  const handleReconnect = () => {
    suppressReconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    setStatus('connecting');
    if (xtermRef.current) {
      connectSocket(xtermRef.current);
      xtermRef.current.focus();
    }
  };

  const handleKill = () => {
    suppressReconnectRef.current = false;
    clearReconnectTimer();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'kill' }));
    } else if (xtermRef.current) {
      reconnectAttemptRef.current = 0;
      setStatus('connecting');
      connectSocket(xtermRef.current);
    }
    if (xtermRef.current) {
      xtermRef.current.reset();
      xtermRef.current.focus();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.headerBar}>
        <div className={styles.tabsGroup}>
          <div className={styles.tabBadge}>
            <span
              className={
                status === 'connected'
                  ? styles.statusDotConnected
                  : status === 'connecting'
                    ? styles.statusDotConnecting
                    : styles.statusDotDisconnected
              }
            />
            <span className={styles.tabTitle}>bash</span>
          </div>
        </div>

        <div className={styles.actionsGroup}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={handleClear}
            title="Clear terminal"
          >
            <Trash2 size={12} />
            <span>Clear</span>
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            onClick={handleKill}
            title="Kill & restart session"
          >
            <Power size={12} />
            <span>Kill</span>
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={handleReconnect}
            title="Reconnect session"
          >
            <RefreshCw size={12} />
            <span>Reconnect</span>
          </button>
        </div>
      </div>

      <div
        className={styles.terminalWrapper}
        onClick={() => {
          xtermRef.current?.focus();
        }}
      >
        <div ref={terminalRef} className={styles.terminalCanvas} />
      </div>

      {isMobile && (
        <div className={styles.mobileSoftKeyBar} role="toolbar" aria-label="Terminal touch helpers">
          {SOFT_KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              className={styles.softKeyBtn}
              onPointerDown={(e) => {
                e.preventDefault();
                handleSoftKey(key.code);
              }}
              onClick={() => {
                if (Date.now() - lastSoftKeyHandledRef.current < 250) return;
                handleSoftKey(key.code);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSoftKey(key.code);
                }
              }}
              aria-label={`Send ${key.label}`}
            >
              {key.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
