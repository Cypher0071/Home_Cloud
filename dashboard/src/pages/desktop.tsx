import { useState, useEffect, createElement, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Terminal as TerminalIcon,
  LogOut,
  Folder,
  Box,
  Zap,
  LayoutGrid,
} from 'lucide-react';

import OSWindow from '../components/OSWindow';
import WindowErrorBoundary from '../components/WindowErrorBoundary';
import WindowSkeleton from '../components/skeletons/WindowSkeleton';
import DesktopMetricWidget from '../components/DesktopMetricWidget';
import { useNetworkDetector } from '../hooks/useNetworkDetector';
import { useSystemMetrics } from '../hooks/useSystemMetrics';
import { useIsMobile } from '../hooks/useIsMobile';
import { getLazyWindowApp, preloadWindowApp, type WindowAppId } from '../utils/windowAppRegistry';

interface WindowState {
  id: WindowAppId;
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

interface WindowHostProps {
  appId: WindowAppId;
  title: string;
  retryVersion: number;
  onRetry: () => void;
}

function WindowHost({ appId, title, retryVersion, onRetry }: WindowHostProps) {
  const LazyApp = getLazyWindowApp(appId, retryVersion);
  return (
    <WindowErrorBoundary key={`${appId}@${retryVersion}`} label={title} onRetry={onRetry}>
      <Suspense fallback={<WindowSkeleton type={appId} />}>
        {createElement(LazyApp)}
      </Suspense>
    </WindowErrorBoundary>
  );
}

function getInitialDeepLink(): WindowAppId | null {
  const path = window.location.pathname.replace(/^\//, '') as WindowAppId;
  const validPaths: WindowAppId[] = ['terminal', 'metrics', 'files', 'docker'];
  return validPaths.includes(path) ? path : null;
}

export default function Desktop() {
  const navigate = useNavigate();
  const net = useNetworkDetector();
  const isMobile = useIsMobile();
  const metrics = useSystemMetrics();
  const [time, setTime] = useState('');
  const [activeWindowId, setActiveWindowId] = useState<string | null>(() => getInitialDeepLink());
  const [maxZIndex, setMaxZIndex] = useState(() => (getInitialDeepLink() ? 11 : 10));
  const [retryVersions, setRetryVersions] = useState<Record<string, number>>({});

  const [windows, setWindows] = useState<WindowState[]>(() => {
    const deepLink = getInitialDeepLink();
    return [
      {
        id: 'metrics',
        title: 'Activity Monitor',
        icon: <Activity size={18} />,
        isOpen: deepLink === 'metrics',
        isMinimized: false,
        isMaximized: false,
        x: 60,
        y: 60,
        width: 760,
        height: 520,
        zIndex: deepLink === 'metrics' ? 11 : 1,
      },
      {
        id: 'files',
        title: 'File Explorer',
        icon: <Folder size={18} />,
        isOpen: deepLink === 'files',
        isMinimized: false,
        isMaximized: false,
        x: 90,
        y: 75,
        width: 820,
        height: 500,
        zIndex: deepLink === 'files' ? 11 : 2,
      },
      {
        id: 'terminal',
        title: 'Terminal',
        icon: <TerminalIcon size={18} />,
        isOpen: deepLink === 'terminal',
        isMinimized: false,
        isMaximized: false,
        x: 120,
        y: 90,
        width: 680,
        height: 440,
        zIndex: deepLink === 'terminal' ? 11 : 1,
      },
      {
        id: 'docker',
        title: 'Docker Manager',
        icon: <Box size={18} />,
        isOpen: deepLink === 'docker',
        isMinimized: false,
        isMaximized: false,
        x: 110,
        y: 70,
        width: 860,
        height: 520,
        zIndex: deepLink === 'docker' ? 11 : 3,
      },
    ];
  });

  const handleRetry = (id: string) => {
    setRetryVersions(prev => ({
      ...prev,
      [id]: (prev[id] ?? 0) + 1,
    }));
  };

  // Live clock
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setTime(
        d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) +
        '  ' +
        d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      );
    };
    updateTime();
    const id = setInterval(updateTime, 1000);
    return () => clearInterval(id);
  }, []);

  // Dynamic visualViewport management for mobile virtual keyboard handling
  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const handleViewportChange = () => {
      const height = vv.height;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
      const keyboardHeight = Math.max(0, window.innerHeight - height);
      if (keyboardHeight > 100) {
        document.documentElement.classList.add('keyboard-open');
        document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
      } else {
        document.documentElement.classList.remove('keyboard-open');
        document.documentElement.style.setProperty('--keyboard-height', '0px');
      }
    };

    handleViewportChange();
    vv.addEventListener('resize', handleViewportChange);
    vv.addEventListener('scroll', handleViewportChange);

    return () => {
      vv.removeEventListener('resize', handleViewportChange);
      vv.removeEventListener('scroll', handleViewportChange);
      document.documentElement.classList.remove('keyboard-open');
      document.documentElement.style.removeProperty('--app-height');
      document.documentElement.style.removeProperty('--keyboard-height');
    };
  }, [isMobile]);

  // Bring window to front
  const focusWindow = (id: string) => {
    setActiveWindowId(id);
    const newZ = maxZIndex + 1;
    setMaxZIndex(newZ);
    setWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, zIndex: newZ, isMinimized: false } : w)),
    );
  };

  const closeWindow = (id: string) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, isOpen: false } : w)));
    if (activeWindowId === id) setActiveWindowId(null);
  };

  const minimizeWindow = (id: string) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, isMinimized: true } : w)));
    if (activeWindowId === id) setActiveWindowId(null);
  };

  const maximizeWindow = (id: string) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w)));
    focusWindow(id);
  };

  const moveWindow = (id: string, x: number, y: number) => {
    setWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, x, y: Math.max(0, y) } : w)),
    );
  };

  const resizeWindow = (id: string, width: number, height: number) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, width, height } : w)));
  };

  // Taskbar icon click
  const handleDockClick = (id: string) => {
    const win = windows.find(w => w.id === id);
    if (!win) return;

    if (!win.isOpen) {
      setWindows(prev => prev.map(w => (w.id === id ? { ...w, isOpen: true, isMinimized: false } : w)));
      focusWindow(id);
    } else if (win.isMinimized) {
      focusWindow(id);
    } else if (activeWindowId === id) {
      minimizeWindow(id);
    } else {
      focusWindow(id);
    }
  };

  const handleHomeClick = () => {
    setWindows(prev => prev.map(w => ({ ...w, isMinimized: true })));
    setActiveWindowId(null);
  };

  const isAnyWindowVisible = windows.some(
    w => w.id === activeWindowId && w.isOpen && !w.isMinimized
  );

  const mobileAppTabs: { id: WindowAppId; label: string; icon: React.ReactNode }[] = [
    { id: 'docker', label: 'Docker', icon: <Box size={20} /> },
    { id: 'files', label: 'Files', icon: <Folder size={20} /> },
    { id: 'terminal', label: 'Terminal', icon: <TerminalIcon size={20} /> },
    { id: 'metrics', label: 'Activity', icon: <Activity size={20} /> },
  ];

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) { navigate('/login'); return; }
    } catch {
      /* fall through */
    }
    navigate('/login');
  };

  return (
    <div className="desktop">
      {/* Mobile Top Status Bar (renders on desktop wallpaper when on mobile) */}
      {isMobile && (
        <div className="mobile-top-bar">
          <div className="mobile-top-left">
            {net.isDirectLocal ? (
              <div className="mobile-status-pill local">
                <Zap size={11} fill="currentColor" />
                <span>LAN</span>
              </div>
            ) : (
              <div
                className="mobile-status-pill tunnel"
                onClick={net.serverLocalIp ? net.redirectToLocal : undefined}
              >
                <span className="tray-dot" />
                <span>{net.isLocalLAN ? 'Upgrading…' : 'Tunnel'}</span>
              </div>
            )}
            <button
              type="button"
              className="mobile-metric-chip"
              onClick={() => handleDockClick('metrics')}
              aria-label="Activity metrics"
            >
              <span>CPU {metrics.connected ? `${metrics.cpuLoad.toFixed(0)}%` : '—'}</span>
              <span>·</span>
              <span>RAM {metrics.connected ? `${metrics.memUsedPct.toFixed(0)}%` : '—'}</span>
            </button>
          </div>

          <div className="mobile-top-time">{time}</div>

          <div className="mobile-top-right">
            <button
              type="button"
              className="mobile-signout-btn"
              onClick={handleLogout}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Workspace — windows live here */}
      <div className="desktop-workspace">
        {windows.map(win => (
          <OSWindow
            key={win.id}
            id={win.id}
            title={win.title}
            icon={win.icon}
            isOpen={win.isOpen}
            isMinimized={win.isMinimized}
            isMaximized={win.isMaximized}
            x={win.x}
            y={win.y}
            width={win.width}
            height={win.height}
            zIndex={win.zIndex}
            active={activeWindowId === win.id}
            onFocus={() => focusWindow(win.id)}
            onClose={() => closeWindow(win.id)}
            onMinimize={() => minimizeWindow(win.id)}
            onMaximize={() => maximizeWindow(win.id)}
            onMove={(x, y) => moveWindow(win.id, x, y)}
            onResize={(w, h) => resizeWindow(win.id, w, h)}
          >
            <WindowHost
              appId={win.id}
              title={win.title}
              retryVersion={retryVersions[win.id] ?? 0}
              onRetry={() => handleRetry(win.id)}
            />
          </OSWindow>
        ))}
      </div>

      {/* Mobile Bottom Navigation Bar */}
      {isMobile ? (
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {/* Home Tab */}
          <button
            type="button"
            className={`mobile-nav-item ${!isAnyWindowVisible ? 'active' : ''}`}
            onClick={handleHomeClick}
            aria-label="Home"
          >
            <div className="mobile-nav-icon-wrap">
              <LayoutGrid size={19} />
              {!isAnyWindowVisible && <span className="mobile-nav-dot" />}
            </div>
            <span className="mobile-nav-label">Home</span>
          </button>

          {/* App Tabs */}
          {mobileAppTabs.map(tab => {
            const win = windows.find(w => w.id === tab.id);
            const isActive = activeWindowId === tab.id && (win?.isOpen ?? false) && !(win?.isMinimized ?? false);
            return (
              <button
                key={tab.id}
                type="button"
                className={`mobile-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => handleDockClick(tab.id)}
                onPointerDown={() => preloadWindowApp(tab.id)}
                aria-label={tab.label}
              >
                <div className="mobile-nav-icon-wrap">
                  {tab.icon}
                  {isActive && <span className="mobile-nav-dot" />}
                </div>
                <span className="mobile-nav-label">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      ) : (
        /* Desktop Acrylic Taskbar */
        <div className="taskbar">
          <div className="taskbar-left">
            <DesktopMetricWidget
              active={
                activeWindowId === 'metrics' &&
                (windows.find(w => w.id === 'metrics')?.isOpen ?? false) &&
                !(windows.find(w => w.id === 'metrics')?.isMinimized ?? false)
              }
              isOpen={windows.find(w => w.id === 'metrics')?.isOpen}
              onClick={() => handleDockClick('metrics')}
              onMouseEnter={() => preloadWindowApp('metrics')}
            />
          </div>

          {/* Center: app icons (File Explorer, Terminal, Docker) */}
          <div className="taskbar-center">
            {windows
              .filter(win => win.id !== 'metrics')
              .map(win => {
                const isActive = activeWindowId === win.id && win.isOpen && !win.isMinimized;
                return (
                  <button
                    key={win.id}
                    className={`dock-item${isActive ? ' active' : ''}`}
                    onClick={() => handleDockClick(win.id)}
                    onMouseEnter={() => preloadWindowApp(win.id)}
                    aria-label={win.title}
                  >
                    {win.icon}
                    <span className="dock-tooltip">{win.title}</span>
                    {win.isOpen && <span className="dock-item-dot" />}
                  </button>
                );
              })}
          </div>

          {/* Right: system tray */}
          <div className="taskbar-right">
            {net.isDirectLocal ? (
              <div
                className="tray-tunnel"
                style={{
                  color: 'var(--ok)',
                  borderColor: 'rgba(52, 211, 153, 0.30)',
                  background: 'rgba(52, 211, 153, 0.12)',
                }}
                title={net.serverLocalIp ? `Connected directly over Home Wi-Fi LAN (${net.serverLocalIp})` : 'Connected directly over Home Wi-Fi LAN'}
              >
                <Zap size={11} fill="currentColor" />
                {net.serverLocalIp ? `LAN · ${net.serverLocalIp}` : 'Direct LAN'}
              </div>
            ) : (
              <div
                className="tray-tunnel"
                onClick={net.serverLocalIp ? net.redirectToLocal : undefined}
                style={{ cursor: net.serverLocalIp ? 'pointer' : 'default' }}
                title={
                  net.isLocalLAN
                    ? `Redirecting to local Wi-Fi LAN (${net.serverLocalIp || 'detecting…'})…`
                    : net.serverLocalIp
                    ? `Connected over Cloudflare Remote Tunnel. Click to switch to local LAN (http://${net.serverLocalIp}:${net.serverLocalPort})`
                    : 'Connected over Cloudflare Remote Tunnel'
                }
              >
                <span className="tray-dot" />
                {net.isLocalLAN ? 'Upgrading to LAN…' : 'Tunnel'}
              </div>
            )}
            <span className="tray-time">{time}</span>
            <button
              className="tray-signout"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
