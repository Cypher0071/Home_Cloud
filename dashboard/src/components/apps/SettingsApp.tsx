import { useState, useEffect, useLayoutEffect, useRef, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Monitor,
  HardDrive,
  Plus,
  X,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Shield,
  LogOut,
  KeyRound,
  Eye,
  EyeOff,
  ArrowUpCircle,
  RefreshCw,
  Loader2,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';
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

interface NetworkInfo {
  serverLocalIp: string | null;
  serverLocalPort?: number;
  cfDomain?: string;
  baseDir?: string | null;
  user?: string;
}

interface StorageSettings {
  allowSystemRoot: boolean;
  baseDir: string;
  drives: StorageDrive[];
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string;
  tagName?: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  publishedAt?: string;
  htmlUrl?: string;
  lastChecked?: string;
  isUpdating?: boolean;
  error?: string | null;
}

export interface UpdateProgress {
  stage: string;
  message: string;
  percent?: number;
}

const UPDATE_STAGES = [
  { id: 'checkout', label: 'Pre-flight & Git Checkout' },
  { id: 'dependencies', label: 'Installing Dependencies' },
  { id: 'build', label: 'Compiling Dashboard' },
  { id: 'restart', label: 'Restarting Service' },
] as const;

function getStageIndex(stage: string): number {
  const s = stage.toLowerCase();
  if (s.includes('check') || s.includes('git') || s.includes('preflight') || s.includes('fetch') || s === '0' || s === '1') {
    return 0;
  }
  if (s.includes('depend') || s.includes('pnpm') || s.includes('dep') || s.includes('install') || s === '2') {
    return 1;
  }
  if (s.includes('build') || s.includes('compil') || s.includes('dash') || s === '3') {
    return 2;
  }
  if (s.includes('restart') || s.includes('reboot') || s.includes('reload') || s === '4') {
    return 3;
  }
  if (s.includes('complete') || s.includes('done') || s.includes('finish') || s.includes('success')) {
    return 4;
  }
  return 0;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function broadcastUpdateStatus(isAvailable: boolean) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('homecloud:update-status', {
        detail: { updateAvailable: isAvailable },
      })
    );
  }
}

