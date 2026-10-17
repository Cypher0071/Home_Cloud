import wavesSrc from '../assets/desktop_wallpaper.jpg';
import nightSrc from '../assets/wallpaper_night.jpg';
import sandSrc from '../assets/wallpaper_sand.jpg';
import mistSrc from '../assets/wallpaper_mist.jpg';

export const WALLPAPER_STORAGE_KEY = 'home-cloud.wallpaper';
export const WALLPAPER_EVENT = 'home-cloud:wallpaper';

export type WallpaperFit = 'fill' | 'fit' | 'stretch' | 'center';
export type WallpaperId = 'waves' | 'night' | 'sand' | 'mist' | 'charcoal' | 'custom';

export interface WallpaperSettings {
  id: WallpaperId;
  fit: WallpaperFit;
}

export type WallpaperPreset =
  | {
      id: Exclude<WallpaperId, 'custom'>;
      name: string;
      kind: 'image';
      src: string;
      fallback: string;
    }
  | {
      id: Exclude<WallpaperId, 'custom'>;
      name: string;
      kind: 'color';
      value: string;
      preview: string;
    };

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'waves',
    name: 'Waves',
    kind: 'image',
    src: wavesSrc,
    fallback: '#0d1522',
  },
  {
    id: 'night',
    name: 'Night',
    kind: 'image',
    src: nightSrc,
    fallback: '#0b0c10',
  },
  {
    id: 'sand',
    name: 'Sand',
    kind: 'image',
    src: sandSrc,
    fallback: '#c4b8a4',
  },
  {
    id: 'mist',
    name: 'Mist',
    kind: 'image',
    src: mistSrc,
    fallback: '#8a8d92',
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    kind: 'color',
    value: '#121214',
    preview: 'linear-gradient(180deg, #1c1c20 0%, #0c0c0e 100%)',
  },
];

export const FIT_OPTIONS: { id: WallpaperFit; label: string; hint: string }[] = [
  { id: 'fill', label: 'Fill', hint: 'Cover the desktop, crop if needed' },
  { id: 'fit', label: 'Fit', hint: 'Show the whole picture' },
  { id: 'stretch', label: 'Stretch', hint: 'Fill the desktop, may distort' },
  { id: 'center', label: 'Center', hint: 'Original size, centered' },
];

const DEFAULT_SETTINGS: WallpaperSettings = { id: 'waves', fit: 'fill' };
const VALID_IDS = new Set<WallpaperId>([
  'waves',
  'night',
  'sand',
  'mist',
  'charcoal',
  'custom',
]);
const VALID_FITS = new Set<WallpaperFit>(['fill', 'fit', 'stretch', 'center']);

const DB_NAME = 'home-cloud';
const DB_VERSION = 1;
const STORE = 'kv';
const CUSTOM_KEY = 'custom-wallpaper';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_STORED_BYTES = 4 * 1024 * 1024;
const MAX_EDGE = 2560;

export function loadWallpaperSettings(): WallpaperSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<WallpaperSettings>;
    const id = VALID_IDS.has(parsed.id as WallpaperId) ? (parsed.id as WallpaperId) : DEFAULT_SETTINGS.id;
    const fit = VALID_FITS.has(parsed.fit as WallpaperFit)
      ? (parsed.fit as WallpaperFit)
      : DEFAULT_SETTINGS.fit;
    return { id, fit };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveWallpaperSettings(settings: WallpaperSettings): void {
  localStorage.setItem(WALLPAPER_STORAGE_KEY, JSON.stringify(settings));
}

export function notifyWallpaperChange(): void {
  window.dispatchEvent(new Event(WALLPAPER_EVENT));
}

function fitToBackgroundSize(fit: WallpaperFit): string {
  switch (fit) {
    case 'fit':
      return 'contain';
    case 'stretch':
      return '100% 100%';
    case 'center':
      return 'auto';
    case 'fill':
    default:
      return 'cover';
  }
}

export function applyWallpaper(settings: WallpaperSettings, customUrl: string | null): void {
  const root = document.documentElement;
  const preset = WALLPAPER_PRESETS.find((item) => item.id === settings.id);

  if (settings.id === 'custom' && customUrl) {
    root.style.setProperty('--desktop-wallpaper-color', '#0d1522');
    root.style.setProperty('--desktop-wallpaper-image', `url("${customUrl}")`);
  } else if (preset?.kind === 'image') {
    root.style.setProperty('--desktop-wallpaper-color', preset.fallback);
    root.style.setProperty('--desktop-wallpaper-image', `url("${preset.src}")`);
  } else if (preset?.kind === 'color') {
    root.style.setProperty('--desktop-wallpaper-color', preset.value);
    root.style.setProperty('--desktop-wallpaper-image', 'none');
  } else {
    const waves = WALLPAPER_PRESETS[0];
    if (waves.kind === 'image') {
      root.style.setProperty('--desktop-wallpaper-color', waves.fallback);
      root.style.setProperty('--desktop-wallpaper-image', `url("${waves.src}")`);
    }
  }

  root.style.setProperty('--desktop-wallpaper-size', fitToBackgroundSize(settings.fit));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open wallpaper storage.'));
  });
}

export async function getCustomWallpaperBlob(): Promise<Blob | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(CUSTOM_KEY);
      req.onsuccess = () => {
        const value = req.result;
        resolve(value instanceof Blob ? value : null);
      };
      req.onerror = () => reject(req.error ?? new Error('Could not read the custom wallpaper.'));
    });
  } finally {
    db.close();
  }
}

export async function putCustomWallpaperBlob(blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save the custom wallpaper.'));
      tx.objectStore(STORE).put(blob, CUSTOM_KEY);
    });
  } finally {
    db.close();
  }
}

export async function deleteCustomWallpaperBlob(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not remove the custom wallpaper.'));
      tx.objectStore(STORE).delete(CUSTOM_KEY);
    });
  } finally {
    db.close();
  }
}

export async function compressWallpaperFile(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Image is larger than 20 MB.');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not process this image.');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.86);
  });
  if (!blob) {
    throw new Error('Could not process this image.');
  }
  if (blob.size > MAX_STORED_BYTES) {
    throw new Error('This image is too large to save in the browser.');
  }
  return blob;
}
