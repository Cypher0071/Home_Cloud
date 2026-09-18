import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  Search,
  Plus,
  Copy,
  Check,
  Clipboard,
  Trash2,
  Edit2,
  Folder,
  FileText,
  Image,
  HardDrive,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  Upload,
  Loader2,
  AlertTriangle,
  Eye,
  Download,
  Scissors,
  FileCode,
  Film,
  Music,
  FileArchive,
} from 'lucide-react';
import styles from './files.module.css';
import axios from 'axios';
import { Highlight, themes } from 'prism-react-renderer';
import { useNetworkDetector } from '../hooks/useNetworkDetector';
import { useIsMobile } from '../hooks/useIsMobile';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DriveInfo {
  fs: string;
  type: string;
  size: number;
  used: number;
  available: number;
  use: number;
  mount: string;
}

interface FileItem {
  name: string;
  type: 'folder' | 'file';
  size: string;
  sizeRaw: number;
  modified: string;
  ext?: string;
  mimeType?: string | null;
  path?: string; // absolute path for search results
  isNewPlaceholder?: boolean; // temporary placeholder for inline creation
  isSymlink?: boolean;
  isBroken?: boolean;
}

export type SortField = 'name' | 'size' | 'modified';
export type SortDirection = 'asc' | 'desc';

interface ClipboardState {
  items: FileItem[];
  sourcePath: string;
  action: 'copy' | 'cut';
}

// ─── Constants ───────────────────────────────────────────────────────────────

function isInsideBasePath(p: string, basePath: string | null): boolean {
  if (!basePath) return false;
  return p === basePath || p.startsWith(basePath + '/');
}

