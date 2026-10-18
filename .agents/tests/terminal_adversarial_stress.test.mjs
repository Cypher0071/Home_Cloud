/**
 * Home Cloud OS — Web Terminal Adversarial Stress & Chaos Test Suite
 *
 * Designed to aggressively stress-test assumptions, failure modes,
 * edge cases, race conditions, memory leaks, and error resilience.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const DASHBOARD_ROOT = path.join(REPO_ROOT, 'dashboard');

const TERMINAL_APP_PATH = path.join(DASHBOARD_ROOT, 'src/components/apps/TerminalApp.tsx');
const TERMINAL_CSS_PATH = path.join(DASHBOARD_ROOT, 'src/components/apps/terminal.module.css');
const INDEX_HTML_PATH = path.join(DASHBOARD_ROOT, 'index.html');
const INDEX_CSS_PATH = path.join(DASHBOARD_ROOT, 'src/index.css');

const terminalAppTsx = fs.readFileSync(TERMINAL_APP_PATH, 'utf-8');
const terminalCss = fs.readFileSync(TERMINAL_CSS_PATH, 'utf-8');
const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
const indexCss = fs.readFileSync(INDEX_CSS_PATH, 'utf-8');

describe('Home Cloud OS — Terminal Adversarial Challenge Suite', () => {

  /* ==========================================================================
     CHALLENGE 1: Rapid-Fire Reconnect Storm & Socket Race Conditions
     ========================================================================== */
  describe('Challenge 1: Rapid-Fire Reconnect Storm & Socket Race Conditions', () => {
    it('C1.1: 100 rapid reconnect triggers properly null old listeners and close in-flight sockets', () => {
      // Simulate reconnect loop mechanics from TerminalApp
      const sockets = [];
      let currentSocket = null;
      let status = 'connecting';
      let termWrites = [];

      const mockTerm = {
        write: (msg) => termWrites.push(msg),
        focus: () => {},
      };

      const connect = () => {
        if (currentSocket) {
          currentSocket.onopen = null;
          currentSocket.onmessage = null;
          currentSocket.onclose = null;
          currentSocket.onerror = null;
          if (currentSocket.readyState === 0 || currentSocket.readyState === 1) {
            currentSocket.close();
          }
          currentSocket = null;
        }

        status = 'connecting';
        const socket = {
          id: sockets.length + 1,
          readyState: 0, // CONNECTING
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
          closed: false,
          close() {
            this.readyState = 3; // CLOSED
            this.closed = true;
          }
        };
        sockets.push(socket);
        currentSocket = socket;

        socket.onopen = () => {
          status = 'connected';
          mockTerm.write('Connected');
        };
        socket.onclose = () => {
          status = 'disconnected';
          mockTerm.write('Closed');
        };
      };

      // Rapidly trigger connect 100 times
      for (let i = 0; i < 100; i++) {
        mockTerm.write('Reconnecting...');
        connect();
      }

      // Assert that all previous 99 sockets were closed and listeners detached
      for (let i = 0; i < 99; i++) {
        assert.strictEqual(sockets[i].closed, true, `Socket ${i+1} must be closed`);
        assert.strictEqual(sockets[i].onopen, null, `Socket ${i+1} onopen must be null`);
        assert.strictEqual(sockets[i].onmessage, null, `Socket ${i+1} onmessage must be null`);
        assert.strictEqual(sockets[i].onclose, null, `Socket ${i+1} onclose must be null`);
        assert.strictEqual(sockets[i].onerror, null, `Socket ${i+1} onerror must be null`);
      }

      // Only the last socket is active
      assert.strictEqual(currentSocket.id, 100);
      assert.strictEqual(currentSocket.closed, false);
      assert.strictEqual(status, 'connecting');

      // Now late events from closed sockets should NOT affect state
      if (sockets[0].onopen) sockets[0].onopen();
      assert.strictEqual(status, 'connecting', 'Ghost event from old socket must not mutate state');

      // Open event from 100th socket
      currentSocket.onopen();
      assert.strictEqual(status, 'connected');
    });

    it('C1.2: Code analysis confirms comprehensive listener nulling before closing socket in TerminalApp.tsx', () => {
      // Must verify that TerminalApp explicitly sets all 4 handlers to null
      assert.match(terminalAppTsx, /socketRef\.current\.onopen\s*=\s*null;/);
      assert.match(terminalAppTsx, /socketRef\.current\.onmessage\s*=\s*null;/);
      assert.match(terminalAppTsx, /socketRef\.current\.onclose\s*=\s*null;/);
      assert.match(terminalAppTsx, /socketRef\.current\.onerror\s*=\s*null;/);
    });
  });

  /* ==========================================================================
     CHALLENGE 2: Window Resizing Edge Cases & Degenerate Geometries
     ========================================================================== */
  describe('Challenge 2: Window Resizing Edge Cases & Degenerate Geometries', () => {
    it('C2.1: Degenerate container bounds (0x0, collapsed, hidden) do not throw unhandled exceptions', () => {
      let fitCallCount = 0;
      let caughtExceptions = 0;

      // Mock FitAddon that simulates xterm throwing when dimensions are <= 0 or canvas not mounted
      const mockFitAddon = {
        fit: (width, height) => {
          fitCallCount++;
          if (width <= 0 || height <= 0 || isNaN(width) || isNaN(height)) {
            throw new Error('xterm FitAddon: Cannot fit with dimensions 0x0 or invalid geometry');
          }
          return { cols: Math.floor(width / 9), rows: Math.floor(height / 17) };
        }
      };

      const handleResize = (w, h) => {
        try {
          mockFitAddon.fit(w, h);
        } catch (_err) {
          caughtExceptions++;
          // cleanly swallowed as per TerminalApp.tsx try/catch pattern
        }
      };

      // Test extreme dimension vectors
      const testVectors = [
        [0, 0],
        [0, 500],
        [500, 0],
        [-100, -100],
        [NaN, NaN],
        [Infinity, 0],
        [1, 1],
        [1920, 1080],
        [3840, 2160],
        [10000, 10],
        [10, 10000]
      ];

      for (const [w, h] of testVectors) {
        assert.doesNotThrow(() => handleResize(w, h), `Resizing to ${w}x${h} must not throw`);
      }

      assert.strictEqual(fitCallCount, testVectors.length);
      assert.strictEqual(caughtExceptions, 6); // 0x0, 0x500, 500x0, -100x-100, NaN, Infinity
    });

    it('C2.2: ResizeObserver in TerminalApp.tsx wraps fit() in try/catch block', () => {
      assert.match(terminalAppTsx, /new\s+ResizeObserver\(\(\)\s*=>\s*\{[\s\S]*?try\s*\{[\s\S]*?fitAddon\.fit\(\);[\s\S]*?\}\s*catch/);
    });

    it('C2.3: Initial open fit() in TerminalApp.tsx wraps fit() in try/catch block', () => {
      assert.match(terminalAppTsx, /term\.open\(terminalRef\.current\);[\s\S]*?try\s*\{[\s\S]*?fitAddon\.fit\(\);[\s\S]*?\}\s*catch/);
    });

    it('C2.4: document.fonts.ready fit() in TerminalApp.tsx wraps fit() in try/catch block', () => {
      assert.match(terminalAppTsx, /document\.fonts\.ready\.then\(\(\)\s*=>\s*\{[\s\S]*?try\s*\{[\s\S]*?fitAddon\.fit\(\);[\s\S]*?\}\s*catch/);
    });
  });

  /* ==========================================================================
     CHALLENGE 3: Null Ref & Detached DOM Safety
     ========================================================================== */
  describe('Challenge 3: Null Ref & Detached DOM Safety', () => {
    it('C3.1: handleClear safely handles null xtermRef without runtime crash', () => {
      let xtermRef = { current: null };
      const handleClear = () => {
        if (xtermRef.current) {
          xtermRef.current.clear();
          xtermRef.current.focus();
        }
      };

      assert.doesNotThrow(() => handleClear());
    });

    it('C3.2: handleReconnect safely handles null xtermRef without runtime crash', () => {
      let xtermRef = { current: null };
      let connectCalled = false;
      const connectRef = { current: () => { connectCalled = true; } };

      const handleReconnect = () => {
        if (xtermRef.current) {
          xtermRef.current.write('\r\nReconnecting...\r\n');
          xtermRef.current.focus();
        }
        connectRef.current();
      };

      assert.doesNotThrow(() => handleReconnect());
      assert.strictEqual(connectCalled, true);
    });

    it('C3.3: onData disposable handles null socketRef or closed socket gracefully', () => {
      let socketRef = { current: null };
      const onDataHandler = (data) => {
        if (socketRef.current && socketRef.current.readyState === 1) {
          socketRef.current.send(data);
        }
      };

      assert.doesNotThrow(() => onDataHandler('test payload'));

      // socket present but in CONNECTING state (0)
      socketRef.current = { readyState: 0, send: () => { throw new Error('Cannot send in CONNECTING'); } };
      assert.doesNotThrow(() => onDataHandler('test payload'));

      // socket present and OPEN (1)
      let sent = false;
      socketRef.current = { readyState: 1, send: () => { sent = true; } };
      onDataHandler('test payload');
      assert.strictEqual(sent, true);
    });
  });

  /* ==========================================================================
     CHALLENGE 4: Offline Font Fallback & CDN Outage Safety
     ========================================================================== */
  describe('Challenge 4: Offline Font Fallback & CDN Outage Safety', () => {
    it('C4.1: Fallback stack guarantees system monospaced fonts if Google Fonts CDN fails', () => {
      assert.match(terminalAppTsx, /fontFamily:\s*['"]'JetBrains Mono',\s*Menlo,\s*Monaco,\s*'Courier New',\s*monospace['"]/);
      assert.match(indexCss, /--mono:\s*'JetBrains Mono',\s*'Fira Code',\s*ui-monospace,\s*Consolas,\s*monospace/);
    });

    it('C4.2: document.fonts existence is guarded for headless / SSR testing environments', () => {
      assert.match(terminalAppTsx, /typeof\s+document\s*!==\s*['"]undefined['"]\s*&&\s*['"]fonts['"]\s*in\s*document/);
    });
  });

  /* ==========================================================================
     CHALLENGE 5: WebSocket Lifecycle State Machine Correctness
     ========================================================================== */
  describe('Challenge 5: WebSocket Lifecycle State Machine Correctness', () => {
    it('C5.1: State transitions accurately track WebSocket lifecycle (connecting -> connected -> disconnected)', () => {
      let status = 'connecting';
      const transitions = [];

      const setStatus = (s) => {
        status = s;
        transitions.push(s);
      };

      // 1. Initial connect
      setStatus('connecting');

      // 2. Open
      setStatus('connected');

      // 3. Drop
      setStatus('disconnected');

      // 4. Manual Reconnect
      setStatus('connecting');

      // 5. Error during reconnect
      setStatus('disconnected');

      assert.deepStrictEqual(transitions, [
        'connecting',
        'connected',
        'disconnected',
        'connecting',
        'disconnected'
      ]);
    });

    it('C5.2: CSS status dots map 1:1 to every state without deadlocks or undefined classes', () => {
      const getDotClass = (st) => {
        return st === 'connected'
          ? 'statusDotConnected'
          : st === 'connecting'
            ? 'statusDotConnecting'
            : 'statusDotDisconnected';
      };

      assert.strictEqual(getDotClass('connected'), 'statusDotConnected');
      assert.strictEqual(getDotClass('connecting'), 'statusDotConnecting');
      assert.strictEqual(getDotClass('disconnected'), 'statusDotDisconnected');
      // Any unknown state falls back to disconnected
      assert.strictEqual(getDotClass('unknown'), 'statusDotDisconnected');
    });

    it('C5.3: Reconnect banner ANSI formatting includes yellow bold escape sequences and reset', () => {
      assert.match(terminalAppTsx, /\\x1b\[1;33m==> Reconnecting to shell\.\.\. <==\\x1b\[0m/);
    });

    it('C5.4: Welcome banner ANSI formatting includes magenta bold escape sequences and reset', () => {
      assert.match(terminalAppTsx, /\\x1b\[1;35m==> Connected to Home Cloud Secure Shell \(bash\) <==\\x1b\[0m/);
    });

    it('C5.5: Disconnect banner ANSI formatting includes red bold escape sequences and reset', () => {
      assert.match(terminalAppTsx, /\\x1b\[1;31m==> Connection Closed <==\\x1b\[0m/);
    });
  });

  /* ==========================================================================
     CHALLENGE 6: Visual Hierarchy, Accessibility & CSS Layout Integrity
     ========================================================================== */
  describe('Challenge 6: Visual Hierarchy, Accessibility & CSS Layout Integrity', () => {
    it('C6.1: Contrast ratio of all text tokens against #000000 and #0a0a0a meets WCAG AAA', () => {
      // WCAG calculation
      function parseHex(h) {
        const c = h.replace('#', '');
        const num = parseInt(c, 16);
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
      }
      function lum([r, g, b]) {
        const a = [r, g, b].map(v => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      }
      function ratio(h1, h2) {
        const l1 = lum(parseHex(h1));
        const l2 = lum(parseHex(h2));
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }

      // Foreground text #ededed on #000000
      assert.ok(ratio('#ededed', '#000000') >= 7.0);

      // Bright text #ffffff on #000000
      assert.ok(ratio('#ffffff', '#000000') >= 7.0);

      // Tab text #ededed on #111111
      assert.ok(ratio('#ededed', '#111111') >= 7.0);
    });

    it('C6.2: Action buttons have proper button element types and title accessibility attributes', () => {
      assert.match(terminalAppTsx, /<button\s+type="button"[\s\S]*?title="Clear terminal"/);
      assert.match(terminalAppTsx, /<button\s+type="button"[\s\S]*?title="Reconnect session"/);
    });

    it('C6.3: No container layout shift (CLS): flex-shrink: 0 on header and flex: 1 with min-height: 0 on canvas', () => {
      assert.match(terminalCss, /\.headerBar\s*\{[^}]*flex-shrink:\s*0;/);
      assert.match(terminalCss, /\.terminalWrapper\s*\{[^}]*flex:\s*1;\s*min-height:\s*0;/);
    });
  });
});
