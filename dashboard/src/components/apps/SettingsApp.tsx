import { useState, useEffect, useLayoutEffect, useRef, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, HardDrive, Plus, X, ShieldCheck, AlertTriangle, CheckCircle2, Shield, LogOut, KeyRound, Eye, EyeOff } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<'personalization' | 'storage' | 'security'>('personalization');
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
        <button
          type="button"
          className={`${styles.navItem} ${activeTab === 'security' ? styles.navItemActive : ''}`}
          onClick={() => setActiveTab('security')}
          aria-current={activeTab === 'security' ? 'page' : undefined}
        >
          <Shield size={15} />
          Security & Sessions
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
        ) : (
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
          </div>
        )}
      </div>
    </div>
  );
}