export default function SettingsApp() {
  const [activeTab, setActiveTab] = useState<'personalization' | 'storage' | 'security' | 'updates'>('personalization');
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const fitGroupRef = useRef<HTMLDivElement>(null);
  const fitPillRef = useRef<HTMLSpanElement>(null);
  const isFirstFitMount = useRef(true);

  // Storage settings state
  const [storageSettings, setStorageSettings] = useState<StorageSettings | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageFeedback, setStorageFeedback] = useState<string | null>(null);

  // Remote SSH state
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [sshCopied, setSshCopied] = useState(false);

  const fetchNetworkInfo = () => {
    axios.get<NetworkInfo>('/api/network/info')
      .then(res => {
        setNetworkInfo(res.data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    let active = true;
    axios.get<NetworkInfo>('/api/network/info')
      .then(res => {
        if (active) setNetworkInfo(res.data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Security session revocation state
  const [isRevoking, setIsRevoking] = useState(false);
  const [securityFeedback, setSecurityFeedback] = useState<string | null>(null);

  // Change master passcode state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Update Management state
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isUpdateComplete, setIsUpdateComplete] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const watchdogRef = useRef<number | null>(null);

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

  const handleLogoutAll = async () => {
    if (isRevoking) return;
    setIsRevoking(true);
    setSecurityFeedback(null);
    try {
      await axios.post('/api/auth/logout-all');
      setSecurityFeedback('All active sessions revoked. Redirecting to login…');
      setTimeout(() => {
        navigate('/login');
      }, 1000);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : 'Failed to revoke sessions';
      setSecurityFeedback(`Error: ${msg}`);
      setIsRevoking(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (isChangingPassword) return;

    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword) {
      setPasswordError('Current passcode is required');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New passcode must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setIsChangingPassword(true);
    try {
      await axios.post('/api/settings/password', {
        currentPassword,
        newPassword,
      });
      setPasswordSuccess('Passcode updated successfully! All sessions revoked. Redirecting to login…');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        navigate('/login');
      }, 1500);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : 'Failed to update passcode';
      setPasswordError(msg);
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Update handlers
  const fetchUpdateStatus = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await axios.get<UpdateStatus | { update: UpdateStatus }>('/api/settings/update/status');
      const data = 'update' in res.data ? res.data.update : res.data;
      setUpdateStatus(data);
      broadcastUpdateStatus(Boolean(data?.updateAvailable));
      if (data?.isUpdating && !applyingUpdate) {
        setApplyingUpdate(true);
        setUpdateModalOpen(true);
        startReconnectingWatchdog();
      }
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : 'Failed to check update status';
      setUpdateError(msg);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await axios.post<UpdateStatus | { update: UpdateStatus }>('/api/settings/update/check');
      const data = 'update' in res.data ? res.data.update : res.data;
      setUpdateStatus(data);
      broadcastUpdateStatus(Boolean(data?.updateAvailable));
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : 'Failed to check for updates';
      setUpdateError(msg);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const startReconnectingWatchdog = () => {
    if (reconnecting) return;
    setReconnecting(true);
    setUpdateProgress({
      stage: 'restart',
      message: 'Home Cloud is restarting. Waiting for service to become responsive...',
      percent: 95,
    });

    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
    }

    setTimeout(() => {
      watchdogRef.current = window.setInterval(async () => {
        try {
          const res = await axios.get<{ status: string }>(`/api/ping?_t=${Date.now()}`, {
            timeout: 2000,
          });
          if (res.data?.status === 'ok') {
            if (watchdogRef.current) {
              clearInterval(watchdogRef.current);
              watchdogRef.current = null;
            }
            setIsUpdateComplete(true);
            broadcastUpdateStatus(false);
            setUpdateProgress({
              stage: 'complete',
              message: 'Update complete! Reloading dashboard…',
              percent: 100,
            });
            setTimeout(() => {
              window.location.reload();
            }, 1200);
          }
        } catch {
          // Expected while server is offline / restarting
        }
      }, 1500);
    }, 1500);
  };

  const handleApplyUpdate = async () => {
    if (applyingUpdate) return;
    setApplyingUpdate(true);
    setUpdateError(null);
    setIsUpdateComplete(false);
    setReconnecting(false);
    setUpdateProgress({
      stage: 'checkout',
      message: 'Initiating update and verifying git branch...',
      percent: 10,
    });
    setUpdateModalOpen(true);

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/settings/update/progress');
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error || data.stage === 'rollback') {
            setUpdateError(String(data.error || data.message || 'Update failed and was rolled back'));
            setApplyingUpdate(false);
            if (es) es.close();
            return;
          }
          setUpdateProgress({
            stage: data.stage || 'checkout',
            message: data.message || '',
            percent: typeof data.percent === 'number' ? data.percent : undefined,
          });
          if (data.stage === 'restart' || data.done || data.stage === 'complete') {
            if (es) es.close();
            startReconnectingWatchdog();
          }
        } catch {
          if (event.data) {
            setUpdateProgress(prev => ({
              stage: prev?.stage || 'checkout',
              message: String(event.data),
            }));
          }
        }
      };

      es.addEventListener('progress', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error || data.stage === 'rollback') {
            setUpdateError(String(data.error || data.message || 'Update failed and was rolled back'));
            setApplyingUpdate(false);
            if (es) es.close();
            return;
          }
          setUpdateProgress({
            stage: data.stage || 'checkout',
            message: data.message || '',
            percent: typeof data.percent === 'number' ? data.percent : undefined,
          });
          if (data.stage === 'restart') {
            if (es) es.close();
            startReconnectingWatchdog();
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener('error', () => {
        if (es) es.close();
        startReconnectingWatchdog();
      });
    } catch {
      startReconnectingWatchdog();
    }

    try {
      await axios.post('/api/settings/update/apply');
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : 'Failed to initiate update process';
      setUpdateError(msg);
      setApplyingUpdate(false);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  };

  useEffect(() => {
    let active = true;
    axios.get<UpdateStatus | { update: UpdateStatus }>('/api/settings/update/status')
      .then(res => {
        if (!active) return;
        const data = 'update' in res.data ? res.data.update : res.data;
        setUpdateStatus(data);
        broadcastUpdateStatus(Boolean(data?.updateAvailable));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

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

  const currentStageIdx = getStageIndex(updateProgress?.stage || 'checkout');

  const displayPercent = (() => {
    if (isUpdateComplete) return 100;
    if (reconnecting) return 95;
    if (typeof updateProgress?.percent === 'number' && !isNaN(updateProgress.percent)) {
      return Math.min(100, Math.max(0, updateProgress.percent));
    }
    switch (currentStageIdx) {
      case 0:
        return 25;
      case 1:
        return 50;
      case 2:
        return 75;
      case 3:
        return 90;
      default:
        return 10;
    }
  })();

  const detectedUser = networkInfo?.user || (networkInfo?.baseDir ? networkInfo.baseDir.split('/').filter(Boolean).pop() : 'user') || 'user';
  const cfDomain = networkInfo?.cfDomain?.trim() || '';
  const localIp = networkInfo?.serverLocalIp || '127.0.0.1';

  const sshConfigSnippet = `Host home-cloud
    HostName ssh.${cfDomain}
    User ${detectedUser}
    ProxyCommand cloudflared access ssh --hostname %h`;

  const handleCopySshConfig = async () => {
    try {
      await navigator.clipboard.writeText(sshConfigSnippet);
      setSshCopied(true);
      setTimeout(() => setSshCopied(false), 2000);
    } catch {
      // ignore
    }
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
        <button
          type="button"
          className={`${styles.navItem} ${activeTab === 'security' ? styles.navItemActive : ''}`}
          onClick={() => {
            setActiveTab('security');
            void fetchNetworkInfo();
          }}
          aria-current={activeTab === 'security' ? 'page' : undefined}
        >
          <Shield size={15} />
          Security & Sessions
        </button>
        <button
          type="button"
          className={`${styles.navItem} ${activeTab === 'updates' ? styles.navItemActive : ''}`}
          onClick={() => {
            setActiveTab('updates');
            if (!updateStatus && !checkingUpdate) {
              void fetchUpdateStatus();
            }
          }}
          aria-current={activeTab === 'updates' ? 'page' : undefined}
        >
          <ArrowUpCircle size={15} />
          Updates & System
          {updateStatus?.updateAvailable && <span className={styles.navNotificationDot} />}
        </button>
      </nav>

      <div className={styles.main}>
        {activeTab === 'personalization' ? (
          <div className={styles.content}>
            <h1 className={styles.pageTitle}>Background</h1>
            <p className={styles.pageHint}>Personalize your desktop background across all your devices.</p>

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
                  {uploading ? <Loader2 size={18} className={styles.spin} /> : <Plus size={18} />}
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
        ) : activeTab === 'storage' ? (
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
        ) : activeTab === 'security' ? (
          <div className={styles.content}>
            <h1 className={styles.pageTitle}>Security & Sessions</h1>
            <p className={styles.pageHint}>
              Manage active authorization sessions, token revocation, and device access boundaries.
            </p>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Change Master Passcode</h2>
              </div>
              <p className={styles.cardDesc}>
                Update the administrative password used to sign into Home Cloud and access system services.
              </p>

              <form onSubmit={handleChangePassword} className={styles.passwordForm}>
                <div className={styles.formGroup}>
                  <label htmlFor="current-password" className={styles.formLabel}>
                    Current Passcode
                  </label>
                  <div className={styles.inputWrapper}>
                    <input
                      id="current-password"
                      type={showCurrent ? 'text' : 'password'}
                      autoComplete="current-password"
                      className={styles.inputField}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      disabled={isChangingPassword}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setShowCurrent(!showCurrent)}
                      aria-label={showCurrent ? 'Hide current passcode' : 'Show current passcode'}
                    >
                      {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="new-password" className={styles.formLabel}>
                    New Passcode
                  </label>
                  <div className={styles.inputWrapper}>
                    <input
                      id="new-password"
                      type={showNew ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className={styles.inputField}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={isChangingPassword}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setShowNew(!showNew)}
                      aria-label={showNew ? 'Hide new passcode' : 'Show new passcode'}
                    >
                      {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="confirm-password" className={styles.formLabel}>
                    Confirm New Passcode
                  </label>
                  <div className={styles.inputWrapper}>
                    <input
                      id="confirm-password"
                      type={showConfirm ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Repeat new passcode"
                      className={styles.inputField}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isChangingPassword}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setShowConfirm(!showConfirm)}
                      aria-label={showConfirm ? 'Hide confirm passcode' : 'Show confirm passcode'}
                    >
                      {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {passwordError && (
                  <div className={styles.passwordError} role="alert">
                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                    <span>{passwordError}</span>
                  </div>
                )}

                {passwordSuccess && (
                  <div className={styles.passwordSuccess} role="status">
                    <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
                    <span>{passwordSuccess}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  <KeyRound size={13} />
                  {isChangingPassword ? 'Updating…' : 'Update Passcode'}
                </button>
              </form>
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Session Revocation & Token Epoch</h2>
                <span className={`${styles.badge} ${styles.badgeSafe}`}>
                  <ShieldCheck size={12} />
                  Token Epoch Active
                </span>
              </div>
              <p className={styles.cardDesc}>
                Home Cloud issues cryptographically signed JWT tokens containing a server-side Token Epoch.
                Revoking sessions immediately invalidates active tokens across all browsers, phones, and devices
                without changing your master password.
              </p>

              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingName}>Revoke All Active Sessions</div>
                  <p className={styles.settingHint}>
                    Immediately invalidates all existing authorization cookies on every device.
                    You will be required to authenticate again.
                  </p>
                </div>

                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void handleLogoutAll()}
                  disabled={isRevoking}
                >
                  <LogOut size={13} />
                  {isRevoking ? 'Revoking…' : 'Log Out Everywhere'}
                </button>
              </div>

              {securityFeedback && (
                <div className={styles.statusToast} role="status">
                  <CheckCircle2 size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
                  {securityFeedback}
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h2 className={styles.cardTitle}>Remote SSH Access</h2>
                  {cfDomain ? (
                    <span className={`${styles.badge} ${styles.badgeSafe}`}>
                      <ShieldCheck size={12} />
                      Cloudflare Tunnel Active
                    </span>
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeRoot}`}>
                      LAN-Only Mode
                    </span>
                  )}
                </div>
              </div>

              <p className={styles.cardDesc}>
                Connect securely to your server&apos;s command line from anywhere in the world over an encrypted Cloudflare Tunnel, without opening firewall ports.
              </p>

              {cfDomain ? (
                <>
                  <div className={styles.settingRow}>
                    <div className={styles.settingInfo}>
                      <div className={styles.settingName}>Remote Host</div>
                      <div className={styles.settingHint}>Tunnel hostname mapped to local SSH (port 22)</div>
                    </div>
                    <code className={styles.sshHostCode}>ssh.{cfDomain}</code>
                  </div>

                  <div className={styles.sshSnippetContainer}>
                    <div className={styles.sshSnippetHeader}>
                      <div className={styles.sshSnippetLabel}>
                        <Terminal size={13} />
                        <span>~/.ssh/config</span>
                      </div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void handleCopySshConfig()}
                        aria-label={sshCopied ? 'SSH Config Copied' : 'Copy SSH Config'}
                      >
                        {sshCopied ? (
                          <>
                            <Check size={13} style={{ color: '#4ade80' }} />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={13} />
                            <span>Copy SSH Config</span>
                          </>
                        )}
                      </button>
                    </div>
                    <pre className={styles.sshSnippetPre}><code>{sshConfigSnippet}</code></pre>
                  </div>

                  <p className={styles.sshClientNote}>
                    Requires cloudflared on client: brew install cloudflared (Mac), winget install Cloudflare.cloudflared (Windows), or apt install cloudflared (Linux).
                  </p>
                </>
              ) : (
                <div className={styles.sshLanFallback}>
                  <p className={styles.sshLanText}>
                    Remote SSH is available when Cloudflare Tunnel is configured. Local SSH is active at:{' '}
                    <code className={styles.inlineCode}>ssh {detectedUser}@{localIp}</code>
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.content}>
            <h1 className={styles.pageTitle}>Updates & System</h1>
            <p className={styles.pageHint}>
              Manage Home Cloud core releases, review version changelogs, and perform zero-downtime upgrades.
            </p>

            {updateError && !updateModalOpen && (
              <div className={styles.passwordError} role="alert" style={{ marginBottom: 16 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>{updateError}</span>
              </div>
            )}

            <div className={`${styles.updateCard} ${updateStatus?.updateAvailable ? styles.updateCardAvailable : ''}`}>
              <div className={styles.cardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h2 className={styles.cardTitle}>Home Cloud Core</h2>
                  {checkingUpdate ? (
                    <span className={`${styles.versionBadge} ${styles.badgeChecking}`}>
                      <Loader2 size={12} className={styles.spin} />
                      Checking…
                    </span>
                  ) : updateStatus?.updateAvailable ? (
                    <span className={`${styles.versionBadge} ${styles.badgeAvailable}`}>
                      <ArrowUpCircle size={12} />
                      Update Available
                    </span>
                  ) : (
                    <span className={`${styles.versionBadge} ${styles.badgeUpToDate}`}>
                      <CheckCircle2 size={12} />
                      Up to Date
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void handleCheckUpdate()}
                  disabled={checkingUpdate || applyingUpdate}
                >
                  <RefreshCw size={13} className={checkingUpdate ? styles.spin : ''} />
                  {checkingUpdate ? 'Checking…' : 'Check for Updates'}
                </button>
              </div>

              <p className={styles.cardDesc}>
                Home Cloud tracks updates and official release milestones directly from GitHub.
              </p>

              <div className={styles.versionInfo}>
                <div className={styles.versionColumn}>
                  <span className={styles.versionLabel}>Current Version</span>
                  <span className={styles.versionNumber}>
                    {updateStatus?.currentVersion || (checkingUpdate ? 'Checking…' : 'Loading…')}
                  </span>
                </div>

                <div className={styles.versionDivider}>
                  <ArrowRight size={14} />
                </div>

                <div className={styles.versionColumn}>
                  <span className={styles.versionLabel}>Latest Version</span>
                  <span className={styles.versionNumber}>
                    {updateStatus?.latestVersion || updateStatus?.tagName || updateStatus?.currentVersion || '—'}
                  </span>
                </div>

                {updateStatus?.lastChecked && (
                  <div className={styles.versionCheckedInfo}>
                    <span className={styles.versionLabel}>Last Checked</span>
                    <span className={styles.versionCheckedDate}>
                      {formatDate(updateStatus.lastChecked)}
                    </span>
                  </div>
                )}
              </div>

              {updateStatus?.updateAvailable ? (
                <>
                  {updateStatus.releaseNotes && (
                    <div className={styles.releaseNotesWrapper}>
                      <div className={styles.releaseNotesHeader}>
                        <span className={styles.releaseNotesTitle}>
                          Release Notes {updateStatus.tagName ? `(${updateStatus.tagName})` : ''}
                        </span>
                        {updateStatus.htmlUrl && (
                          <a
                            href={updateStatus.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.releaseLink}
                          >
                            View on GitHub <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                      <div className={styles.releaseNotesContainer}>
                        <pre className={styles.releaseNotesText}>
                          {updateStatus.releaseNotes}
                        </pre>
                      </div>
                    </div>
                  )}

                  <div className={styles.updateActionRow}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => setConfirmDialogOpen(true)}
                      disabled={applyingUpdate || checkingUpdate}
                    >
                      <ArrowUpCircle size={14} />
                      Update Now
                    </button>
                    <span className={styles.updateActionHint}>
                      Automates git checkout, dependency installation, dashboard compilation, and daemon restart.
                    </span>
                  </div>
                </>
              ) : !checkingUpdate && updateStatus ? (
                <div className={styles.upToDateBanner}>
                  <CheckCircle2 size={16} className={styles.upToDateIcon} />
                  <div>
                    <div className={styles.upToDateTitle}>Your Home Cloud is up to date</div>
                    <div className={styles.upToDateDesc}>
                      You are running version {updateStatus.currentVersion}. No updates are available at this time.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {confirmDialogOpen && (
        <div
          className={styles.updateModalOverlay}
          onClick={() => setConfirmDialogOpen(false)}
        >
          <div
            className={styles.updateModal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle} id="confirm-modal-title">
                <AlertTriangle size={18} style={{ color: '#f59e0b' }} />
                Confirm System Update
              </div>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setConfirmDialogOpen(false)}
                aria-label="Close dialog"
              >
                <X size={15} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <p className={styles.modalWarningText}>
                Home Cloud will download dependencies, rebuild the dashboard, and restart the service. Active sessions will momentarily reconnect.
              </p>

              <div className={styles.modalVersionPills}>
                <div className={styles.modalVersionPill}>
                  <span className={styles.modalVersionLabel}>Current Version</span>
                  <span className={styles.modalVersionValue}>{updateStatus?.currentVersion || 'Installed'}</span>
                </div>
                <ArrowRight size={14} className={styles.modalVersionArrow} />
                <div className={styles.modalVersionPill}>
                  <span className={styles.modalVersionLabel}>Target Version</span>
                  <span className={styles.modalVersionValue}>
                    {updateStatus?.latestVersion || updateStatus?.tagName || 'Latest'}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setConfirmDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  setConfirmDialogOpen(false);
                  void handleApplyUpdate();
                }}
              >
                <ArrowUpCircle size={13} />
                Proceed with Update
              </button>
            </div>
          </div>
        </div>
      )}

      {updateModalOpen && (
        <div className={styles.updateModalOverlay}>
          <div
            className={styles.updateModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="progress-modal-title"
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle} id="progress-modal-title">
                {updateError ? (
                  <AlertTriangle size={18} style={{ color: '#f87171' }} />
                ) : isUpdateComplete ? (
                  <CheckCircle2 size={18} style={{ color: '#4ade80' }} />
                ) : (
                  <Loader2 size={18} className={styles.spin} style={{ color: '#60a5fa' }} />
                )}
                {updateError
                  ? 'Update Failed'
                  : isUpdateComplete
                  ? 'Update Complete!'
                  : reconnecting
                  ? 'Restarting Service…'
                  : 'Applying System Update'}
              </div>
              {updateError && (
                <button
                  type="button"
                  className={styles.modalCloseBtn}
                  onClick={() => {
                    setUpdateModalOpen(false);
                    setApplyingUpdate(false);
                    setReconnecting(false);
                  }}
                  aria-label="Close dialog"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className={styles.modalBody}>
              <div className={styles.progressContainer}>
                <div className={styles.progressHeader}>
                  <span className={styles.progressLabel}>
                    {reconnecting
                      ? 'Restarting & Reconnecting'
                      : updateProgress?.message || 'In progress…'}
                  </span>
                  <span className={styles.progressPercent}>{displayPercent}%</span>
                </div>
                <div className={styles.progressBar}>
                  <div
                    className={`${styles.progressBarFill} ${
                      updateError
                        ? styles.progressBarFillError
                        : isUpdateComplete
                        ? styles.progressBarFillSuccess
                        : ''
                    }`}
                    style={{ width: `${displayPercent}%` }}
                  />
                </div>
              </div>

              <div className={styles.updateStepList}>
                {UPDATE_STAGES.map((step, idx) => {
                  const isCompleted =
                    isUpdateComplete ||
                    (reconnecting && idx < 3) ||
                    (!updateError && currentStageIdx > idx);
                  const isActive =
                    !isUpdateComplete &&
                    !updateError &&
                    (reconnecting ? idx === 3 : currentStageIdx === idx);
                  const isFailed = Boolean(updateError && currentStageIdx === idx);

                  return (
                    <div
                      key={step.id}
                      className={`${styles.updateStepItem} ${
                        isCompleted
                          ? styles.stepCompleted
                          : isActive
                          ? styles.stepActive
                          : isFailed
                          ? styles.stepFailed
                          : styles.stepPending
                      }`}
                    >
                      <div className={styles.stepIconWrapper}>
                        {isCompleted ? (
                          <CheckCircle2 size={15} className={styles.stepSuccessIcon} />
                        ) : isActive ? (
                          <Loader2 size={15} className={styles.spin} />
                        ) : isFailed ? (
                          <AlertTriangle size={15} className={styles.stepFailedIcon} />
                        ) : (
                          <span className={styles.stepNumber}>{idx + 1}</span>
                        )}
                      </div>
                      <div className={styles.stepInfo}>
                        <span className={styles.stepTitle}>{step.label}</span>
                        {isActive && updateProgress?.message && (
                          <span className={styles.stepSubtext}>{updateProgress.message}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {updateProgress?.message && !updateError && (
                <div className={styles.liveLogMessage}>
                  <span className={styles.liveLogDot} />
                  <span className={styles.liveLogText}>{updateProgress.message}</span>
                </div>
              )}

              {reconnecting && (
                <div className={styles.reconnectingBanner}>
                  <Loader2 size={14} className={styles.spin} />
                  <span>Polling Home Cloud service at /api/ping…</span>
                </div>
              )}

              {updateError && (
                <div className={styles.modalErrorBox} role="alert">
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <div className={styles.modalErrorText}>{updateError}</div>
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              {updateError ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    setUpdateModalOpen(false);
                    setApplyingUpdate(false);
                    setReconnecting(false);
                  }}
                >
                  Close & Retry
                </button>
              ) : isUpdateComplete ? (
                <span className={styles.modalFooterStatus}>Reloading in a moment…</span>
              ) : (
                <span className={styles.modalFooterStatus}>
                  Please keep this window open while updates are applied.
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
