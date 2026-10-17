/* eslint-disable @typescript-eslint/no-explicit-any */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { retryDynamicImport } from './dynamicImport.ts';

export type WindowAppId =
  | 'metrics'
  | 'files'
  | 'terminal'
  | 'docker'
  | 'docker-console'
  | 'settings';

type AppLoader = () => Promise<{ default: ComponentType<any> }>;

const appLoaders: Record<WindowAppId, AppLoader> = {
  metrics: () => import('../components/apps/SystemMonitorApp'),
  files: () => import('../pages/files'),
  terminal: () => import('../components/apps/TerminalApp'),
  docker: () => import('../components/apps/DockerApp'),
  'docker-console': () => import('../components/apps/ContainerConsoleTab'),
  settings: () => import('../components/apps/SettingsApp'),
};

const lazyCache = new Map<string, LazyExoticComponent<ComponentType<any>>>();

/**
 * Returns a React.lazy component for the given window application ID.
 * Keyed by `${id}@${retryVersion}` so React 19 creates a clean lazy instance
 * on retry without retaining prior rejection state.
 */
export function getLazyWindowApp<P = any>(
  id: string,
  retryVersion: number = 0
): LazyExoticComponent<ComponentType<P>> {
  const cacheKey = `${id}@${retryVersion}`;
  const cached = lazyCache.get(cacheKey);
  if (cached) {
    return cached as LazyExoticComponent<ComponentType<P>>;
  }

  const loader = appLoaders[id as WindowAppId];
  if (!loader) {
    throw new Error(`Unknown window app ID: "${id}"`);
  }

  const LazyComponent = lazy(() => retryDynamicImport(loader));
  lazyCache.set(cacheKey, LazyComponent);
  return LazyComponent as LazyExoticComponent<ComponentType<P>>;
}

/**
 * Preload a window app module ahead of time (e.g. on mouse hover or idle).
 */
export function preloadWindowApp(id: WindowAppId): Promise<any> {
  const loader = appLoaders[id];
  return loader ? loader().catch(() => {}) : Promise.resolve();
}
