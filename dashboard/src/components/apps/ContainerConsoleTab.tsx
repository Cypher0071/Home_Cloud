import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AlertCircle } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import styles from './docker.module.css';

interface ContainerConsoleTabProps {
  containerId: string;
  containerName: string;
  isRunning: boolean;
}

export default function ContainerConsoleTab({ containerId, containerName, isRunning }: ContainerConsoleTabProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!isRunning || !containerId) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 12,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      letterSpacing: 0,
      lineHeight: 1.25,
      theme: {
        background: '#000000',
        foreground: '#ededed',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(255, 255, 255, 0.25)',
        black: '#171717',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#facc15',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#ededed',
        brightBlack: '#737373',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fde047',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
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
        // ignore resize measurement errors during initial render
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/docker/exec?containerId=${encodeURIComponent(containerId)}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      term.write(`\r\n\x1b[1;37m==> Connected to ${containerName} console <==\x1b[0m\r\n\r\n`);
      if (fitAddon && term) {
        try {
          fitAddon.fit();
          socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        } catch {
          // ignore resize errors if disconnected
        }
      }
    };

    socket.onmessage = (event) => {
      term.write(event.data);
    };

    socket.onclose = () => {
      term.write('\r\n\x1b[1;31m==> Console session ended <==\x1b[0m\r\n');
    };

    socket.onerror = () => {
      term.write('\r\n\x1b[1;31m==> Console connection error <==\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        if (fitAddonRef.current && xtermRef.current) {
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
        }
      } catch {
        // ignore resize errors if container detached
      }
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, [containerId, isRunning, containerName]);

  if (!isRunning) {
    return (
      <div className={styles.comingSoon}>
        <AlertCircle size={24} style={{ color: 'var(--text-muted, #737373)' }} />
        <span className={styles.comingSoonText}>
          Interactive shell unavailable. Container is currently stopped.
        </span>
      </div>
    );
  }

  return (
    <div className={styles.consoleWrapper}>
      <div ref={terminalRef} className={styles.consoleInner} />
    </div>
  );
}