function isSafeEntryName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const TEXT_EXTS  = [
  'txt', 'md', 'markdown', 'log', 'csv', 'json', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'conf', 'env', 'sh', 'bash', 'zsh', 'fish',
  'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp',
  'h', 'hpp', 'css', 'html', 'xml', 'sql', 'dockerfile', 'gitignore',
];
const CODE_EXTS = [
  'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp',
  'h', 'hpp', 'css', 'html', 'xml', 'sql', 'sh', 'bash', 'zsh',
  'json', 'yaml', 'yml', 'toml',
];
const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'];
const PDF_EXTS   = ['pdf'];
const VIDEO_EXTS = ['mp4', 'webm', 'ogg', 'mkv', 'mov', 'avi'];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(raw: string | Date): string {
  const d = new Date(raw);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function getExt(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function viewerTypeFor(ext: string): 'image' | 'text' | 'pdf' | 'video' | 'audio' | 'unsupported' {
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (TEXT_EXTS.includes(ext))  return 'text';
  if (PDF_EXTS.includes(ext))   return 'pdf';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  return 'unsupported';
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const fetchDrives = async (): Promise<DriveInfo[]> => {
  try {
    const response = await axios.get<DriveInfo[]>('/api/files/drives');
    return Array.isArray(response.data) ? response.data : [];
  } catch {
    return [];
  }
};

const fetchFiles = async (dirPath: string): Promise<FileItem[]> => {
  const response = await axios.get('/api/files', { params: { path: dirPath } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return response.data.files.map((f: any): FileItem => ({
    name: f.name,
    type: f.isDirectory ? 'folder' : 'file',
    size: f.isDirectory ? '--' : formatBytes(f.size),
    sizeRaw: f.size ?? 0,
    modified: formatDate(f.modified),
    ext: f.isDirectory ? undefined : getExt(f.name),
    mimeType: f.mimeType ?? null,
    isSymlink: f.isSymlink ?? false,
    isBroken: f.isBroken ?? false,
  }));
};

function viewUrl(filePath: string): string {
  return `/api/files/view?path=${encodeURIComponent(filePath)}`;
}

function mapExtensionToLanguage(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'js' || e === 'jsx') return 'javascript';
  if (e === 'ts' || e === 'tsx') return 'typescript';
  if (e === 'py') return 'python';
  if (e === 'json') return 'json';
  if (e === 'css') return 'css';
  if (e === 'html') return 'html';
  if (e === 'md' || e === 'markdown') return 'markdown';
  if (e === 'sh' || e === 'bash' || e === 'zsh') return 'bash';
  if (e === 'sql') return 'sql';
  if (e === 'yaml' || e === 'yml') return 'yaml';
  return 'text';
}

// ─── File Viewer Modal ────────────────────────────────────────────────────────

interface ViewerProps {
  filePath: string;   // full absolute path
  fileName: string;
  ext: string;
  onClose: () => void;
}

function FileViewer({ filePath, fileName, ext, onClose }: ViewerProps) {
  const kind = viewerTypeFor(ext);
  const url  = viewUrl(filePath);

  const [textContent, setTextContent] = useState<string | null>(null);
  const [textError, setTextError]     = useState<string | null>(null);

  // Fetch raw text for text files
  useEffect(() => {
    if (kind !== 'text') return;
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.text();
      })
      .then(setTextContent)
      .catch(e => setTextError(e.message));
  }, [url, kind]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 200,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex', flexDirection: 'column',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={onClose}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px',
          background: '#0a0a0a',
          borderBottom: '1px solid #262626',
          flexShrink: 0,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <FileText size={15} style={{ color: '#ededed' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#ededed' }}>{fileName}</span>
          <span style={{
            fontSize: '11px', color: '#a1a1a1',
            background: '#111111',
            border: '1px solid #262626',
            padding: '2px 6px', borderRadius: '4px',
            fontFamily: 'var(--mono)',
          }}>{ext ? ext.toUpperCase() : 'FILE'}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <a
            href={`/api/files/download?path=${encodeURIComponent(filePath)}`}
            download={fileName}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 12px', borderRadius: '6px',
              background: '#ffffff', color: '#000000',
              fontSize: '12px', fontWeight: 550, textDecoration: 'none', cursor: 'pointer',
              border: '1px solid transparent',
            }}
            onClick={e => e.stopPropagation()}
          >
            <Download size={13} /> Download
          </a>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '28px', height: '28px', borderRadius: '6px',
              background: '#111111', border: '1px solid #262626',
              color: '#a1a1a1', cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
        onClick={e => e.stopPropagation()}
      >
        {kind === 'image' && (
          <img
            src={url}
            alt={fileName}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 12px 36px rgba(0,0,0,0.6)' }}
          />
        )}

        {kind === 'pdf' && (
          <iframe
            src={url}
            title={fileName}
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: '8px' }}
          />
        )}

        {kind === 'video' && (
          <video controls style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px', boxShadow: '0 12px 36px rgba(0,0,0,0.6)' }}>
            <source src={url} />
            Your browser does not support video playback.
          </video>
        )}

        {kind === 'audio' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <Music size={48} style={{ color: '#ffffff' }} />
            <span style={{ color: '#d4d4d8', fontSize: '14px', fontWeight: 500 }}>{fileName}</span>
            <audio controls style={{ width: '380px' }}>
              <source src={url} />
              Your browser does not support audio playback.
            </audio>
          </div>
        )}

        {kind === 'text' && (
          <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
            {textContent === null && textError === null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '10px', color: '#71717a' }}>
                <Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite' }} />
                <span>Loading file...</span>
              </div>
            )}
            {textError && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '10px', color: '#f87171' }}>
                <AlertTriangle size={18} /> {textError}
              </div>
            )}
            {textContent !== null && (
              <Highlight
                theme={themes.vsDark}
                code={textContent}
                language={mapExtensionToLanguage(ext)}
              >
                {({ className, style, tokens, getLineProps, getTokenProps }) => (
                  <pre
                    className={className}
                    style={{
                      ...style,
                      margin: 0,
                      padding: '16px',
                      fontSize: '12.5px',
                      lineHeight: '1.6',
                      fontFamily: 'var(--mono)',
                      borderRadius: '8px',
                      border: '1px solid #262626',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      minHeight: '100%',
                      background: '#000000',
                    }}
                  >
                    {tokens.map((line, i) => (
                      <div key={i} {...getLineProps({ line })} style={{ display: 'flex' }}>
                        {/* Line number */}
                        <span style={{
                          display: 'inline-block',
                          width: '28px',
                          userSelect: 'none',
                          opacity: 0.35,
                          fontSize: '11px',
                          textAlign: 'right',
                          paddingRight: '12px',
                          color: '#858585',
                          fontFamily: 'var(--mono)',
                        }}>{i + 1}</span>
                        <div>
                          {line.map((token, key) => (
                            <span key={key} {...getTokenProps({ token })} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </pre>
                )}
              </Highlight>
            )}
          </div>
        )}

        {kind === 'unsupported' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: '#71717a' }}>
            <FileText size={56} style={{ opacity: 0.3 }} />
            <p style={{ margin: 0, fontSize: '13px' }}>No preview available for <strong style={{ color: '#a1a1aa' }}>.{ext}</strong> files</p>
            <a
              href={`/api/files/download?path=${encodeURIComponent(filePath)}`}
              download={fileName}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '8px',
                background: '#ffffff', color: '#09090b',
                fontSize: '13px', fontWeight: 550, textDecoration: 'none',
              }}
            >
              <Download size={14} /> Download instead
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FileExplorer() {
  const net = useNetworkDetector();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const basePath = net.baseDir;
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Multi-selection state
  const [selectedItemNames, setSelectedItemNames] = useState<Set<string>>(new Set());
  const [lastSelectedName, setLastSelectedName] = useState<string | null>(null);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Mouse Drag Selection (Marquee) State
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const itemsContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartSelectionRef = useRef<Set<string>>(new Set());

  const [currentFiles, setCurrentFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search state
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchRefreshTrigger, setSearchRefreshTrigger] = useState<number>(0);

  // Viewer state
  const [viewingFile, setViewingFile] = useState<{ path: string; name: string; ext: string } | null>(null);

  // Copy path feedback
  const [copiedPath, setCopiedPath] = useState<boolean>(false);

  // Address Bar & Breadcrumbs State & Refs
  const breadcrumbsRef = useRef<HTMLDivElement>(null);
  const activeBreadcrumbRef = useRef<HTMLSpanElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const [isEditingPath, setIsEditingPath] = useState<boolean>(false);
  const [pathInputValue, setPathInputValue] = useState<string>('');

  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [renamingItem, setRenamingItem] = useState<{
    oldName: string;
    newName: string;
    path?: string; // absolute path if available (for search results)
  } | null>(null);

  const [newItem, setNewItem] = useState<{
    type: 'folder' | 'file';
    name: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState<string>('');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: FileItem | null;  // null = right-clicked on empty background
  } | null>(null);

  // Close context menu on any click outside
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, []);

  // ─── Load directory ───
  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true);
    setLoadError(null);
    setSelectedItemNames(new Set());
    setLastSelectedName(null);
    setCurrentFiles([]);
    try {
      const files = await fetchFiles(dirPath);
      setCurrentFiles(files);
    } catch {
      setLoadError('Could not read directory. Check permissions.');
      setCurrentFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (basePath && !currentPath) {
      setCurrentPath(basePath);
      setHistory([basePath]);
      setHistoryIndex(0);
    }
  }, [basePath, currentPath]);

  useEffect(() => {
    if (!currentPath) return;
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  useEffect(() => {
    fetchDrives().then(setDrives);
  }, []);

  // ─── Backend search trigger effect with debounce & cancellation ───
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const controller = new AbortController();

    const delayDebounceFn = setTimeout(async () => {
      try {
        const response = await axios.get('/api/files/search', {
          params: { search: searchQuery, path: currentPath },
          signal: controller.signal,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mappedResults = response.data.map((f: any): FileItem => ({
          name: f.name,
          type: f.isDirectory ? 'folder' : 'file',
          size: f.isDirectory ? '--' : formatBytes(f.size),
          sizeRaw: f.size ?? 0,
          modified: formatDate(f.modified),
          ext: f.isDirectory ? undefined : getExt(f.name),
          mimeType: f.mimeType ?? null,
          path: f.path,
        }));

        setSearchResults(mappedResults);
      } catch (err: any) {
        if (axios.isCancel(err)) {
          return;
        }
        console.error(err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(delayDebounceFn);
      controller.abort();
    };
  }, [searchQuery, currentPath, searchRefreshTrigger]);

  // ─── Sorting Handler & Sorted Items Memo ───
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const currentFolderTitle = currentPath.split('/').pop() || currentPath;
  const isLoading = loading || searchLoading;
  const rawFiles = searchQuery ? searchResults : currentFiles;

  const displayedFiles = useMemo(() => {
    const list = [...rawFiles];
    return list.sort((a, b) => {
      // Pin folders to the top always
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;

      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortField === 'size') {
        comparison = (a.sizeRaw ?? 0) - (b.sizeRaw ?? 0);
      } else if (sortField === 'modified') {
        const timeA = new Date(a.modified).getTime() || 0;
        const timeB = new Date(b.modified).getTime() || 0;
        comparison = timeA - timeB;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [rawFiles, sortField, sortDirection]);
  
  const itemsToRender = useMemo(() => {
    if (!newItem) return displayedFiles;
    return [
      {
        name: newItem.name,
        type: newItem.type,
        size: '--',
        sizeRaw: 0,
        modified: '--',
        isNewPlaceholder: true,
      } as FileItem,
      ...displayedFiles,
    ];
  }, [newItem, displayedFiles]);

  // Single item helper for rename / view
  const selectedSingleItem = useMemo(() => {
    if (selectedItemNames.size !== 1) return null;
    const singleName = Array.from(selectedItemNames)[0];
    return displayedFiles.find(item => item.name === singleName) || null;
  }, [selectedItemNames, displayedFiles]);

  // Total selected size calculation
  const selectedTotalBytes = useMemo(() => {
    let total = 0;
    displayedFiles.forEach(f => {
      if (selectedItemNames.has(f.name) && f.type === 'file') {
        total += f.sizeRaw ?? 0;
      }
    });
    return total;
  }, [displayedFiles, selectedItemNames]);

  // ─── Mouse Drag Selection Handler ───
  const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Left click only
    const target = e.target as HTMLElement;
    if (target.closest('input') || target.closest('button') || target.closest('a')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const isCtrl = e.ctrlKey || e.metaKey;
    dragStartSelectionRef.current = isCtrl ? new Set(selectedItemNames) : new Set();
    let hasMoved = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);
      if (!hasMoved && (dx > 4 || dy > 4)) {
        hasMoved = true;
        isDraggingRef.current = true;
        window.getSelection()?.removeAllRanges();
      }

      if (hasMoved) {
        const currentX = moveEvent.clientX;
        const currentY = moveEvent.clientY;
        setMarquee({ startX, startY, currentX, currentY });

        const marqueeRect = {
          left: Math.min(startX, currentX),
          top: Math.min(startY, currentY),
          right: Math.max(startX, currentX),
          bottom: Math.max(startY, currentY),
        };

        if (itemsContainerRef.current) {
          const rowEls = itemsContainerRef.current.querySelectorAll<HTMLElement>('[data-filename]');
          const newlySelected = new Set(dragStartSelectionRef.current);

          rowEls.forEach(rowEl => {
            const fileName = rowEl.dataset.filename;
            if (!fileName) return;

            const rowRect = rowEl.getBoundingClientRect();
            const isIntersecting = !(
              marqueeRect.right < rowRect.left ||
              marqueeRect.left > rowRect.right ||
              marqueeRect.bottom < rowRect.top ||
              marqueeRect.top > rowRect.bottom
            );

            if (isIntersecting) {
              newlySelected.add(fileName);
            } else if (!dragStartSelectionRef.current.has(fileName)) {
              newlySelected.delete(fileName);
            }
          });

          setSelectedItemNames(newlySelected);
        }
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setMarquee(null);
      setTimeout(() => {
        isDraggingRef.current = false;
      }, 50);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // ─── Item Click Handler ───
  const handleItemClick = (e: React.MouseEvent, item: FileItem) => {
    e.stopPropagation();
    if (isDraggingRef.current) return;
    if (item.isNewPlaceholder) return;
    setContextMenu(null);

    const isMulti = e.ctrlKey || e.metaKey;
    const isRange = e.shiftKey;

    if (isRange && lastSelectedName) {
      const names = itemsToRender.map(f => f.name);
      const startIdx = names.indexOf(lastSelectedName);
      const endIdx = names.indexOf(item.name);
      if (startIdx !== -1 && endIdx !== -1) {
        const [low, high] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
        const rangeNames = names.slice(low, high + 1);
        setSelectedItemNames(new Set(rangeNames));
        return;
      }
    }

    if (isMulti) {
      setSelectedItemNames(prev => {
        const next = new Set(prev);
        if (next.has(item.name)) {
          next.delete(item.name);
        } else {
          next.add(item.name);
        }
        return next;
      });
      setLastSelectedName(item.name);
    } else {
      setSelectedItemNames(new Set([item.name]));
      setLastSelectedName(item.name);
    }

    if (renamingItem && renamingItem.oldName !== item.name) {
      setRenamingItem(null);
    }
  };

  // ─── Navigation ───
  const navigateToPath = (newPath: string) => {
    setRenamingItem(null);
    const cleanPath = newPath.replace(/\/$/, '') || '/';
    if (!isInsideBasePath(cleanPath, basePath)) return;
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(cleanPath);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(cleanPath);
    setSearchQuery('');
  };

  // Auto-scroll breadcrumbs horizontally so active folder is in view
  useEffect(() => {
    if (!isEditingPath) {
      if (activeBreadcrumbRef.current) {
        activeBreadcrumbRef.current.scrollIntoView({
          behavior: 'smooth',
          inline: 'nearest',
          block: 'nearest',
        });
      } else if (breadcrumbsRef.current) {
        breadcrumbsRef.current.scrollTo({
          left: breadcrumbsRef.current.scrollWidth,
          behavior: 'smooth',
        });
      }
    }
  }, [currentPath, isEditingPath]);

  // Focus and select all text when switching to direct path input mode
  useEffect(() => {
    if (isEditingPath && pathInputRef.current) {
      pathInputRef.current.focus();
      pathInputRef.current.select();
    }
  }, [isEditingPath]);

  // Translate vertical wheel rolling over breadcrumbs into horizontal scrolling
  const handleBreadcrumbWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (breadcrumbsRef.current && e.deltaY !== 0) {
      breadcrumbsRef.current.scrollLeft += e.deltaY;
    }
  };

  // Handle Enter to submit or Escape to cancel in direct path input mode
  const handlePathInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = pathInputValue.trim();
      if (raw) {
        let resolved = raw;
        if (!raw.startsWith('/')) {
          resolved = `${currentPath}/${raw}`.replace(/\/+/g, '/');
        } else {
          resolved = resolved.replace(/\/+/g, '/');
        }
        if (resolved.length > 1 && resolved.endsWith('/')) {
          resolved = resolved.slice(0, -1);
        }
        if (!isInsideBasePath(resolved, basePath)) {
          alert(`Path must be inside base directory: ${basePath || '/'}`);
          return;
        }
        navigateToPath(resolved);
      }
      setIsEditingPath(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditingPath(false);
    }
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const target = history[newIndex];
      if (!isInsideBasePath(target, basePath)) return;
      setHistoryIndex(newIndex);
      setCurrentPath(target);
      setSearchQuery('');
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const target = history[newIndex];
      if (!isInsideBasePath(target, basePath)) return;
      setHistoryIndex(newIndex);
      setCurrentPath(target);
      setSearchQuery('');
    }
  };

  const handleUp = () => {
    if (basePath && currentPath !== basePath) {
      const parts = currentPath.split('/');
      parts.pop();
      const parent = parts.join('/') || '/';
      if (!isInsideBasePath(parent, basePath)) return;
      navigateToPath(parent);
    }
  };

  const handleCopyPath = () => {
    if (currentPath) {
      navigator.clipboard.writeText(currentPath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 1500);
    }
  };

  // ─── Double-click handler ───
  const handleItemDoubleClick = (item: FileItem) => {
    if (item.isBroken) {
      alert('Cannot open: target file or directory does not exist (broken symlink).');
      return;
    }
    if (item.type === 'folder') {
      navigateToPath(`${currentPath}/${item.name}`);
    } else {
      setViewingFile({
        path: `${currentPath}/${item.name}`,
        name: item.name,
        ext: item.ext || '',
      });
    }
  };

  // ─── Icons ───
  const getFileIcon = (item: FileItem) => {
    if (item.isBroken) {
      return <AlertTriangle size={16} color="#f87171" />;
    }
    if (item.type === 'folder') {
      return <Folder className={styles.iconFolder} size={16} fill="#fbbf24" color="#fbbf24" />;
    }
    const ext = item.ext?.toLowerCase() || '';
    if (CODE_EXTS.includes(ext)) {
      return <FileCode className={styles.iconCode} size={16} />;
    }
    if (IMAGE_EXTS.includes(ext)) {
      return <Image className={styles.iconImage} size={16} />;
    }
    if (VIDEO_EXTS.includes(ext)) {
      return <Film className={styles.iconMedia} size={16} />;
    }
    if (AUDIO_EXTS.includes(ext)) {
      return <Music className={styles.iconMedia} size={16} />;
    }
    if (ARCHIVE_EXTS.includes(ext)) {
      return <FileArchive className={styles.iconZip} size={16} />;
    }
    return <FileText className={styles.iconDoc} size={16} />;
  };

  // ─── Operations ───
  const handleCreateNew = (type: 'folder' | 'file') => {
    const defaultName = type === 'folder' ? 'New Folder' : 'New File';
    setNewItem({ type, name: defaultName });
  };

  const handleFinishCreate = async () => {
    if (!newItem) return;
    const name = newItem.name.trim();
    const type = newItem.type;

    setNewItem(null);

    if (!name) return;
    if (!isSafeEntryName(name)) return;

    try {
      const endpoint = type === 'folder' ? '/api/files/folder' : '/api/files/file';
      await axios.post(endpoint, {
        name,
        path: currentPath,
      });
      loadDirectory(currentPath);
    } catch (err: any) {
      const msg = err.response?.data?.error ?? `Failed to create ${type}`;
      alert(`Error: ${msg}`);
      loadDirectory(currentPath);
    }
  };

  // ─── Batch Delete Operation ───
  const handleDelete = async (itemName?: string) => {
    let targets: FileItem[] = [];
    if (itemName) {
      const found = displayedFiles.find(f => f.name === itemName);
      if (found) targets = [found];
    } else {
      targets = displayedFiles.filter(f => selectedItemNames.has(f.name));
    }

    if (targets.length === 0) return;

    const confirmMsg =
      targets.length === 1
        ? `Delete "${targets[0].name}"? This cannot be undone.`
        : `Delete ${targets.length} items? This cannot be undone.`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await Promise.all(
        targets.map(t => {
          const targetPath = t.path || `${currentPath}/${t.name}`;
          return axios.delete('/api/files/delete', { params: { path: targetPath } });
        })
      );
      setSelectedItemNames(new Set());
      setLastSelectedName(null);
      if (searchQuery) {
        setSearchRefreshTrigger(prev => prev + 1);
      } else {
        loadDirectory(currentPath);
      }
    } catch {
      alert('Failed to delete some or all selected items.');
    }
  };

  const handleStartRename = (itemName?: string) => {
    const target = itemName
      ? displayedFiles.find(f => f.name === itemName) ?? null
      : selectedSingleItem;
    if (target) {
      setRenamingItem({
        oldName: target.name,
        newName: target.name,
        path: target.path,
      });
    }
  };

  const handleFinishRename = async () => {
    if (!renamingItem) return;

    const oldName = renamingItem.oldName.trim();
    const newName = renamingItem.newName.trim();

    if (!newName || oldName === newName) {
      setRenamingItem(null);
      return;
    }
    if (!isSafeEntryName(newName)) {
      setRenamingItem(null);
      return;
    }

    const oldPath = renamingItem.path || `${currentPath}/${oldName}`;
    const targetDir = renamingItem.path
      ? renamingItem.path.substring(0, renamingItem.path.lastIndexOf('/'))
      : currentPath;
    const newPath = `${targetDir}/${newName}`;

    try {
      await axios.patch('/api/files/rename', { oldPath, newPath });
      setRenamingItem(null);
      if (searchQuery) {
        setSearchRefreshTrigger(prev => prev + 1);
      } else {
        loadDirectory(currentPath);
      }
    } catch (err: any) {
      const msg = err.response?.data?.error ?? 'Rename failed';
      alert(`Error: ${msg}`);
      setRenamingItem(null);
    }
  };
  
  // ─── Batch Copy & Cut & Paste ───
  const handleCopy = () => {
    const selected = displayedFiles.filter(f => selectedItemNames.has(f.name));
    if (selected.length > 0) {
      const srcPath = selected[0].path
        ? selected[0].path.substring(0, selected[0].path.lastIndexOf('/'))
        : currentPath;
      setClipboard({ items: selected, sourcePath: srcPath, action: 'copy' });
    }
  };

  const handleCut = () => {
    const selected = displayedFiles.filter(f => selectedItemNames.has(f.name));
    if (selected.length > 0) {
      const srcPath = selected[0].path
        ? selected[0].path.substring(0, selected[0].path.lastIndexOf('/'))
        : currentPath;
      setClipboard({ items: selected, sourcePath: srcPath, action: 'cut' });
    }
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.items.length === 0) return;
    try {
      for (const item of clipboard.items) {
        const src = `${clipboard.sourcePath}/${item.name}`;
        const dest = `${currentPath}/${item.name}`;
        if (src === dest) continue;

        if (clipboard.action === 'cut') {
          await axios.patch('/api/files/move', { oldPath: src, newPath: dest });
        } else {
          await axios.post('/api/files/copy', { src, dest });
        }
      }
      if (clipboard.action === 'cut') {
        setClipboard(null);
      }
      loadDirectory(currentPath);
    } catch (err: any) {
      const msg = err.response?.data?.error ?? 'Paste operation failed';
      alert(`Error: ${msg}`);
      loadDirectory(currentPath);
    }
  };

  // Keyboard shortcuts (Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A, Ctrl+L)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setPathInputValue(currentPath);
        setIsEditingPath(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedItemNames.size > 0) handleCopy();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (selectedItemNames.size > 0) handleCut();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboard) handlePaste();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedItemNames(new Set(displayedFiles.map(f => f.name)));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedItemNames, clipboard, displayedFiles, currentPath]);

  // ─── Context menu ───
  const handleContextMenu = (e: React.MouseEvent, item: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedItemNames.has(item.name)) {
      setSelectedItemNames(new Set([item.name]));
      setLastSelectedName(item.name);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  const handleBackgroundContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setSelectedItemNames(new Set());
    setLastSelectedName(null);
    setContextMenu({ x: e.clientX, y: e.clientY, item: null });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFileName(file.name);
    setUploadProgress(0);
    const formData = new FormData();
    formData.append('file', file);
    try {
      await axios.post('/api/files/upload', formData, {
        params: { path: currentPath },
        onUploadProgress: (pe) => {
          if (pe.total) setUploadProgress(Math.round((pe.loaded * 100) / pe.total));
        },
      });
      setUploadProgress(null);
      setUploadingFileName('');
      loadDirectory(currentPath);
    } catch {
      alert('Upload failed');
      setUploadProgress(null);
      setUploadingFileName('');
    }
  };

  // ─── Breadcrumbs ───
  const pathSegments   = currentPath.split('/').filter(Boolean);
  const baseSegments   = (basePath || '').split('/').filter(Boolean);
  const buildPathUpTo  = (index: number) => '/' + pathSegments.slice(0, index + 1).join('/');

  return (
    <div className={styles.container}>
      {/* ─── Address Bar ─── */}
      <div className={styles.addressBarArea}>
        <div className={styles.navButtonGroup}>
          {isMobile && (
            <button
              type="button"
              className={styles.locationsToggleBtn}
              onClick={() => setSidebarOpen(prev => !prev)}
              title="Drives & Locations"
              aria-label="Toggle locations drawer"
            >
              <HardDrive size={13} />
              <span>Drives</span>
            </button>
          )}
          <button className={styles.navButton} onClick={handleBack} disabled={historyIndex <= 0} title="Back">
            <ArrowLeft size={15} />
          </button>
          <button className={styles.navButton} onClick={handleForward} disabled={historyIndex >= history.length - 1} title="Forward">
            <ArrowRight size={15} />
          </button>
          <button className={styles.navButton} onClick={handleUp} disabled={!basePath || currentPath === basePath} title="Up one folder">
            <ArrowUp size={15} />
          </button>
          <button className={styles.navButton} onClick={() => loadDirectory(currentPath)} title="Refresh">
            <RefreshCw size={13} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
          </button>
        </div>

        {/* Breadcrumb Path Bar */}
        <div
          className={styles.addressInputWrapper}
          onClick={() => {
            if (!isEditingPath) {
              setPathInputValue(currentPath);
              setIsEditingPath(true);
            }
          }}
        >
          {isEditingPath ? (
            <input
              ref={pathInputRef}
              className={styles.pathInput}
              type="text"
              value={pathInputValue}
              onChange={(e) => setPathInputValue(e.target.value)}
              onKeyDown={handlePathInputKeyDown}
              onBlur={() => setIsEditingPath(false)}
              placeholder={basePath || '/'}
              spellCheck={false}
              autoComplete="off"
            />
          ) : (
            <div
              ref={breadcrumbsRef}
              className={styles.breadcrumbsScrollArea}
              onWheel={handleBreadcrumbWheel}
            >
              {pathSegments.length === 0 ? (
                <span
                  className={`${styles.breadcrumbSegment} ${styles.breadcrumbSegmentActive}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (basePath) navigateToPath(basePath);
                  }}
                >
                  /
                </span>
              ) : (
                pathSegments.map((segment, index) => {
                  const isLast = index === pathSegments.length - 1;
                  const isBaseAncestor = index < baseSegments.length - 1;
                  return (
                    <React.Fragment key={index}>
                      {isBaseAncestor ? (
                        <span
                          className={styles.breadcrumbSegment}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {segment}
                        </span>
                      ) : (
                        <span
                          ref={isLast ? activeBreadcrumbRef : undefined}
                          className={`${styles.breadcrumbSegment} ${isLast ? styles.breadcrumbSegmentActive : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigateToPath(buildPathUpTo(index));
                          }}
                          title={buildPathUpTo(index)}
                        >
                          {segment}
                        </span>
                      )}
                      {!isLast && <ChevronRight size={12} className={styles.breadcrumbDivider} />}
                    </React.Fragment>
                  );
                })
              )}
            </div>
          )}
          <button
            className={styles.copyPathButton}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              handleCopyPath();
            }}
            title={copiedPath ? 'Copied to clipboard!' : 'Copy path'}
          >
            {copiedPath ? <Check size={13} style={{ color: 'var(--ok)' }} /> : <Copy size={13} />}
          </button>
        </div>

        {/* Search Box */}
        <div className={styles.searchWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            type="text"
            placeholder={`Search ${currentFolderTitle}`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className={styles.clearSearchButton} onClick={() => setSearchQuery('')} title="Clear search">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ─── Command Ribbon ─── */}
      <div className={styles.commandBar}>
        <div className={styles.commandGroup}>
          {/* Primary Action Button — Solid White */}
          <button className={styles.primaryButton} onClick={() => fileInputRef.current?.click()} title="Upload file">
            <Upload size={14} />
            <span>Upload</span>
          </button>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleUpload} />

          <button className={styles.commandButton} onClick={() => handleCreateNew('folder')} title="New Folder">
            <Plus size={14} />
            <span>New Folder</span>
          </button>
          <button className={styles.commandButton} onClick={() => handleCreateNew('file')} title="New File">
            <Plus size={14} />
            <span>New File</span>
          </button>

          <div className={styles.commandDivider} />

          <button className={styles.commandButton} onClick={handleCopy} disabled={selectedItemNames.size === 0} title="Copy (Ctrl+C)">
            <Copy size={13} />
            <span>Copy</span>
          </button>
          <button className={styles.commandButton} onClick={handleCut} disabled={selectedItemNames.size === 0} title="Cut (Ctrl+X)">
            <Scissors size={13} />
            <span>Cut</span>
          </button>
          <button className={styles.commandButton} onClick={handlePaste} disabled={!clipboard} title="Paste (Ctrl+V)">
            <Clipboard size={13} />
            <span>Paste</span>
          </button>
          <button className={styles.commandButton} onClick={() => handleStartRename()} disabled={selectedItemNames.size !== 1} title="Rename (F2)">
            <Edit2 size={13} />
            <span>Rename</span>
          </button>
          <button
            className={`${styles.commandButton} ${selectedItemNames.size > 0 ? styles.dangerButton : ''}`}
            onClick={() => handleDelete()}
            disabled={selectedItemNames.size === 0}
            title={selectedItemNames.size > 1 ? `Delete (${selectedItemNames.size} items)` : 'Delete'}
          >
            <Trash2 size={13} />
            <span>Delete</span>
          </button>

          <div className={styles.commandDivider} />

          {/* View button — enabled when exactly 1 file is selected */}
          <button
            className={styles.commandButton}
            disabled={!selectedSingleItem || selectedSingleItem.type === 'folder'}
            onClick={() => {
              if (selectedSingleItem && selectedSingleItem.type === 'file') {
                setViewingFile({ path: `${currentPath}/${selectedSingleItem.name}`, name: selectedSingleItem.name, ext: selectedSingleItem.ext || '' });
              }
            }}
            title="View File"
          >
            <Eye size={13} />
            <span>View</span>
          </button>
        </div>
      </div>

      {/* ─── Sidebar + Content Area ─── */}
      <div className={styles.workspace}>
        {/* Mobile Backdrop Overlay */}
        {isMobile && sidebarOpen && (
          <div
            className={styles.sidebarBackdrop}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarSectionTitle}>Devices</div>
          {Array.isArray(drives) && drives.length > 0 ? (
            drives.map((drive, index) => {
              const driveName = drive.mount === '/' ? 'System Root (/)' : (drive.mount || drive.fs || `Drive ${index + 1}`);
              const isActive = !!basePath && currentPath === basePath && drive.mount === '/';
              return (
                <div
                  key={drive.fs || index}
                  className={`${styles.sidebarItem} ${isActive ? styles.sidebarItemActive : ''}`}
                  onClick={() => {
                    if (basePath) navigateToPath(basePath);
                    if (isMobile) setSidebarOpen(false);
                  }}
                  title={`${drive.fs} (${drive.type})`}
                >
                  <HardDrive size={15} className={styles.sidebarIcon} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{driveName}</span>
                </div>
              );
            })
          ) : (
            <div
              className={`${styles.sidebarItem} ${currentPath === basePath ? styles.sidebarItemActive : ''}`}
              onClick={() => {
                if (basePath) navigateToPath(basePath);
                if (isMobile) setSidebarOpen(false);
              }}
            >
              <HardDrive size={15} className={styles.sidebarIcon} />
              <span>Home</span>
            </div>
          )}

          {Array.isArray(drives) && drives.length > 0 && drives[0] && (() => {
            const usePercent = Math.round(drives[0].use || 0);
            const progressClass = usePercent > 90
              ? styles.storageProgressDanger
              : usePercent > 80
              ? styles.storageProgressWarn
              : styles.storageProgress;

            return (
              <div className={styles.storageIndicator}>
                <div className={styles.storageTitle}>
                  <span>Storage</span>
                  <span className={styles.storagePercent}>{usePercent}%</span>
                </div>
                <div className={styles.storageBar}>
                  <div className={progressClass} style={{ width: `${Math.min(100, Math.max(0, usePercent))}%` }} />
                </div>
                <div className={styles.storageText}>
                  {((drives[0].used || 0) / (1024 ** 3)).toFixed(1)} GB used of{' '}
                  {((drives[0].size || 0) / (1024 ** 3)).toFixed(1)} GB
                </div>
              </div>
            );
          })()}
        </div>

        {/* File Table Content Area */}
        <div
          className={styles.contentArea}
          onMouseDown={handleContainerMouseDown}
          onClick={e => {
            if (isDraggingRef.current) return;
            const target = e.target as HTMLElement;
            if (!target.closest('[data-filename]')) {
              setSelectedItemNames(new Set());
              setLastSelectedName(null);
              setRenamingItem(null);
              setContextMenu(null);
            }
          }}
          onContextMenu={handleBackgroundContextMenu}
        >
          {isLoading && (
            <div className={styles.emptyState}>
              <Loader2 size={28} style={{ opacity: 0.5, animation: 'spin 0.8s linear infinite' }} />
              <div className={styles.emptyStateText}>Loading directory...</div>
            </div>
          )}

          {!isLoading && loadError && (
            <div className={styles.emptyState}>
              <AlertTriangle size={32} style={{ opacity: 0.7, color: 'var(--error)' }} />
              <div className={styles.emptyStateText}>{loadError}</div>
            </div>
          )}

          {!isLoading && !loadError && itemsToRender.length === 0 && (
            <div className={styles.emptyState}>
              <Folder size={44} style={{ opacity: 0.2 }} />
              <div className={styles.emptyStateText}>
                {searchQuery ? 'No matching files found' : 'This folder is empty'}
              </div>
            </div>
          )}

          {!isLoading && !loadError && itemsToRender.length > 0 && (
            <>
              {/* Column Sort Header */}
              <div className={styles.fileListHeader} onClick={e => e.stopPropagation()}>
                <div className={styles.sortHeaderCol} onClick={() => handleSort('name')}>
                  <span>Name</span>
                  {sortField === 'name' ? (
                    sortDirection === 'asc' ? <ChevronUp size={12} className={styles.sortIcon} /> : <ChevronDown size={12} className={styles.sortIcon} />
                  ) : (
                    <ChevronUp size={12} className={styles.sortIconInactive} />
                  )}
                </div>

                <div className={styles.sortHeaderCol} onClick={() => handleSort('size')}>
                  <span>Size</span>
                  {sortField === 'size' ? (
                    sortDirection === 'asc' ? <ChevronUp size={12} className={styles.sortIcon} /> : <ChevronDown size={12} className={styles.sortIcon} />
                  ) : (
                    <ChevronUp size={12} className={styles.sortIconInactive} />
                  )}
                </div>

                <div className={styles.sortHeaderCol} onClick={() => handleSort('modified')}>
                  <span>Date Modified</span>
                  {sortField === 'modified' ? (
                    sortDirection === 'asc' ? <ChevronUp size={12} className={styles.sortIcon} /> : <ChevronDown size={12} className={styles.sortIcon} />
                  ) : (
                    <ChevronUp size={12} className={styles.sortIconInactive} />
                  )}
                </div>
              </div>

              {/* Items Container with ref for intersection testing */}
              <div className={styles.fileItemsContainer} ref={itemsContainerRef}>
                {itemsToRender.map(item => {
                  const isSelected     = selectedItemNames.has(item.name);
                  const isRenamingThis = renamingItem && renamingItem.oldName === item.name;
                  const isNewThis      = item.isNewPlaceholder;

                  const isCutPending = clipboard && 
                    clipboard.action === 'cut' && 
                    clipboard.items.some(ci => ci.name === item.name) && 
                    clipboard.sourcePath === currentPath;

                  return (
                    <div
                      key={isNewThis ? '__new_item_placeholder__' : item.name}
                      data-filename={isNewThis ? undefined : item.name}
                      className={`${styles.fileItemRow} ${isSelected ? styles.fileItemRowSelected : ''}`}
                      style={{ opacity: isCutPending ? 0.45 : 1 }}
                      onClick={e => handleItemClick(e, item)}
                      onDoubleClick={e => {
                        e.stopPropagation();
                        if (isNewThis) return;
                        handleItemDoubleClick(item);
                      }}
                      onContextMenu={e => {
                        if (isNewThis) return;
                        handleContextMenu(e, item);
                      }}
                    >
                      <div className={styles.fileNameCell}>
                        <div className={styles.fileIcon}>{getFileIcon(item)}</div>
                        {isNewThis ? (
                          <input
                            type="text"
                            value={newItem?.name || ''}
                            onChange={e => setNewItem({ ...newItem!, name: e.target.value })}
                            onBlur={handleFinishCreate}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleFinishCreate();
                              if (e.key === 'Escape') setNewItem(null);
                            }}
                            autoFocus
                            onFocus={e => e.target.select()}
                            onClick={e => e.stopPropagation()}
                            className={styles.inlineInput}
                          />
                        ) : isRenamingThis ? (
                          <input
                            type="text"
                            value={renamingItem.newName}
                            onChange={e => setRenamingItem({ ...renamingItem, newName: e.target.value })}
                            onBlur={handleFinishRename}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleFinishRename();
                              if (e.key === 'Escape') setRenamingItem(null);
                            }}
                            autoFocus
                            onFocus={e => e.target.select()}
                            onClick={e => e.stopPropagation()}
                            className={styles.inlineInput}
                          />
                        ) : (
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                        )}
                      </div>
                      <div className={styles.fileSizeCell}>{item.size}</div>
                      <div className={styles.fileModifiedCell}>{item.modified}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Mouse Drag Selection Marquee Box */}
          {marquee && (
            <div
              className={styles.selectionMarquee}
              style={{
                left: Math.min(marquee.startX, marquee.currentX),
                top: Math.min(marquee.startY, marquee.currentY),
                width: Math.abs(marquee.currentX - marquee.startX),
                height: Math.abs(marquee.currentY - marquee.startY),
              }}
            />
          )}
        </div>

        {/* Upload Progress Overlay */}
        {uploadProgress !== null && (
          <div className={styles.uploadProgressCard}>
            <div className={styles.uploadHeader}>
              <span className={styles.uploadTitle}>Uploading file...</span>
              <span className={styles.uploadPercent}>{uploadProgress}%</span>
            </div>
            <div className={styles.uploadFileName} title={uploadingFileName}>{uploadingFileName}</div>
            <div className={styles.progressBarContainer}>
              <div className={styles.progressBarFill} style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        {/* ─── File Viewer Modal ─── */}
        {viewingFile && (
          <FileViewer
            filePath={viewingFile.path}
            fileName={viewingFile.name}
            ext={viewingFile.ext}
            onClose={() => setViewingFile(null)}
          />
        )}

        {/* ─── Right-click Context Menu ─── */}
        {contextMenu && (
          <div
            className={styles.contextMenu}
            style={{
              top: Math.min(contextMenu.y, window.innerHeight - 220),
              left: Math.min(contextMenu.x, window.innerWidth - 190),
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Background menu (right-clicked on empty space) */}
            {contextMenu.item === null && (
              <>
                <div
                  className={styles.contextMenuItem}
                  style={{ opacity: clipboard ? 1 : 0.4, pointerEvents: clipboard ? 'auto' : 'none' }}
                  onClick={() => { handlePaste(); setContextMenu(null); }}
                >
                  <Clipboard size={13} /> Paste {clipboard ? `(${clipboard.items.length} items)` : ''}
                </div>

                <div className={styles.contextMenuDivider} />

                <div
                  className={styles.contextMenuItem}
                  onClick={() => { handleCreateNew('folder'); setContextMenu(null); }}
                >
                  <Plus size={13} /> New Folder
                </div>
                <div
                  className={styles.contextMenuItem}
                  onClick={() => { handleCreateNew('file'); setContextMenu(null); }}
                >
                  <Plus size={13} /> New File
                </div>
                <div
                  className={styles.contextMenuItem}
                  onClick={() => { fileInputRef.current?.click(); setContextMenu(null); }}
                >
                  <Upload size={13} /> Upload
                </div>
              </>
            )}

            {/* File / Folder menu */}
            {contextMenu.item !== null && (() => {
              const item = contextMenu.item!;
              const isMultiSelected = selectedItemNames.size > 1;
              return (
                <>
                  {!isMultiSelected && item.type === 'file' && (
                    <div
                      className={styles.contextMenuItem}
                      onClick={() => {
                        setViewingFile({ path: `${currentPath}/${item.name}`, name: item.name, ext: item.ext || '' });
                        setContextMenu(null);
                      }}
                    >
                      <Eye size={13} /> View
                    </div>
                  )}

                  <div
                    className={styles.contextMenuItem}
                    onClick={() => { handleCopy(); setContextMenu(null); }}
                  >
                    <Copy size={13} /> Copy {isMultiSelected ? `(${selectedItemNames.size} items)` : ''}
                  </div>
                  <div
                    className={styles.contextMenuItem}
                    onClick={() => { handleCut(); setContextMenu(null); }}
                  >
                    <Scissors size={13} /> Cut {isMultiSelected ? `(${selectedItemNames.size} items)` : ''}
                  </div>

                  {!isMultiSelected && (
                    <div
                      className={styles.contextMenuItem}
                      onClick={() => { handleStartRename(item.name); setContextMenu(null); }}
                    >
                      <Edit2 size={13} /> Rename
                    </div>
                  )}

                  {!isMultiSelected && item.type === 'file' && (
                    <a
                      className={styles.contextMenuItem}
                      href={`/api/files/download?path=${encodeURIComponent(`${currentPath}/${item.name}`)}`}
                      download={item.name}
                      style={{ textDecoration: 'none' }}
                      onClick={() => setContextMenu(null)}
                    >
                      <Download size={13} /> Download
                    </a>
                  )}

                  <div className={styles.contextMenuDivider} />

                  <div
                    className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
                    onClick={() => { handleDelete(isMultiSelected ? undefined : item.name); setContextMenu(null); }}
                  >
                    <Trash2 size={13} /> Delete {isMultiSelected ? `(${selectedItemNames.size} items)` : ''}
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ─── Status Bar ─── */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span>{displayedFiles.length} items</span>
          {selectedItemNames.size > 0 && (
            <>
              <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#525252' }} />
              <span>
                {selectedItemNames.size === 1
                  ? `1 item selected ${selectedTotalBytes > 0 ? `(${formatBytes(selectedTotalBytes)})` : ''}`
                  : `${selectedItemNames.size} items selected (${formatBytes(selectedTotalBytes)})`}
              </span>
            </>
          )}
        </div>
        <div className={styles.statusRight}>
          <span>{currentPath}</span>
        </div>
      </div>
    </div>
  );
}
