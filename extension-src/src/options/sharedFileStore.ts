// 共享文件（File System Access API）的本地持久化：
//   - FileSystemFileHandle 存扩展 origin 的 IndexedDB（句柄不可结构化克隆到 chrome.storage）；
//   - 同步元数据存 chrome.storage.local 的 cfsShareMeta（见 crossBrowserShare.ts）。
// 本文件只在设置页运行，不依赖后台常驻。
import {
  SHARE_META_STORAGE_KEY,
  normalizeShareMetadata,
  normalizeSharePermissionState,
  type ShareFileMetadata,
  type SharePermissionState,
} from '../shared/crossBrowserShare.ts';

const SHARE_DB_NAME = 'cfs-share';
const SHARE_DB_VERSION = 1;
const SHARE_HANDLE_STORE = 'handles';
const SHARE_HANDLE_KEY = 'sharedFile';

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name)
    : '';
}

function isFileSystemFileHandle(value: unknown): value is FileSystemFileHandle {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as {
    kind?: unknown;
    createWritable?: unknown;
    getFile?: unknown;
  };
  return record.kind === 'file'
    && typeof record.createWritable === 'function'
    && typeof record.getFile === 'function';
}

/** 浏览器是否支持共享文件自动同步（Chromium 系：Chrome / Edge / Brave 等）。 */
export function isFileSystemAccessSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.showOpenFilePicker === 'function'
    && typeof window.showSaveFilePicker === 'function';
}

function openShareDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB，无法保存共享文件句柄'));
      return;
    }
    const request = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHARE_HANDLE_STORE)) {
        db.createObjectStore(SHARE_HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开共享文件句柄数据库失败'));
    request.onblocked = () => reject(new Error('共享文件句柄数据库被其他页面占用，请关闭其他扩展页面后重试'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已中止'));
  });
}

/** 保存共享文件句柄（覆盖旧句柄）。 */
export async function saveSharedFileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openShareDatabase();
  try {
    const transaction = db.transaction(SHARE_HANDLE_STORE, 'readwrite');
    transaction.objectStore(SHARE_HANDLE_STORE).put(handle, SHARE_HANDLE_KEY);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

/** 读取已绑定的共享文件句柄；从未绑定或句柄损坏时返回 null。 */
export async function loadSharedFileHandle(): Promise<FileSystemFileHandle | null> {
  const db = await openShareDatabase();
  try {
    const transaction = db.transaction(SHARE_HANDLE_STORE, 'readonly');
    const stored = await requestResult(
      transaction.objectStore(SHARE_HANDLE_STORE).get(SHARE_HANDLE_KEY),
    );
    return isFileSystemFileHandle(stored) ? stored : null;
  } finally {
    db.close();
  }
}

export async function clearSharedFileHandle(): Promise<void> {
  const db = await openShareDatabase();
  try {
    const transaction = db.transaction(SHARE_HANDLE_STORE, 'readwrite');
    transaction.objectStore(SHARE_HANDLE_STORE).delete(SHARE_HANDLE_KEY);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

/** 读取共享文件读写权限；不要读取用 requestPermission（必须在用户手势里）。 */
export async function querySharePermission(
  handle: FileSystemFileHandle,
): Promise<SharePermissionState> {
  try {
    if (typeof handle.queryPermission !== 'function') return 'prompt';
    return normalizeSharePermissionState(await handle.queryPermission({ mode: 'readwrite' }));
  } catch (error) {
    // 浏览器重启后句柄仍然可用，但权限通常退化为 prompt；未知错误一律按需授权处理。
    return errorName(error) === 'NotFoundError' ? 'denied' : 'unknown';
  }
}

/** 申请读写权限；只能在用户点击等手势里调用。 */
export async function requestSharePermission(
  handle: FileSystemFileHandle,
): Promise<SharePermissionState> {
  try {
    if (typeof handle.requestPermission !== 'function') return 'unknown';
    return normalizeSharePermissionState(await handle.requestPermission({ mode: 'readwrite' }));
  } catch {
    return 'unknown';
  }
}

export async function loadShareMetadata(): Promise<ShareFileMetadata | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  const result = await chrome.storage.local.get(SHARE_META_STORAGE_KEY);
  const stored: unknown = result?.[SHARE_META_STORAGE_KEY];
  return stored === undefined ? null : normalizeShareMetadata(stored);
}

export async function saveShareMetadata(metadata: ShareFileMetadata): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [SHARE_META_STORAGE_KEY]: metadata });
}

export async function clearShareMetadata(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.remove(SHARE_META_STORAGE_KEY);
}
