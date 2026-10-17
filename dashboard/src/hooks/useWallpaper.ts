import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WALLPAPER_EVENT,
  WALLPAPER_STORAGE_KEY,
  applyWallpaper,
  compressWallpaperFile,
  deleteCustomWallpaperBlob,
  getCustomWallpaperBlob,
  loadWallpaperSettings,
  notifyWallpaperChange,
  putCustomWallpaperBlob,
  saveWallpaperSettings,
  type WallpaperFit,
  type WallpaperId,
  type WallpaperSettings,
} from '../utils/wallpaper';

export function useWallpaper() {
  const [settings, setSettings] = useState<WallpaperSettings>(() => loadWallpaperSettings());
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [hasCustom, setHasCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const customUrlRef = useRef<string | null>(null);

  const replaceCustomUrl = useCallback((next: string | null) => {
    if (customUrlRef.current) {
      URL.revokeObjectURL(customUrlRef.current);
    }
    customUrlRef.current = next;
    setCustomUrl(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCustom = async () => {
      try {
        const blob = await getCustomWallpaperBlob();
        if (cancelled) return;
        if (!blob) {
          replaceCustomUrl(null);
          setHasCustom(false);
          setSettings((prev) => {
            if (prev.id !== 'custom') return prev;
            const next = { ...prev, id: 'waves' as const };
            saveWallpaperSettings(next);
            return next;
          });
          return;
        }
        setHasCustom(true);
        replaceCustomUrl(URL.createObjectURL(blob));
      } catch {
        if (cancelled) return;
        replaceCustomUrl(null);
        setHasCustom(false);
      }
    };

    void loadCustom();

    const onWallpaper = () => {
      setSettings(loadWallpaperSettings());
      void loadCustom();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== WALLPAPER_STORAGE_KEY) return;
      setSettings(loadWallpaperSettings());
    };

    window.addEventListener(WALLPAPER_EVENT, onWallpaper);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener(WALLPAPER_EVENT, onWallpaper);
      window.removeEventListener('storage', onStorage);
      if (customUrlRef.current) {
        URL.revokeObjectURL(customUrlRef.current);
        customUrlRef.current = null;
      }
    };
  }, [replaceCustomUrl]);

  useEffect(() => {
    const resolved =
      settings.id === 'custom' && !customUrl ? { ...settings, id: 'waves' as const } : settings;
    applyWallpaper(resolved, customUrl);
  }, [settings, customUrl]);

  const commit = useCallback((next: WallpaperSettings) => {
    saveWallpaperSettings(next);
    setSettings(next);
    notifyWallpaperChange();
  }, []);

  const selectPreset = useCallback(
    (id: WallpaperId) => {
      setError(null);
      commit({ ...settings, id });
    },
    [commit, settings],
  );

  const setFit = useCallback(
    (fit: WallpaperFit) => {
      commit({ ...settings, fit });
    },
    [commit, settings],
  );

  const uploadCustom = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const blob = await compressWallpaperFile(file);
        await putCustomWallpaperBlob(blob);
        replaceCustomUrl(URL.createObjectURL(blob));
        setHasCustom(true);
        commit({ ...settings, id: 'custom' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not use this image.';
        setError(message);
      } finally {
        setUploading(false);
      }
    },
    [commit, replaceCustomUrl, settings],
  );

  const removeCustom = useCallback(async () => {
    setError(null);
    try {
      await deleteCustomWallpaperBlob();
    } catch {
      setError('Could not remove the custom wallpaper.');
      return;
    }
    replaceCustomUrl(null);
    setHasCustom(false);
    if (settings.id === 'custom') {
      commit({ ...settings, id: 'waves' });
    } else {
      notifyWallpaperChange();
    }
  }, [commit, replaceCustomUrl, settings]);

  return {
    settings,
    customUrl,
    hasCustom,
    error,
    uploading,
    selectPreset,
    setFit,
    uploadCustom,
    removeCustom,
  };
}
