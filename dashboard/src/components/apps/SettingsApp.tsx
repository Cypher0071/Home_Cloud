import { useRef, type ChangeEvent } from 'react';
import { Monitor, Plus, X } from 'lucide-react';
import { useWallpaper } from '../../hooks/useWallpaper';
import { FIT_OPTIONS, WALLPAPER_PRESETS } from '../../utils/wallpaper';
import styles from './settings.module.css';

export default function SettingsApp() {
  const fileRef = useRef<HTMLInputElement>(null);
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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void uploadCustom(file);
  };

  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="Settings">
        <button type="button" className={`${styles.navItem} ${styles.navItemActive}`} aria-current="page">
          <Monitor size={15} />
          Personalization
        </button>
      </nav>

      <div className={styles.main}>
        <div className={styles.content}>
          <h1 className={styles.pageTitle}>Background</h1>
          <p className={styles.pageHint}>Desktop wallpaper for this browser.</p>

          <div className={styles.preview} aria-hidden="true" />

          <div className={styles.sectionHeader}>
            <p className={styles.sectionLabel} id="wallpaper-label">
              Choose a picture
            </p>
            <div className={styles.fitGroup} role="radiogroup" aria-label="Wallpaper fit">
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
      </div>
    </div>
  );
}
