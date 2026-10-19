import { useState, useEffect, useLayoutEffect, useRef, type ChangeEvent } from 'react';
import { Monitor, HardDrive, Plus, X, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import axios from 'axios';
import { useWallpaper } from '../../hooks/useWallpaper';
import { FIT_OPTIONS, WALLPAPER_PRESETS } from '../../utils/wallpaper';
import styles from './settings.module.css';

interface StorageDrive {
  fs: string;
  type: string;
  size: number;
  used: number;
  mount: string;
  use?: number;
}

interface StorageSettings {
  allowSystemRoot: boolean;
  baseDir: string;
  drives: StorageDrive[];
}

export default function SettingsApp() {
  const [activeTab, setActiveTab] = useState<'personalization' | 'storage'>('personalization');
  const fileRef = useRef<HTMLInputElement>(null);
  const fitGroupRef = useRef<HTMLDivElement>(null);
  const fitPillRef = useRef<HTMLSpanElement>(null);
  const isFirstFitMount = useRef(true);

  // Storage settings state
  const [storageSettings, setStorageSettings] = useState<StorageSettings | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageFeedback, setStorageFeedback] = useState<string | null>(null);

  const {
    settings,
    customUrl,
    hasCustom,
    error,
    uploading,
    selectPreset,
    setFit,
    uploadCustom,
    removeCustom,
  } = useWallpaper();

  // Load storage settings
  const refreshStorageSettings = async () => {
    setStorageLoading(true);
    try {
      const res = await axios.get<StorageSettings>('/api/settings/storage');
      setStorageSettings(res.data);
    } catch {
      // ignore
    } finally {
      setStorageLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    axios.get<StorageSettings>('/api/settings/storage')
      .then(res => {
        if (active) setStorageSettings(res.data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleToggleSystemRoot = async () => {
    if (!storageSettings || storageSaving) return;
    const nextVal = !storageSettings.allowSystemRoot;
    setStorageSaving(true);
    setStorageFeedback(null);
    try {
      const res = await axios.put<{ success: boolean; allowSystemRoot: boolean }>('/api/settings/storage', {
        allowSystemRoot: nextVal,
      });
      setStorageSettings(prev => (prev ? { ...prev, allowSystemRoot: res.data.allowSystemRoot } : null));
      setStorageFeedback(
        nextVal
          ? 'Full System Root Access (/) is now enabled across File Manager & services.'
          : 'Safe Server Mode is now active. Restricted to $HOME and storage mounts.'
      );
      setTimeout(() => setStorageFeedback(null), 4000);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : 'Failed to update storage scope';
      setStorageFeedback(`Error: ${msg}`);
    } finally {
      setStorageSaving(false);
    }
  };

  useLayoutEffect(() => {
    if (activeTab !== 'personalization') return;
    const group = fitGroupRef.current;
    const pill = fitPillRef.current;
    if (!group || !pill) return;

    const activeBtn = group.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]');
    if (!activeBtn) return;

    const offsetLeft = activeBtn.offsetLeft;
    const offsetWidth = activeBtn.offsetWidth;

    if (offsetWidth === 0) {
      requestAnimationFrame(() => {
        if (!group || !pill) return;
        const btn = group.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]');
        if (!btn || btn.offsetWidth === 0) return;
        const prev = pill.style.transition;
        pill.style.transition = 'none';
        pill.style.transform = `translateX(${btn.offsetLeft}px)`;
        pill.style.width = `${btn.offsetWidth}px`;
        pill.style.opacity = '1';
        void pill.offsetWidth;
        pill.style.transition = prev;
        isFirstFitMount.current = false;
      });
      return;
    }

    if (isFirstFitMount.current) {
      isFirstFitMount.current = false;
      const prevTransition = pill.style.transition;
      pill.style.transition = 'none';
      pill.style.transform = `translateX(${offsetLeft}px)`;
      pill.style.width = `${offsetWidth}px`;
      pill.style.opacity = '1';
      void pill.offsetWidth;
      pill.style.transition = prevTransition;
    } else {
      pill.style.transform = `translateX(${offsetLeft}px)`;
      pill.style.width = `${offsetWidth}px`;
      pill.style.opacity = '1';
    }
  }, [settings.fit, activeTab]);

  useEffect(() => {
    if (activeTab !== 'personalization') return;
    const group = fitGroupRef.current;
    const pill = fitPillRef.current;
    if (!group || !pill) return;

    const syncPill = () => {
      const activeBtn = group.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]');
      if (!activeBtn || !pill) return;
      const prevTransition = pill.style.transition;
      pill.style.transition = 'none';
      pill.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
      pill.style.width = `${activeBtn.offsetWidth}px`;
      pill.style.opacity = '1';
      void pill.offsetWidth;
      pill.style.transition = prevTransition;
    };

    const ro = new ResizeObserver(syncPill);
    ro.observe(group);
    if ('fonts' in document) {
      void document.fonts.ready.then(syncPill);
    }
    return () => ro.disconnect();
  }, [activeTab]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void uploadCustom(file);
  };

  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="Settings">
        <button
          type="button"
          className={`${styles.navItem} ${activeTab === 'personalization' ? styles.navItemActive : ''}`}
          onClick={() => setActiveTab('personalization')}
          aria-current={activeTab === 'personalization' ? 'page' : undefined}
        >
          <Monitor size={15} />
          Personalization
        </button>
        <button
          type="button"
          className={`${styles.navItem} ${activeTab === 'storage' ? styles.navItemActive : ''}`}
          onClick={() => {
            setActiveTab('storage');
            void refreshStorageSettings();
          }}
          aria-current={activeTab === 'storage' ? 'page' : undefined}
        >
          <HardDrive size={15} />
          Storage & System
        </button>
      </nav>

      <div className={styles.main}>
        {activeTab === 'personalization' ? (
          <div className={styles.content}>
            <h1 className={styles.pageTitle}>Background</h1>
            <p className={styles.pageHint}>Desktop wallpaper for this browser.</p>

            <div className={styles.preview} aria-hidden="true" />

            <div className={styles.sectionHeader}>
              <p className={styles.sectionLabel} id="wallpaper-label">
                Choose a picture
              </p>
              <div ref={fitGroupRef} className={styles.fitGroup} role="radiogroup" aria-label="Wallpaper fit">
                <span ref={fitPillRef} className={styles.fitPill} aria-hidden="true" />
                {FIT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={settings.fit === option.id}
                    aria-label={`${option.label}. ${option.hint}`}
                    className={styles.fitBtn}
                    onClick={() => setFit(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.grid} role="radiogroup" aria-labelledby="wallpaper-label">
              {WALLPAPER_PRESETS.map((preset) => {
                const checked = settings.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    className={styles.tile}
                    onClick={() => selectPreset(preset.id)}
                  >
                    {preset.kind === 'image' ? (
                      <img className={styles.tileThumb} src={preset.src} alt="" draggable={false} />
                    ) : (
                      <span
                        className={styles.tileSwatch}
                        style={{ background: preset.preview }}
                      />
                    )}
                    <span className={styles.tileName}>{preset.name}</span>
                  </button>
                );
              })}

              {hasCustom && customUrl ? (
                <div className={styles.tile}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={settings.id === 'custom'}
                    className={styles.tileHit}
                    onClick={() => selectPreset('custom')}
                  >
                    <img className={styles.tileThumb} src={customUrl} alt="" draggable={false} />
                    <span className={styles.tileName}>Custom</span>
                  </button>
                  <button
                    type="button"
                    className={styles.removeCustom}
                    aria-label="Remove custom wallpaper"
                    onClick={() => void removeCustom()}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                className={`${styles.tile} ${styles.tileBrowse}`}
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                <span className={styles.browseFace}>
                  <Plus size={18} />
                </span>
                <span className={styles.tileName}>{uploading ? 'Adding…' : hasCustom ? 'Replace' : 'Browse'}</span>
              </button>
            </div>

            <input
              ref={fileRef}
              className={styles.fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              aria-hidden="true"
              tabIndex={-1}
              onChange={handleFileChange}
            />

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <div className={styles.content}>
            <h1 className={styles.pageTitle}>Storage & System</h1>
            <p className={styles.pageHint}>
              Manage filesystem boundaries, storage access scope, and system root visibility.
            </p>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Filesystem Scope & Permissions</h2>
                {storageSettings?.allowSystemRoot ? (
                  <span className={`${styles.badge} ${styles.badgeRoot}`}>
                    <AlertTriangle size={12} />
                    Full Root Mode (/)
                  </span>
                ) : (
                  <span className={`${styles.badge} ${styles.badgeSafe}`}>
                    <ShieldCheck size={12} />
                    Safe Server Mode
                  </span>
                )}
              </div>
              <p className={styles.cardDesc}>
                Configure whether Home Cloud is confined to user space and storage pools or has full visibility into
                the host operating system.
              </p>

              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingName}>
                    Allow Full System Root Access (/)
                  </div>
                  <p className={styles.settingHint}>
                    {storageSettings?.allowSystemRoot
                      ? 'Enabled: The File Explorer and services can browse the entire server root (/etc, /var, etc.). Virtual kernel filesystems (/proc, /sys, /dev) remain blocked for process stability.'
                      : 'Disabled: Safe Server Mode is active. Access is confined to your user home ($HOME), mounted pools (/mnt, /media, /srv), and external drives.'}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(storageSettings?.allowSystemRoot)}
                  aria-label="Allow Full System Root Access"
                  className={`${styles.switchButton} ${
                    storageSettings?.allowSystemRoot ? styles.switchButtonActive : ''
                  }`}
                  onClick={() => void handleToggleSystemRoot()}
                  disabled={storageLoading || storageSaving}
                >
                  <span className={styles.switchThumb} />
                </button>
              </div>

              {storageFeedback && (
                <div className={styles.statusToast} role="status">
                  <CheckCircle2 size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
                  {storageFeedback}
                </div>
              )}
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Storage Mounts & User Home</h2>
              <p className={styles.cardDesc}>
                Active primary directories detected on this host.
              </p>

              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingName}>Default User Home (BASE_DIR)</div>
                  <p className={styles.settingHint}>{storageSettings?.baseDir || 'Loading…'}</p>
                </div>
              </div>

              {storageSettings?.drives && storageSettings.drives.length > 0 && (
                <div className={styles.driveList}>
                  {storageSettings.drives.map((d, i) => (
                    <div key={d.fs || i} className={styles.driveCard}>
                      <div className={styles.driveMount}>
                        <HardDrive size={14} />
                        {d.mount}
                      </div>
                      <div className={styles.driveDetails}>
                        {d.fs} • {d.type} {d.size > 0 ? `• ${((d.size) / (1024 ** 3)).toFixed(1)} GB` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
