import React, { useRef } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';

interface OSWindowProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  active: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  children: React.ReactNode;
}

export default function OSWindow({
  id,
  title,
  icon,
  isOpen,
  isMinimized,
  isMaximized,
  x,
  y,
  width,
  height,
  zIndex,
  active,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onMove,
  onResize,
  children,
}: OSWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  if (!isOpen) return null;

  const handleTitleBarMouseDown = (e: React.MouseEvent) => {
    if (isMobile || isMaximized) return;
    onFocus();

    // Don't drag if clicking a control button
    if ((e.target as HTMLElement).closest('.win-ctrl')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = x;
    const initialY = y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      // Clamp Y so the titlebar never goes above the viewport top
      onMove(initialX + deltaX, Math.max(0, initialY + deltaY));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onFocus();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialWidth = width;
    const initialHeight = height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      onResize(
        Math.max(480, initialWidth + deltaX),
        Math.max(320, initialHeight + deltaY),
      );
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      ref={windowRef}
      id={`win-${id}`}
      className={[
        'os-window',
        active ? 'active' : '',
        isMobile ? 'mobile-window' : '',
        isMaximized ? 'maximized' : '',
        isMinimized ? 'minimized' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        isMobile
          ? {
              left: 0,
              top: 0,
              width: '100%',
              height: 'calc(var(--app-height, 100dvh) - var(--mobile-nav-height) - var(--safe-bottom))',
              zIndex,
            }
          : {
              left: isMaximized ? 0 : `${x}px`,
              top: isMaximized ? 0 : `${y}px`,
              width: isMaximized ? '100%' : `${width}px`,
              height: isMaximized ? '100%' : `${height}px`,
              zIndex,
            }
      }
      onClick={onFocus}
    >
      {/* Title bar / Mobile header */}
      {isMobile ? (
        <div className="mobile-window-header">
          <button
            type="button"
            className="mobile-header-back"
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            aria-label="Back to home"
            title="Back to home"
          >
            <ChevronLeft size={20} />
            <span className="mobile-header-back-label">Home</span>
          </button>

          <div className="mobile-header-title">
            {icon && <span className="window-icon">{icon}</span>}
            <span className="window-title">{title}</span>
          </div>

          <button
            type="button"
            className="mobile-header-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>
      ) : (
        <div
          className="window-titlebar"
          onMouseDown={handleTitleBarMouseDown}
          onDoubleClick={onMaximize}
        >
          {/* Left: icon + title */}
          <div className="window-title-area">
            {icon && <span className="window-icon">{icon}</span>}
            <span className="window-title">{title}</span>
          </div>

          {/* Right: Windows-style controls — minimize, maximize, close */}
          <div className="window-controls">
            <button
              className="win-ctrl win-minimize"
              onClick={(e) => { e.stopPropagation(); onMinimize(); }}
              title="Minimize"
            >
              {/* Horizontal bar */}
              <svg width="10" height="1" viewBox="0 0 10 1" fill="none" aria-hidden="true">
                <line x1="0.75" y1="0.5" x2="9.25" y2="0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>

            <button
              className="win-ctrl win-maximize"
              onClick={(e) => { e.stopPropagation(); onMaximize(); }}
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? (
                /* Restore icon: two overlapping squares */
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <rect x="2.25" y="0.75" width="7" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M0.75 2.75V8.5a0.75 0.75 0 0 0 0.75 0.75H7.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                /* Maximize icon: single square */
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="0.75" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
            </button>

            <button
              className="win-ctrl win-close"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              title="Close"
            >
              {/* × icon */}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="window-body">{children}</div>

      {/* Resize handle (desktop only) */}
      {!isMobile && !isMaximized && (
        <div className="window-resize-handle" onMouseDown={handleResizeMouseDown} />
      )}
    </div>
  );
}
