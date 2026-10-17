import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';

interface SlidingPillBarProps extends HTMLAttributes<HTMLDivElement> {
  activeKey: string | number;
  pillClassName: string;
  activeSelector?: string;
  children: ReactNode;
}

export default function SlidingPillBar({
  activeKey,
  pillClassName,
  activeSelector = '[data-active="true"], [aria-checked="true"], [aria-selected="true"]',
  className,
  children,
  ...props
}: SlidingPillBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const pill = pillRef.current;
    if (!container || !pill) return;

    const activeEl = container.querySelector<HTMLElement>(activeSelector);
    if (!activeEl) return;

    const offsetLeft = activeEl.offsetLeft;
    const offsetWidth = activeEl.offsetWidth;

    const isUnpositioned = !pill.style.opacity || pill.style.opacity === '0';

    if (offsetWidth === 0) {
      requestAnimationFrame(() => {
        if (!container || !pill) return;
        const el = container.querySelector<HTMLElement>(activeSelector);
        if (!el || el.offsetWidth === 0) return;
        const prev = pill.style.transition;
        pill.style.transition = 'none';
        pill.style.transform = `translateX(${el.offsetLeft}px)`;
        pill.style.width = `${el.offsetWidth}px`;
        pill.style.opacity = '1';
        void pill.offsetWidth;
        pill.style.transition = prev;
      });
      return;
    }

    if (isUnpositioned) {
      const prev = pill.style.transition;
      pill.style.transition = 'none';
      pill.style.transform = `translateX(${offsetLeft}px)`;
      pill.style.width = `${offsetWidth}px`;
      pill.style.opacity = '1';
      void pill.offsetWidth;
      pill.style.transition = prev;
    } else {
      pill.style.transform = `translateX(${offsetLeft}px)`;
      pill.style.width = `${offsetWidth}px`;
      pill.style.opacity = '1';
    }
  }, [activeKey, activeSelector]);

  useEffect(() => {
    const container = containerRef.current;
    const pill = pillRef.current;
    if (!container || !pill) return;

    const syncPill = () => {
      const el = container.querySelector<HTMLElement>(activeSelector);
      if (!el || !pill) return;
      const prev = pill.style.transition;
      pill.style.transition = 'none';
      pill.style.transform = `translateX(${el.offsetLeft}px)`;
      pill.style.width = `${el.offsetWidth}px`;
      void pill.offsetWidth;
      pill.style.transition = prev;
    };

    const ro = new ResizeObserver(syncPill);
    ro.observe(container);
    if ('fonts' in document) {
      void document.fonts.ready.then(syncPill);
    }
    return () => ro.disconnect();
  }, [activeSelector]);

  return (
    <div ref={containerRef} className={className} {...props}>
      <span ref={pillRef} className={pillClassName} aria-hidden="true" />
      {children}
    </div>
  );
}
