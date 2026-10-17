import { useEffect, useLayoutEffect, useRef, type ChangeEvent } from 'react';
import { Monitor, Plus, X } from 'lucide-react';
import { useWallpaper } from '../../hooks/useWallpaper';
import { FIT_OPTIONS, WALLPAPER_PRESETS } from '../../utils/wallpaper';
import styles from './settings.module.css';

export default function SettingsApp() {
  const fileRef = useRef<HTMLInputElement>(null);
  const fitGroupRef = useRef<HTMLDivElement>(null);
  const fitPillRef = useRef<HTMLSpanElement>(null);
  const isFirstFitMount = useRef(true);

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

  useLayoutEffect(() => {
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
  }, [settings.fit]);

  useEffect(() => {
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
  }, []);

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
      </div>
    </div>
  );
}
