import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  LEGACY_WALLPAPER_EVENT,
  VALID_FITS,
  VALID_IDS,
  WALLPAPER_CUSTOM_URL_KEY,
  WALLPAPER_EVENT,
  WALLPAPER_HAS_CUSTOM_KEY,
  WALLPAPER_STORAGE_KEY,
  applyWallpaper,
  compressWallpaperFile,
  deleteCustomWallpaperBlob,
  getCustomWallpaperBlob,
  loadCachedCustomWallpaper,
  loadWallpaperSettings,
  notifyWallpaperChange,
  putCustomWallpaperBlob,
  saveCachedCustomWallpaper,
  saveWallpaperSettings,
  type WallpaperFit,
  type WallpaperId,
  type WallpaperSettings,
} from '../utils/wallpaper';

interface PersonalizationPreferences {
  presetId?: WallpaperId;
  fit?: WallpaperFit;
  hasCustomWallpaper?: boolean;
}

interface PreferencesResponse {
  status?: string;
  personalization?: PersonalizationPreferences;
  preferences?: {
    personalization?: PersonalizationPreferences;
  };
}

export function useWallpaper() {
  const [settings, setSettings] = useState<WallpaperSettings>(() => loadWallpaperSettings());
  const [customUrl, setCustomUrl] = useState<string | null>(() => loadCachedCustomWallpaper().customUrl);
  const [hasCustom, setHasCustom] = useState<boolean>(() => loadCachedCustomWallpaper().hasCustom);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const customUrlRef = useRef<string | null>(null);

  const replaceCustomUrl = useCallback((next: string | null) => {
    if (customUrlRef.current && customUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(customUrlRef.current);
    }
    customUrlRef.current = next;
    setCustomUrl(next);
  }, []);

  useEffect(() => {
    customUrlRef.current = customUrl;
  }, [customUrl]);

  // Sync preferences from server on hook mount
  useEffect(() => {
    let cancelled = false;

    const syncServerPreferences = async () => {
      try {
        const res = await axios.get<PreferencesResponse>('/api/settings/preferences');
        if (cancelled) return;

        const personalization = res.data?.personalization || res.data?.preferences?.personalization;
        if (!personalization) return;

        const serverPresetId = personalization.presetId;
        const serverFit = personalization.fit;
        const serverHasCustom = Boolean(personalization.hasCustomWallpaper);

        if (serverHasCustom) {
          setHasCustom(true);
          const nextUrl = `/api/settings/wallpaper?t=${Date.now()}`;
          replaceCustomUrl(nextUrl);
          saveCachedCustomWallpaper(true, nextUrl);
        } else {
          setHasCustom(false);
          replaceCustomUrl(null);
          saveCachedCustomWallpaper(false, null);
        }

        setSettings((prev) => {
          let nextId = prev.id;
          if (serverPresetId && VALID_IDS.has(serverPresetId)) {
            nextId = serverPresetId;
          }
          if (!serverHasCustom && nextId === 'custom') {
            nextId = serverPresetId && serverPresetId !== 'custom' ? serverPresetId : 'waves';
          }
          if (serverHasCustom && serverPresetId === 'custom') {
            nextId = 'custom';
          }
          const nextFit = serverFit && VALID_FITS.has(serverFit) ? serverFit : prev.fit;
          const nextSettings: WallpaperSettings = { id: nextId, fit: nextFit };
          saveWallpaperSettings(nextSettings);
          return nextSettings;
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('[useWallpaper] Could not sync with server preferences, falling back to local storage:', err);
        // Fall back to local IndexedDB if custom wallpaper was expected locally
        try {
          const blob = await getCustomWallpaperBlob();
          if (cancelled) return;
          if (blob) {
            setHasCustom(true);
            const blobUrl = URL.createObjectURL(blob);
            replaceCustomUrl(blobUrl);
            saveCachedCustomWallpaper(true, blobUrl);
          }
        } catch {
          // ignore
        }
      }
    };

    void syncServerPreferences();

    const onWallpaper = (event: Event) => {
      const customEvent = event as CustomEvent<{ settings?: WallpaperSettings; customUrl?: string | null }>;
      if (customEvent.detail) {
        if (customEvent.detail.settings) {
          setSettings(customEvent.detail.settings);
        }
        if (customEvent.detail.customUrl !== undefined) {
          replaceCustomUrl(customEvent.detail.customUrl);
          setHasCustom(Boolean(customEvent.detail.customUrl));
        }
        return;
      }
      setSettings(loadWallpaperSettings());
      const cached = loadCachedCustomWallpaper();
      setHasCustom(cached.hasCustom);
      if (cached.customUrl !== customUrlRef.current) {
        replaceCustomUrl(cached.customUrl);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (
        event.key &&
        event.key !== WALLPAPER_STORAGE_KEY &&
        event.key !== WALLPAPER_CUSTOM_URL_KEY &&
        event.key !== WALLPAPER_HAS_CUSTOM_KEY
      ) {
        return;
      }
      setSettings(loadWallpaperSettings());
      const cached = loadCachedCustomWallpaper();
      setHasCustom(cached.hasCustom);
      if (cached.customUrl !== customUrlRef.current) {
        replaceCustomUrl(cached.customUrl);
      }
    };

    window.addEventListener(WALLPAPER_EVENT, onWallpaper);
    window.addEventListener(LEGACY_WALLPAPER_EVENT, onWallpaper);
    window.addEventListener('storage', onStorage);

    return () => {
      cancelled = true;
      window.removeEventListener(WALLPAPER_EVENT, onWallpaper);
      window.removeEventListener(LEGACY_WALLPAPER_EVENT, onWallpaper);
      window.removeEventListener('storage', onStorage);
      if (customUrlRef.current && customUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(customUrlRef.current);
        customUrlRef.current = null;
      }
    };
  }, [replaceCustomUrl]);

  // Apply CSS variables whenever settings or customUrl updates
  useEffect(() => {
    const resolved =
      settings.id === 'custom' && !customUrl ? { ...settings, id: 'waves' as const } : settings;
    applyWallpaper(resolved, customUrl);
  }, [settings, customUrl]);

  const selectPreset = useCallback(
    (id: WallpaperId) => {
      setError(null);
      setSettings((prev) => {
        const next: WallpaperSettings = { ...prev, id };
        saveWallpaperSettings(next);
        notifyWallpaperChange({ settings: next, customUrl: customUrlRef.current });
        return next;
      });

      axios
        .put('/api/settings/preferences', {
          personalization: { presetId: id },
        })
        .catch((err) => {
          console.warn('[useWallpaper] Failed to sync preset to server:', err);
        });
    },
    [],
  );

  const setFit = useCallback(
    (fit: WallpaperFit) => {
      setSettings((prev) => {
        const next: WallpaperSettings = { ...prev, fit };
        saveWallpaperSettings(next);
        notifyWallpaperChange({ settings: next, customUrl: customUrlRef.current });
        return next;
      });

      axios
        .put('/api/settings/preferences', {
          personalization: { fit },
        })
        .catch((err) => {
          console.warn('[useWallpaper] Failed to sync fit to server:', err);
        });
    },
    [],
  );

  const uploadCustom = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const compressedBlob = await compressWallpaperFile(file);
        void putCustomWallpaperBlob(compressedBlob).catch(() => {});

        const formData = new FormData();
        formData.append('file', compressedBlob, file.name || 'wallpaper.jpg');

        let nextCustomUrl = `/api/settings/wallpaper?t=${Date.now()}`;
        try {
          const res = await axios.post<{ url?: string; status?: string }>('/api/settings/wallpaper', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          if (res.data?.url) {
            nextCustomUrl = res.data.url;
          }
        } catch (uploadErr) {
          if (axios.isAxiosError(uploadErr) && (!uploadErr.response || uploadErr.response.status >= 500)) {
            console.warn('[useWallpaper] Server upload failed, using local offline copy:', uploadErr);
            const objectUrl = URL.createObjectURL(compressedBlob);
            replaceCustomUrl(objectUrl);
            setHasCustom(true);
            saveCachedCustomWallpaper(true, objectUrl);

            setSettings((prev) => {
              const next: WallpaperSettings = { ...prev, id: 'custom' };
              saveWallpaperSettings(next);
              notifyWallpaperChange({ settings: next, customUrl: objectUrl });
              return next;
            });
            return;
          }
          const msg =
            axios.isAxiosError(uploadErr) && uploadErr.response?.data?.error
              ? String(uploadErr.response.data.error)
              : uploadErr instanceof Error
                ? uploadErr.message
                : 'Failed to upload custom wallpaper';
          throw new Error(msg, { cause: uploadErr });
        }

        replaceCustomUrl(nextCustomUrl);
        setHasCustom(true);
        saveCachedCustomWallpaper(true, nextCustomUrl);

        setSettings((prev) => {
          const next: WallpaperSettings = { ...prev, id: 'custom' };
          saveWallpaperSettings(next);
          notifyWallpaperChange({ settings: next, customUrl: nextCustomUrl });
          return next;
        });

        axios
          .put('/api/settings/preferences', {
            personalization: {
              presetId: 'custom',
              hasCustomWallpaper: true,
            },
          })
          .catch((err) => {
            console.warn('[useWallpaper] Failed to sync custom wallpaper preference:', err);
          });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not use this image.';
        setError(message);
      } finally {
        setUploading(false);
      }
    },
    [replaceCustomUrl],
  );

  const removeCustom = useCallback(async () => {
    setError(null);
    try {
      await axios.delete('/api/settings/wallpaper');
    } catch (err) {
      console.warn('[useWallpaper] Server DELETE /api/settings/wallpaper error:', err);
    }

    try {
      await deleteCustomWallpaperBlob();
    } catch {
      // ignore
    }

    replaceCustomUrl(null);
    setHasCustom(false);
    saveCachedCustomWallpaper(false, null);

    setSettings((prev) => {
      const next: WallpaperSettings = {
        ...prev,
        id: prev.id === 'custom' ? 'waves' : prev.id,
      };
      saveWallpaperSettings(next);
      notifyWallpaperChange({ settings: next, customUrl: null });
      return next;
    });

    axios
      .put('/api/settings/preferences', {
        personalization: {
          presetId: 'waves',
          hasCustomWallpaper: false,
        },
      })
      .catch((err) => {
        console.warn('[useWallpaper] Failed to sync removal to server:', err);
      });
  }, [replaceCustomUrl]);

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
