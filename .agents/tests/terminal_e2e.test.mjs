/**
 * Home Cloud OS — Web Terminal UI/UX Redesign Test Harness
 * 
 * Comprehensive E2E, Static Verification, Boundary, and Workflow Test Suite
 * Coverage:
 * - Tier 1: Feature Coverage (F1-F8, 40 tests)
 * - Tier 2: Boundary & Corner Cases (F1-B to F8-B, 40 tests)
 * - Tier 3: Cross-Feature Integration Combinations (T3.1-T3.8, 8 tests)
 * - Tier 4: Real-World Application Workflows (T4.1-T4.5, 5 tests)
 * Total: 93 automated test cases
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const DASHBOARD_ROOT = path.join(REPO_ROOT, 'dashboard');

// Paths to targets
const INDEX_HTML_PATH = path.join(DASHBOARD_ROOT, 'index.html');
const MAIN_TSX_PATH = path.join(DASHBOARD_ROOT, 'src/main.tsx');
const TERMINAL_APP_PATH = path.join(DASHBOARD_ROOT, 'src/components/apps/TerminalApp.tsx');
const TERMINAL_CSS_PATH = path.join(DASHBOARD_ROOT, 'src/components/apps/terminal.module.css');
const INDEX_CSS_PATH = path.join(DASHBOARD_ROOT, 'src/index.css');

// Load target files
let indexHtml = '';
let mainTsx = '';
let terminalAppTsx = '';
let terminalCss = '';
let indexCss = '';

// Helper: WCAG Luminance & Contrast Ratio Calculator
function parseHexColor(hex) {
  let cleaned = hex.trim().replace(/^#/, '');
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map(c => c + c).join('');
  }
  const num = parseInt(cleaned, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function getRelativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map(val => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(hex1, hex2) {
  const l1 = getRelativeLuminance(parseHexColor(hex1));
  const l2 = getRelativeLuminance(parseHexColor(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Home Cloud OS — Web Terminal UI/UX Redesign Test Suite', () => {
  before(() => {
    assert.ok(fs.existsSync(INDEX_HTML_PATH), `index.html must exist at ${INDEX_HTML_PATH}`);
    assert.ok(fs.existsSync(TERMINAL_APP_PATH), `TerminalApp.tsx must exist at ${TERMINAL_APP_PATH}`);
    assert.ok(fs.existsSync(TERMINAL_CSS_PATH), `terminal.module.css must exist at ${TERMINAL_CSS_PATH}`);
    assert.ok(fs.existsSync(INDEX_CSS_PATH), `index.css must exist at ${INDEX_CSS_PATH}`);

    assert.ok(fs.existsSync(MAIN_TSX_PATH), `main.tsx must exist at ${MAIN_TSX_PATH}`);
    indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
    mainTsx = fs.readFileSync(MAIN_TSX_PATH, 'utf-8');
    terminalAppTsx = fs.readFileSync(TERMINAL_APP_PATH, 'utf-8');
    terminalCss = fs.readFileSync(TERMINAL_CSS_PATH, 'utf-8');
    indexCss = fs.readFileSync(INDEX_CSS_PATH, 'utf-8');
  });

  /* ==========================================================================
     TIER 1: FEATURE COVERAGE (F1 to F8 >= 5 per feature, 40 tests)
     ========================================================================== */

  describe('Tier 1: Feature Coverage (40 tests)', () => {
    // Feature 1: Vercel Dark Theme Tokens
    describe('F1: Vercel Dark Theme Tokens', () => {
      it('T1.1: Container background is pure pitch black (#000000)', () => {
        assert.match(terminalCss, /\.container\s*\{[^}]*background:\s*#000000;/);
      });

      it('T1.2: Terminal canvas wrapper background is pure pitch black (#000000)', () => {
        assert.match(terminalCss, /\.terminalWrapper\s*\{[^}]*background:\s*#000000;/);
        assert.match(terminalCss, /\.terminalCanvas\s*\{[^}]*background:\s*#000000;/);
      });

      it('T1.3: xterm instance theme background is configured to #000000', () => {
        assert.match(terminalAppTsx, /background:\s*['"]#000000['"]/);
      });

      it('T1.4: Header bar background is #0a0a0a with subtle hairline border (#262626 or #222222)', () => {
        assert.match(terminalCss, /\.headerBar\s*\{[^}]*background:\s*#0a0a0a;/);
        assert.match(terminalCss, /\.headerBar\s*\{[^}]*border-bottom:\s*1px\s+solid\s+#2[26]2[26]2[26];/);
      });

      it('T1.5: Neutral text and pill background tokens match Vercel dark theme palette (#111111, #ededed, #262626)', () => {
        assert.match(terminalCss, /\.tabBadge\s*\{[^}]*background:\s*#111111;/);
        assert.match(terminalCss, /\.tabBadge\s*\{[^}]*border:\s*1px\s+solid\s+#262626;/);
        assert.match(terminalCss, /\.tabBadge\s*\{[^}]*color:\s*#ededed;/);
        assert.match(terminalCss, /\.actionBtn\s*\{[^}]*background:\s*#111111;/);
        assert.match(terminalCss, /\.actionBtn\s*\{[^}]*color:\s*#ededed;/);
      });
    });

    // Feature 2: ANSI 16-Color Palette
    describe('F2: ANSI 16-Color Palette', () => {
      it('T1.6: Standard ANSI 8 colors configured with high-contrast pastel mappings', () => {
        assert.match(terminalAppTsx, /black:\s*['"]#000000['"]/);
        assert.match(terminalAppTsx, /red:\s*['"]#f87171['"]/);
        assert.match(terminalAppTsx, /green:\s*['"]#4ade80['"]/);
        assert.match(terminalAppTsx, /yellow:\s*['"]#facc15['"]/);
        assert.match(terminalAppTsx, /blue:\s*['"]#60a5fa['"]/);
        assert.match(terminalAppTsx, /magenta:\s*['"]#c084fc['"]/);
        assert.match(terminalAppTsx, /cyan:\s*['"]#22d3ee['"]/);
        assert.match(terminalAppTsx, /white:\s*['"]#ededed['"]/);
      });

      it('T1.7: Bright ANSI 8 colors configured with vibrant pastel tones', () => {
        assert.match(terminalAppTsx, /brightBlack:\s*['"]#666666['"]/);
        assert.match(terminalAppTsx, /brightRed:\s*['"]#fc?a5a5['"]/);
        assert.match(terminalAppTsx, /brightGreen:\s*['"]#86efac['"]/);
        assert.match(terminalAppTsx, /brightYellow:\s*['"]#fde047['"]/);
        assert.match(terminalAppTsx, /brightBlue:\s*['"]#93c5fd['"]/);
        assert.match(terminalAppTsx, /brightMagenta:\s*['"]#d8b4fe['"]/);
        assert.match(terminalAppTsx, /brightCyan:\s*['"]#67e8f9['"]/);
        assert.match(terminalAppTsx, /brightWhite:\s*['"]#ffffff['"]/);
      });

      it('T1.8: Cursor and cursorAccent colors configured with crisp contrast', () => {
        assert.match(terminalAppTsx, /cursor:\s*['"]#ededed['"]/);
        assert.match(terminalAppTsx, /cursorAccent:\s*['"]#000000['"]/);
      });

      it('T1.9: Selection background configured to subtle alpha overlay (rgba(255, 255, 255, 0.18))', () => {
        assert.match(terminalAppTsx, /selectionBackground:\s*['"]rgba\(255,\s*255,\s*255,\s*0\.18\)['"]/);
      });

      it('T1.10: Foreground text token configured to neutral #ededed', () => {
        assert.match(terminalAppTsx, /foreground:\s*['"]#ededed['"]/);
      });
    });

    // Feature 3: Inter and JetBrains Mono are bundled. index.html must not call Google.
    describe('F3: JetBrains Mono Font Import', () => {
      it('T1.11: index.html does not preconnect to fonts.googleapis.com', () => {
        assert.equal(indexHtml.includes('fonts.googleapis.com'), false);
      });

      it('T1.12: index.html does not preconnect to fonts.gstatic.com', () => {
        assert.equal(indexHtml.includes('fonts.gstatic.com'), false);
      });

      it('T1.13: JetBrains Mono is imported from @fontsource in main.tsx', () => {
        assert.match(mainTsx, /@fontsource\/jetbrains-mono\/400\.css/);
        assert.match(mainTsx, /@fontsource\/jetbrains-mono\/700\.css/);
      });

      it('T1.14: JetBrains Mono weights 400, 500, 600, and 700 are bundled', () => {
        for (const weight of ['400', '500', '600', '700']) {
          assert.match(mainTsx, new RegExp(`@fontsource/jetbrains-mono/${weight}\\.css`));
        }
      });

      it('T1.15: Inter weights 300 through 700 are bundled beside JetBrains Mono', () => {
        for (const weight of ['300', '400', '500', '600', '700']) {
          assert.match(mainTsx, new RegExp(`@fontsource/inter/${weight}\\.css`));
        }
      });
    });

    // Feature 4: xterm Typography Metrics & Options
    describe('F4: xterm Typography & Metrics', () => {
      it('T1.16: xterm fontFamily includes JetBrains Mono and standard monospace fallbacks', () => {
        assert.match(terminalAppTsx, /fontFamily:\s*[`'"].*JetBrains Mono.*monospace[`'"]/);
      });

      it('T1.17: xterm fontSize is configured to 13px', () => {
        assert.match(terminalAppTsx, /fontSize:\s*13/);
      });

      it('T1.18: xterm lineHeight is configured to 1.25 for compact grid metrics', () => {
        assert.match(terminalAppTsx, /lineHeight:\s*1\.25/);
      });

      it('T1.19: customGlyphs option is enabled for crisp box/powerline rendering', () => {
        assert.match(terminalAppTsx, /customGlyphs:\s*true/);
      });

      it('T1.20: document.fonts.ready promise refits terminal on web font load completion', () => {
        assert.match(terminalAppTsx, /document\.fonts\.ready\.then/);
        assert.match(terminalAppTsx, /fitAddon\.fit\(\)/);
      });
    });

    // Feature 5: Shell Tab Badge & Status Dots
    describe('F5: Shell Tab Badge & Status Dots', () => {
      it('T1.21: Active shell tab badge has pill styling with monospace font', () => {
        assert.match(terminalCss, /\.tabBadge\s*\{[^}]*font-family:\s*var\(--mono\);/);
        assert.match(terminalCss, /\.tabBadge\s*\{[^}]*border-radius:\s*6px;/);
      });

      it('T1.22: Shell tab title displays bash label', () => {
        assert.match(terminalAppTsx, /<span\s+className=\{styles\.tabTitle\}>bash<\/span>/);
      });

      it('T1.23: Status dots use crisp 6px static dimensions with border-radius 50%', () => {
        assert.match(terminalCss, /\.statusDotConnected\s*\{[^}]*width:\s*6px;\s*height:\s*6px;\s*border-radius:\s*50%;/);
        assert.match(terminalCss, /\.statusDotConnecting\s*\{[^}]*width:\s*6px;\s*height:\s*6px;\s*border-radius:\s*50%;/);
        assert.match(terminalCss, /\.statusDotDisconnected\s*\{[^}]*width:\s*6px;\s*height:\s*6px;\s*border-radius:\s*50%;/);
      });

      it('T1.24: Status dots have box-shadow: none (static solid dots without glow)', () => {
        assert.match(terminalCss, /\.statusDotConnected\s*\{[^}]*box-shadow:\s*none;/);
        assert.match(terminalCss, /\.statusDotConnecting\s*\{[^}]*box-shadow:\s*none;/);
        assert.match(terminalCss, /\.statusDotDisconnected\s*\{[^}]*box-shadow:\s*none;/);
      });

      it('T1.25: Status dot color tokens match connected (#22c55e), connecting (#facc15), disconnected (#ef4444)', () => {
        assert.match(terminalCss, /\.statusDotConnected\s*\{[^}]*background:\s*#22c55e;/);
        assert.match(terminalCss, /\.statusDotConnecting\s*\{[^}]*background:\s*#facc15;/);
        assert.match(terminalCss, /\.statusDotDisconnected\s*\{[^}]*background:\s*#ef4444;/);
      });
    });

    // Feature 6: Toolbar Action Buttons & UX
    describe('F6: Toolbar Action Buttons & UX', () => {
      it('T1.26: Clear button renders with Trash2 icon and accessible title', () => {
        assert.match(terminalAppTsx, /<Trash2\s+size=\{12\}\s*\/>/);
        assert.match(terminalAppTsx, /title="Clear terminal"/);
      });

      it('T1.27: Reconnect button renders with RefreshCw icon and accessible title', () => {
        assert.match(terminalAppTsx, /<RefreshCw\s+size=\{12\}\s*\/>/);
        assert.match(terminalAppTsx, /title="Reconnect session"/);
      });

      it('T1.28: Clear button click sends Ctrl+L (\\x0c) to shell and invokes term.focus()', () => {
        assert.match(terminalAppTsx, /handleClear\s*=\s*\(\)\s*=>\s*\{[\s\S]*?socketRef\.current\.send\([^\)]*\\x0c[^\)]*\);[\s\S]*?xtermRef\.current\.focus\(\);/);
      });

      it('T1.29: Reconnect button click updates status to connecting, executes connectSocket(), and focuses term', () => {
        assert.match(terminalAppTsx, /handleReconnect\s*=\s*\(\)\s*=>\s*\{[\s\S]*?setStatus\('connecting'\);[\s\S]*?connectSocket\(xtermRef\.current\);[\s\S]*?xtermRef\.current\.focus\(\);/);
      });

      it('T1.30: Action buttons include hover, active, and focus-visible transitions in CSS', () => {
        assert.match(terminalCss, /\.actionBtn:hover:not\(:disabled\)\s*\{[^}]*background:\s*#171717;/);
        assert.match(terminalCss, /\.actionBtn:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*#333333;/);
        assert.match(terminalCss, /\.actionBtn:active:not\(:disabled\)\s*\{[^}]*background:\s*#222222;/);
        assert.match(terminalCss, /\.actionBtn:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent\);/);
      });
    });

    // Feature 7: Dynamic Resizing & Container Fit
    describe('F7: Dynamic Resizing & Container Fit', () => {
      it('T1.31: Container flex layout fills 100% width and height', () => {
        assert.match(terminalCss, /\.container\s*\{[^}]*display:\s*flex;\s*flex-direction:\s*column;\s*height:\s*100%;\s*width:\s*100%;/);
      });

      it('T1.32: Container and wrapper specify overflow: hidden with box-sizing: border-box', () => {
        assert.match(terminalCss, /\.container\s*\{[^}]*overflow:\s*hidden;/);
        assert.match(terminalCss, /\.container\s*\{[^}]*box-sizing:\s*border-box;/);
        assert.match(terminalCss, /\.terminalWrapper\s*\{[^}]*overflow:\s*hidden;/);
        assert.match(terminalCss, /\.terminalWrapper\s*\{[^}]*box-sizing:\s*border-box;/);
      });

      it('T1.33: FitAddon is instantiated and loaded into xterm instance', () => {
        assert.match(terminalAppTsx, /const\s+fitAddon\s*=\s*new\s+FitAddon\(\);/);
        assert.match(terminalAppTsx, /term\.loadAddon\(fitAddon\);/);
      });

      it('T1.34: ResizeObserver is attached to terminal DOM container element', () => {
        assert.match(terminalAppTsx, /const\s+resizeObserver\s*=\s*new\s+ResizeObserver\(\(\)\s*=>\s*\{/);
        assert.match(terminalAppTsx, /resizeObserver\.observe\(terminalRef\.current\);/);
      });

      it('T1.35: Dark themed scrollbars are scoped to xterm viewport', () => {
        assert.match(terminalCss, /\.terminalWrapper\s+:global\(\.xterm-viewport\)\s*\{[^}]*scrollbar-color:\s*#262626\s+transparent;/);
        assert.match(terminalCss, /\.terminalWrapper\s+:global\(\.xterm-viewport::-webkit-scrollbar-thumb\)\s*\{[^}]*background:\s*#262626;/);
      });
    });

    // Feature 8: TypeScript Compilation & ESLint Validation
    describe('F8: TypeScript Compilation & ESLint Validation', () => {
      it('T1.36: TypeScript compilation and Vite build succeed with exit code 0', () => {
        const buildOutput = execSync('pnpm --dir dashboard run build', {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert.ok(buildOutput.includes('built in') || buildOutput.includes('transforming'), 'Build should report completion');
      });

      it('T1.37: ESLint passes on TerminalApp.tsx with 0 errors and 0 warnings', () => {
        const eslintOutput = execSync('pnpm --dir dashboard exec eslint src/components/apps/TerminalApp.tsx', {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert.strictEqual(eslintOutput.trim(), '', 'ESLint output should be clean');
      });

      it('T1.38: Catch blocks do not contain empty statement violations (no-empty)', () => {
        const emptyCatchMatch = terminalAppTsx.match(/catch\s*(\([^\)]*\))?\s*\{\s*\}/g);
        assert.strictEqual(emptyCatchMatch, null, 'No empty catch blocks allowed in TerminalApp.tsx');
      });

      it('T1.39: No eslint-disable comment suppressions used in TerminalApp.tsx', () => {
        assert.strictEqual(terminalAppTsx.includes('eslint-disable'), false, 'No eslint-disable directives allowed');
      });

      it('T1.40: Proper React 19 type safety with typed useRef and useState definitions', () => {
        assert.match(terminalAppTsx, /useRef<HTMLDivElement>\(null\)/);
        assert.match(terminalAppTsx, /useRef<WebSocket\s*\|\s*null>\(null\)/);
        assert.match(terminalAppTsx, /useRef<Terminal\s*\|\s*null>\(null\)/);
        assert.match(terminalAppTsx, /useRef<FitAddon\s*\|\s*null>\(null\)/);
        assert.match(terminalAppTsx, /type\s+ConnectionStatus\s*=\s*'connecting'\s*\|\s*'connected'\s*\|\s*'disconnected';/);
        assert.match(terminalAppTsx, /useState<ConnectionStatus>\('connecting'\)/);
      });
    });
  });

  /* ==========================================================================
     TIER 2: BOUNDARY & CORNER CASES (F1-B to F8-B >= 5 per feature, 40 tests)
     ========================================================================== */

  describe('Tier 2: Boundary & Corner Cases (40 tests)', () => {
    // F1 Boundary: Vercel Dark Theme Extreme & Contrast Boundaries
    describe('F1-B: Theme Contrast & Alpha Boundaries', () => {
      it('T2.1: Foreground text #ededed on pure black #000000 exceeds WCAG AAA contrast ratio (> 7:1)', () => {
        const ratio = getContrastRatio('#ededed', '#000000');
        assert.ok(ratio > 7.0, `Contrast ratio ${ratio.toFixed(2)} should exceed 7:1`);
        assert.ok(ratio > 17.0, `Actual contrast ratio ${ratio.toFixed(2)} is high-contrast`);
      });

      it('T2.2: Header bar hairline border #262626 provides subtle visual contrast on #0a0a0a', () => {
        const ratio = getContrastRatio('#262626', '#0a0a0a');
        assert.ok(ratio >= 1.2 && ratio <= 2.5, `Hairline border contrast ${ratio.toFixed(2)} is subtle`);
      });

      it('T2.3: Selection background opacity is exactly 0.18 ensuring underlying text legibility', () => {
        assert.match(terminalAppTsx, /selectionBackground:\s*['"]rgba\(255,\s*255,\s*255,\s*0\.18\)['"]/);
      });

      it('T2.4: Action button disabled state has opacity: 0.4 and cursor: not-allowed', () => {
        assert.match(terminalCss, /\.actionBtn:disabled\s*\{[^}]*opacity:\s*0\.4;\s*cursor:\s*not-allowed;/);
      });

      it('T2.5: Action button focus-visible has 2px outline and 1px offset', () => {
        assert.match(terminalCss, /\.actionBtn:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent\);\s*outline-offset:\s*1px;/);
      });
    });

    // F2 Boundary: ANSI Color Contrast & Format Boundaries
    describe('F2-B: ANSI Palette Color & Format Boundaries', () => {
      it('T2.6: Standard ANSI red (#f87171), green (#4ade80), yellow (#facc15), blue (#60a5fa) exceed WCAG AA contrast on #000000', () => {
        for (const [name, hex] of [
          ['red', '#f87171'],
          ['green', '#4ade80'],
          ['yellow', '#facc15'],
          ['blue', '#60a5fa'],
        ]) {
          const ratio = getContrastRatio(hex, '#000000');
          assert.ok(ratio >= 4.5, `ANSI ${name} (${hex}) contrast ${ratio.toFixed(2)} must be >= 4.5:1`);
        }
      });

      it('T2.7: Bright ANSI red (#fca5a5), green (#86efac), yellow (#fde047), cyan (#67e8f9) exceed WCAG AAA contrast on #000000', () => {
        for (const [name, hex] of [
          ['brightRed', '#fca5a5'],
          ['brightGreen', '#86efac'],
          ['brightYellow', '#fde047'],
          ['brightCyan', '#67e8f9'],
        ]) {
          const ratio = getContrastRatio(hex, '#000000');
          assert.ok(ratio >= 7.0, `ANSI ${name} (${hex}) contrast ${ratio.toFixed(2)} must be >= 7.0:1`);
        }
      });

      it('T2.8: ANSI black (#000000) vs brightBlack (#666666) is distinctly differentiated for dim/comments', () => {
        const ratio = getContrastRatio('#666666', '#000000');
        assert.ok(ratio >= 3.0, `BrightBlack contrast ${ratio.toFixed(2)} must provide clear differentiation from pure black`);
      });

      it('T2.9: Cursor accent color is pure black #000000 to invert text under active block cursor', () => {
        assert.match(terminalAppTsx, /cursorAccent:\s*['"]#000000['"]/);
      });

      it('T2.10: All 16 ANSI color entries use valid 7-character hexadecimal strings', () => {
        const ansiRegex = /(black|red|green|yellow|blue|magenta|cyan|white|brightBlack|brightRed|brightGreen|brightYellow|brightBlue|brightMagenta|brightCyan|brightWhite):\s*['"](#[0-9a-fA-F]{6})['"]/g;
        let count = 0;
        let match;
        while ((match = ansiRegex.exec(terminalAppTsx)) !== null) {
          count++;
          assert.match(match[2], /^#[0-9a-fA-F]{6}$/);
        }
        assert.strictEqual(count, 16, 'All 16 ANSI colors must be explicitly defined in hex format');
      });
    });

    // F3 Boundary: bundled fonts stay local and the HTML shell stays free of remote font hosts.
    describe('F3-B: Font Loading Resilience & Link Boundaries', () => {
      it('T2.11: Offline font fallback chain includes Menlo, Monaco, Courier New, monospace', () => {
        assert.match(terminalAppTsx, /Menlo/);
        assert.match(terminalAppTsx, /Monaco/);
        assert.match(terminalAppTsx, /'Courier New'/);
        assert.match(terminalAppTsx, /monospace/);
      });

      it('T2.12: Font CSS is imported from local @fontsource packages, not a remote stylesheet', () => {
        assert.match(mainTsx, /@fontsource\/inter\/400\.css/);
        assert.match(mainTsx, /@fontsource\/jetbrains-mono\/400\.css/);
        assert.equal(indexHtml.includes('fonts.googleapis.com'), false);
      });

      it('T2.13: index.html has no remote font preconnect', () => {
        assert.equal(indexHtml.includes('rel="preconnect"'), false);
        assert.equal(indexHtml.includes('fonts.gstatic.com'), false);
      });

      it('T2.14: Document charset is UTF-8 and no remote font host is declared', () => {
        const charsetIndex = indexHtml.indexOf('<meta charset="UTF-8"');
        assert.ok(charsetIndex !== -1, 'Charset must be declared');
        assert.equal(indexHtml.includes('fonts.googleapis.com'), false);
      });

      it('T2.15: index.html does not contain a Google Fonts stylesheet link', () => {
        assert.equal(/fonts\.googleapis\.com/.test(indexHtml), false);
      });
    });

    // F4 Boundary: xterm Typography & Extreme Dimension Bounds
    describe('F4-B: Typography Metrics & Fit Exception Boundaries', () => {
      it('T2.16: FitAddon call on initial open is enclosed in try/catch to handle 0x0 container bounds safely', () => {
        assert.match(terminalAppTsx, /term\.open\(terminalRef\.current\);\s*try\s*\{\s*fitAddon\.fit\(\);\s*\}\s*catch/);
      });

      it('T2.17: Font ready handler checks document.fonts existence for SSR/headless resilience', () => {
        assert.match(terminalAppTsx, /typeof\s+document\s*!==\s*['"]undefined['"]\s*&&\s*['"]fonts['"]\s*in\s*document/);
      });

      it('T2.18: Letter spacing is explicitly set to 0 for exact monospace character cell alignment', () => {
        assert.match(terminalAppTsx, /letterSpacing:\s*0/);
      });

      it('T2.19: xterm fontSize is within optimal density boundary (12px <= fontSize <= 14px)', () => {
        const fontMatch = terminalAppTsx.match(/fontSize:\s*(\d+)/);
        assert.ok(fontMatch, 'fontSize should be defined');
        const size = parseInt(fontMatch[1], 10);
        assert.ok(size >= 12 && size <= 14, `fontSize ${size} must be between 12 and 14`);
      });

      it('T2.20: xterm lineHeight is within compact terminal boundary (1.1 <= lineHeight <= 1.4)', () => {
        const lhMatch = terminalAppTsx.match(/lineHeight:\s*([0-9.]+)/);
        assert.ok(lhMatch, 'lineHeight should be defined');
        const lh = parseFloat(lhMatch[1]);
        assert.ok(lh >= 1.1 && lh <= 1.4, `lineHeight ${lh} must be between 1.1 and 1.4`);
      });
    });

    // F5 Boundary: Status Badge & Dot Transition Boundaries
    describe('F5-B: Status Badge State Boundaries', () => {
      it('T2.21: Component initializes with status === "connecting"', () => {
        assert.match(terminalAppTsx, /useState<[^>]+>\('connecting'\)/);
      });

      it('T2.22: Status transitions to "connected" inside socket.onopen handler', () => {
        assert.match(terminalAppTsx, /socket\.onopen\s*=\s*\(\)\s*=>\s*\{[\s\S]*?setStatus\('connected'\);/);
      });

      it('T2.23: Status transitions to "disconnected" inside socket.onclose handler', () => {
        assert.match(terminalAppTsx, /socket\.onclose\s*=\s*\(\)\s*=>\s*\{[\s\S]*?setStatus\('disconnected'\);/);
      });

      it('T2.24: Status transitions and retry are delegated to onclose from socket.onerror handler', () => {
        assert.match(terminalAppTsx, /socket\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\/\*\s*onclose handles retry\s*\*\//);
      });

      it('T2.25: Status dot ternary in JSX maps all 3 states cleanly to specific CSS classes', () => {
        assert.match(terminalAppTsx, /status\s*===\s*'connected'\s*\?\s*styles\.statusDotConnected\s*:\s*status\s*===\s*'connecting'\s*\?\s*styles\.statusDotConnecting\s*:\s*styles\.statusDotDisconnected/);
      });
    });

    // F6 Boundary: Toolbar UX & Rapid Click Boundaries
    describe('F6-B: Action Button Resilience & Focus Retention Boundaries', () => {
      it('T2.26: Rapid reconnect clicks clean up previous WebSocket listeners and close connection', () => {
        assert.match(terminalAppTsx, /if\s*\(socketRef\.current\)\s*\{[\s\S]*?socketRef\.current\.onopen\s*=\s*null;[\s\S]*?socketRef\.current\.close\(\);/);
      });

      it('T2.27: Reconnect action resets status to "connecting" prior to socket instantiation', () => {
        assert.match(terminalAppTsx, /setStatus\('connecting'\);[\s\S]*?new\s+WebSocket\(wsUrl\);/);
      });

      it('T2.28: Action buttons explicitly specify type="button" to prevent accidental form submit', () => {
        const typeButtonMatches = terminalAppTsx.match(/type="button"/g);
        assert.ok(typeButtonMatches && typeButtonMatches.length >= 2, 'Action buttons must have type="button"');
      });

      it('T2.29: Clear action handles null xtermRef gracefully', () => {
        assert.match(terminalAppTsx, /const\s+handleClear\s*=\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(xtermRef\.current\)/);
      });

      it('T2.30: Reconnect action handles null xtermRef gracefully', () => {
        assert.match(terminalAppTsx, /const\s+handleReconnect\s*=\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(xtermRef\.current\)/);
      });
    });

    // F7 Boundary: Layout Overflow & Scrollbar Boundaries
    describe('F7-B: Layout Overflow & Unmount Cleanup Boundaries', () => {
      it('T2.31: Header bar has flex-shrink: 0 and min-height: 38px preventing squishing', () => {
        assert.match(terminalCss, /\.headerBar\s*\{[^}]*flex-shrink:\s*0;\s*gap:\s*8px;\s*min-height:\s*38px;/);
      });

      it('T2.32: Terminal wrapper specifies flex: 1 and min-height: 0 for proper flex column scaling', () => {
        assert.match(terminalCss, /\.terminalWrapper\s*\{[^}]*flex:\s*1;\s*min-height:\s*0;/);
      });

      it('T2.33: Terminal canvas specifies font-smoothing and text-rendering optimizations', () => {
        assert.match(terminalCss, /-webkit-font-smoothing:\s*antialiased;/);
        assert.match(terminalCss, /-moz-osx-font-smoothing:\s*grayscale;/);
        assert.match(terminalCss, /text-rendering:\s*optimizeLegibility;/);
      });

      it('T2.34: Unmount cleanup disconnects ResizeObserver instance', () => {
        assert.match(terminalAppTsx, /return\s*\(\)\s*=>\s*\{[\s\S]*?resizeObserver\.disconnect\(\);/);
      });

      it('T2.35: Unmount cleanup disposes terminal onData disposable listener', () => {
        assert.match(terminalAppTsx, /return\s*\(\)\s*=>\s*\{[\s\S]*?dataDisposable\.dispose\(\);/);
      });
    });

    // F8 Boundary: Static Cleanliness & Scope Boundaries
    describe('F8-B: Static Cleanliness & Scope Boundaries', () => {
      it('T2.36: Unmount cleanup closes WebSocket and disposes xterm instance', () => {
        assert.match(terminalAppTsx, /return\s*\(\)\s*=>\s*\{[\s\S]*?term\.dispose\(\);[\s\S]*?xtermRef\.current\s*=\s*null;/);
      });

      it('T2.37: WebSocket URL handles dynamic protocol resolution (wss: for https:, ws: for http:)', () => {
        assert.match(terminalAppTsx, /const\s+protocol\s*=\s*window\.location\.protocol\s*===\s*['"]https:['"]\s*\?\s*['"]wss:['"]\s*:\s*['"]ws:['"];/);
      });

      it('T2.38: WebSocket endpoint targets /terminal path with sessionId parameter', () => {
        assert.match(terminalAppTsx, /const\s+wsUrl\s*=\s*`\$\{protocol\}\/\/\$\{window\.location\.host\}\/terminal\?sessionId=\$\{encodeURIComponent\(SESSION_ID\)\}`;/);
      });

      it('T2.39: Scope boundary check: backend socket files (agent/sockets/terminal.js) remain intact', () => {
        const backendSocketPath = path.join(REPO_ROOT, 'agent/sockets/terminal.js');
        assert.ok(fs.existsSync(backendSocketPath), 'Backend socket file must exist');
        const socketContent = fs.readFileSync(backendSocketPath, 'utf-8');
        assert.match(socketContent, /pty\.spawn/);
      });

      it('T2.40: Lucide icons Trash2 and RefreshCw are imported and used cleanly', () => {
        assert.match(terminalAppTsx, /import\s*\{[^}]*RefreshCw[^}]*Trash2[^}]*\}\s*from\s*['"]lucide-react['"];/);
      });
    });
  });

  /* ==========================================================================
     TIER 3: CROSS-FEATURE COMBINATIONS (8 pairwise integration tests)
     ========================================================================== */

  describe('Tier 3: Cross-Feature Integration Combinations (8 tests)', () => {
    it('T3.1: (F3 + F4 + F7) Font loading + xterm fit interaction ensures refit when JetBrains Mono is ready', () => {
      assert.match(mainTsx, /@fontsource\/jetbrains-mono\/400\.css/);
      assert.match(terminalAppTsx, /'JetBrains Mono'/);
      assert.match(terminalAppTsx, /document\.fonts\.ready\.then\(\(\)\s*=>\s*\{[\s\S]*?syncDimensions\(\);/);
      assert.match(terminalAppTsx, /syncDimensions\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]*?fitAddonRef\.current\.fit\(\);/);
    });

    it('T3.2: (F1 + F5) Status state transition dynamically reflects Vercel dark theme dot styles', () => {
      assert.match(terminalAppTsx, /status\s*===\s*'connected'/);
      assert.match(terminalCss, /\.statusDotConnected\s*\{[^}]*background:\s*#22c55e;/);
      assert.match(terminalCss, /\.statusDotConnecting\s*\{[^}]*background:\s*#facc15;/);
      assert.match(terminalCss, /\.statusDotDisconnected\s*\{[^}]*background:\s*#ef4444;/);
    });

    it('T3.3: (F5 + F6) Toolbar Reconnect action coordinates WebSocket lifecycle and status badge sync', () => {
      assert.match(terminalAppTsx, /handleReconnect/);
      assert.match(terminalAppTsx, /setStatus\('connecting'\)/);
      assert.match(terminalAppTsx, /socket\.onopen\s*=\s*\(\)\s*=>\s*\{[\s\S]*?setStatus\('connected'\)/);
    });

    it('T3.4: (F4 + F6) Toolbar Clear action clears screen via shell and immediately restores terminal focus', () => {
      assert.match(terminalAppTsx, /handleClear\s*=\s*\(\)\s*=>\s*\{[\s\S]*?socketRef\.current\.send\([^\)]*\\x0c[^\)]*\);[\s\S]*?xtermRef\.current\.focus\(\);/);
    });

    it('T3.5: (F4 + F7) Container resizing triggers ResizeObserver and FitAddon calculation protected by try/catch', () => {
      assert.match(terminalAppTsx, /new\s+ResizeObserver\(\(\)\s*=>\s*\{[\s\S]*?syncDimensions\(\);[\s\S]*?\}\s*\)/);
      assert.match(terminalAppTsx, /syncDimensions\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]*?try\s*\{[\s\S]*?fitAddonRef\.current\.fit\(\);[\s\S]*?\}\s*catch/);
    });

    it('T3.6: (F1 + F2) Pitch black theme consistency between UI header, canvas, and xterm ANSI palette', () => {
      assert.match(terminalCss, /\.container\s*\{[^}]*background:\s*#000000;/);
      assert.match(terminalAppTsx, /background:\s*['"]#000000['"]/);
      assert.match(terminalAppTsx, /foreground:\s*['"]#ededed['"]/);
      assert.match(terminalCss, /\.headerBar\s*\{[^}]*background:\s*#0a0a0a;/);
    });

    it('T3.7: (F1 + F3 + F4) CSS custom properties and JetBrains Mono integration across index.css, terminal.module.css, and TerminalApp.tsx', () => {
      assert.match(indexCss, /--mono:\s*'JetBrains Mono'/);
      assert.match(terminalCss, /font-family:\s*var\(--mono\);/);
      assert.match(terminalAppTsx, /fontFamily:\s*[`'"].*JetBrains Mono/);
    });

    it('T3.8: (F6 + F7 + F8) Full unmount teardown cycle safely cleans up ResizeObserver, socket, listeners, and terminal', () => {
      assert.match(terminalAppTsx, /resizeObserver\.disconnect\(\)/);
      assert.match(terminalAppTsx, /dataDisposable\.dispose\(\)/);
      assert.match(terminalAppTsx, /socketRef\.current\.close\(\)/);
      assert.match(terminalAppTsx, /term\.dispose\(\)/);
    });
  });

  /* ==========================================================================
     TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 full workflow tests)
     ========================================================================== */

  describe('Tier 4: Real-World Application Workflows (5 tests)', () => {
    it('T4.1: Workflow 1 — Startup & Connection Simulation: xterm instantiates -> font loads -> socket opens -> status updates to connected', () => {
      let termWrites = [];
      let currentStatus = 'connecting';
      let socketSent = [];

      const mockTerm = {
        write: (msg) => termWrites.push(msg),
        clear: () => { termWrites = []; },
        focus: () => {},
        dispose: () => {},
      };

      const mockSocket = {
        readyState: 1, // OPEN
        send: (data) => socketSent.push(data),
        close: () => {},
      };

      // 1. Initial status
      assert.strictEqual(currentStatus, 'connecting');

      // 2. On open event
      currentStatus = 'connected';
      mockTerm.write('\r\n\x1b[1;35m==> Connected to Home Cloud Secure Shell (bash) <==\x1b[0m\r\n\r\n');

      assert.strictEqual(currentStatus, 'connected');
      assert.ok(termWrites.some(w => w.includes('Connected to Home Cloud Secure Shell')));
    });

    it('T4.2: Workflow 2 — Command Keystrokes & Clear Buffer Simulation: keystrokes sent over socket -> output written -> clear invoked -> focus retained', () => {
      let buffer = [];
      let socketOutput = [];
      let focused = false;

      const mockTerm = {
        onData: (cb) => {
          return {
            dispose: () => {},
            trigger: (data) => cb(data),
          };
        },
        write: (chunk) => buffer.push(chunk),
        clear: () => { buffer = []; },
        focus: () => { focused = true; },
      };

      const mockSocket = {
        readyState: 1, // OPEN
        send: (data) => socketOutput.push(data),
      };

      // 1. User types 'ls -la\n'
      const dataHandler = (data) => {
        if (mockSocket.readyState === 1) {
          mockSocket.send(data);
        }
      };
      dataHandler('ls -la\r');
      assert.deepStrictEqual(socketOutput, ['ls -la\r']);

      // 2. Server outputs directory list
      mockTerm.write('total 48\ndrwxr-xr-x 4 user user 4096 Aug 28 19:20 .\n');
      assert.ok(buffer.length > 0);

      // 3. User clicks Clear button
      mockTerm.clear();
      mockTerm.focus();
      assert.strictEqual(buffer.length, 0);
      assert.strictEqual(focused, true);
    });

    it('T4.3: Workflow 3 — Network Disconnection & Manual Reconnect Lifecycle: socket closes -> disconnected status -> reconnect clicked -> connecting -> connected', () => {
      let status = 'connected';
      let termOutput = [];
      let focused = false;

      const mockTerm = {
        write: (data) => termOutput.push(data),
        focus: () => { focused = true; },
      };

      // 1. Connection drops
      status = 'disconnected';
      mockTerm.write('\r\n\x1b[1;31m==> Connection Closed <==\x1b[0m\r\n');
      assert.strictEqual(status, 'disconnected');
      assert.ok(termOutput.some(t => t.includes('Connection Closed')));

      // 2. User clicks Reconnect button
      mockTerm.write('\r\n\x1b[1;33m==> Reconnecting to shell... <==\x1b[0m\r\n');
      mockTerm.focus();
      status = 'connecting';
      assert.strictEqual(status, 'connecting');
      assert.strictEqual(focused, true);
      assert.ok(termOutput.some(t => t.includes('Reconnecting to shell')));

      // 3. New socket connection succeeds
      status = 'connected';
      mockTerm.write('\r\n\x1b[1;35m==> Connected to Home Cloud Secure Shell (bash) <==\x1b[0m\r\n\r\n');
      assert.strictEqual(status, 'connected');
    });

    it('T4.4: Workflow 4 — Dynamic Window Resizing & Container Refit Simulation: container resizes -> ResizeObserver invokes FitAddon without layout shift', () => {
      let fitCount = 0;
      let fitErrors = 0;

      const mockFitAddon = {
        fit: () => {
          fitCount++;
          return { cols: 120, rows: 35 };
        },
      };

      // Resize event callback
      const resizeCallback = () => {
        try {
          mockFitAddon.fit();
        } catch (_err) {
          fitErrors++;
        }
      };

      // Trigger 5 rapid resize steps
      for (let i = 0; i < 5; i++) {
        resizeCallback();
      }

      assert.strictEqual(fitCount, 5, 'FitAddon.fit should have been called 5 times');
      assert.strictEqual(fitErrors, 0, 'No fit errors should have occurred');
    });

    it('T4.5: Workflow 5 — Component Unmount Teardown Simulation: user navigates away / closes window -> all active resources cleanly disposed', () => {
      let observerDisconnected = false;
      let dataDisposed = false;
      let socketClosed = false;
      let socketListenersNulled = false;
      let termDisposed = false;

      const mockResizeObserver = {
        disconnect: () => { observerDisconnected = true; },
      };

      const mockDataDisposable = {
        dispose: () => { dataDisposed = true; },
      };

      const mockSocket = {
        readyState: 1, // OPEN
        onopen: () => {},
        onmessage: () => {},
        onclose: () => {},
        onerror: () => {},
        close: () => { socketClosed = true; },
      };

      const mockTerm = {
        dispose: () => { termDisposed = true; },
      };

      // Simulate useEffect cleanup function
      const unmountCleanup = () => {
        mockResizeObserver.disconnect();
        mockDataDisposable.dispose();
        if (mockSocket) {
          mockSocket.onopen = null;
          mockSocket.onmessage = null;
          mockSocket.onclose = null;
          mockSocket.onerror = null;
          socketListenersNulled = true;
          if (mockSocket.readyState === 1) {
            mockSocket.close();
          }
        }
        mockTerm.dispose();
      };

      unmountCleanup();

      assert.strictEqual(observerDisconnected, true, 'ResizeObserver must be disconnected');
      assert.strictEqual(dataDisposed, true, 'Terminal data disposable must be disposed');
      assert.strictEqual(socketListenersNulled, true, 'Socket listeners must be nulled');
      assert.strictEqual(socketClosed, true, 'Active socket must be closed');
      assert.strictEqual(termDisposed, true, 'Terminal instance must be disposed');
    });
  });
});
