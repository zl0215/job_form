// 设置页「数据与同步」顶部的跨浏览器共享区块：
//   A. 快速共享（剪贴板）：复制整套资料 / 粘贴 JSON 导入（只显示计数摘要，二次确认覆盖）；
//   B. 共享文件自动同步：Chrome ↔ Edge 各自绑定同一个本地 JSON 文件，保存资料后自动写入，
//      打开设置页时按 savedAt/业务哈希判断 upload / download / noop / conflict。
//
// 隐私约束：本组件只渲染条数、时间、文件名与状态，绝不渲染个人资料值；日志同样不带资料值。
// 安全约束：应用共享文件前一律走 IMPORT_BACKUP 的既有校验；任何失败都不覆盖本地资料。
import { useEffect, useRef, useState } from 'react';
import { MessageService } from '../shared/message.ts';
import type { BackupData } from '../shared/types.ts';
import {
  SHARE_AUTO_SYNC_DEBOUNCE_MS,
  SHARE_FILE_NAME,
  buildShareDocument,
  computeSyncDecision,
  createEmptyShareMetadata,
  isEmptyShareFileContent,
  parseShareDocument,
  serializeShareDocument,
  sha256BusinessData,
  type ShareFileDocument,
  type ShareFileMetadata,
  type ShareLocalInfo,
  type SharePermissionState,
  type ShareRemoteInfo,
  type ShareSyncDecision,
  type ShareSyncSummary,
} from '../shared/crossBrowserShare.ts';
import {
  clearShareMetadata,
  clearSharedFileHandle,
  isFileSystemAccessSupported,
  loadShareMetadata,
  loadSharedFileHandle,
  querySharePermission,
  requestSharePermission,
  saveShareMetadata,
  saveSharedFileHandle,
} from './sharedFileStore.ts';

interface Props {
  onDataChanged: () => void;
}

type ShareTrigger = 'open' | 'manual' | 'auto';
type ShareStatus = 'unbound' | 'idle' | 'syncing' | 'synced' | 'conflict' | 'error' | 'permission';
type BusyKey =
  | 'copy'
  | 'preview'
  | 'import'
  | 'bind-create'
  | 'bind-open'
  | 'sync'
  | 'reauth'
  | 'unbind'
  | 'resolve-local'
  | 'resolve-remote';
type Notice = { type: 'success' | 'error'; text: string };

interface PastePreview {
  summary: ShareSyncSummary;
  exportedAt: string;
  schemaVersion: number;
}

interface ConflictState {
  decision: ShareSyncDecision;
  local: ShareSyncSummary;
  remote: ShareSyncSummary | null;
  localUpdatedAt: string | null;
  remoteSavedAt: string | null;
  remoteJson: string | null;
  remoteHash: string | null;
}

interface LocalSnapshotSuccess {
  ok: true;
  document: ShareFileDocument;
  data: BackupData;
  hash: string;
  summary: ShareSyncSummary;
  info: ShareLocalInfo;
}

type LocalSnapshotResult = LocalSnapshotSuccess | { ok: false; error: string };

type RemoteReadResult =
  | { ok: true; rawJson: string | null; info: ShareRemoteInfo }
  | { ok: false; permissionLost: boolean; error: string };

type WriteResult =
  | { ok: true; savedAt: string; hash: string }
  | { ok: false; permissionLost: boolean; error: string };

const PERMISSION_LABELS: Record<SharePermissionState, string> = {
  granted: '已授权读写',
  prompt: '需要重新授权',
  denied: '权限被拒绝',
  unknown: '权限状态未知',
};

const STATUS_LABELS: Record<ShareStatus, string> = {
  unbound: '未绑定共享文件',
  idle: '尚未同步',
  syncing: '同步中',
  synced: '已同步',
  conflict: '需要处理冲突',
  error: '同步失败',
  permission: '需要重新授权',
};

function statusClassName(status: ShareStatus): string {
  if (status === 'syncing') return 'sync-status sync-status-syncing';
  if (status === 'synced') return 'sync-status sync-status-synced';
  if (status === 'conflict' || status === 'permission') return 'sync-status sync-status-conflict';
  if (status === 'error') return 'sync-status sync-status-error';
  return 'sync-status';
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '暂无';
  const time = Date.parse(value);
  return Number.isNaN(time) ? '暂无' : new Date(time).toLocaleString();
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function domErrorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name)
    : '';
}

/** 摘要只渲染条数/时间/布尔值；个人资料内容不进入 UI。 */
function CountSummary({ summary, showLatestUpdated = true }: {
  summary: ShareSyncSummary;
  showLatestUpdated?: boolean;
}) {
  return (
    <dl className="backup-summary share-file-summary">
      <div><dt>简历</dt><dd>{summary.profileCount} 份</dd></div>
      <div><dt>教育经历</dt><dd>{summary.educationCount} 条</dd></div>
      <div><dt>实习 / 工作</dt><dd>{summary.experienceCount} 条</dd></div>
      <div><dt>项目经历</dt><dd>{summary.projectCount} 条</dd></div>
      <div><dt>奖项 / 荣誉</dt><dd>{summary.awardCount} 条</dd></div>
      <div><dt>证书</dt><dd>{summary.certificationCount} 条</dd></div>
      <div><dt>技能</dt><dd>{summary.skillCount} 项</dd></div>
      <div><dt>其他信息</dt><dd>{summary.customInformationCount} 条</dd></div>
      <div><dt>投递记录</dt><dd>{summary.applicationRecordCount} 条</dd></div>
      <div><dt>简历原文件</dt><dd>{summary.hasResumeFile ? '包含' : '不包含'}</dd></div>
      <div><dt>AI 配置</dt><dd>{summary.hasLLMConfig ? (summary.hasApiKey ? '包含（含 Key）' : '包含') : '不包含'}</dd></div>
      {showLatestUpdated && <div><dt>最近修改</dt><dd>{formatTime(summary.latestUpdatedAt)}</dd></div>}
    </dl>
  );
}

export function CrossBrowserShareSection({ onDataChanged }: Props) {
  const [supported] = useState(() => isFileSystemAccessSupported());
  const [bound, setBound] = useState(false);
  const [metadata, setMetadata] = useState<ShareFileMetadata | null>(null);
  const [permission, setPermission] = useState<SharePermissionState>('unknown');
  const [status, setStatus] = useState<ShareStatus>('unbound');
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<Notice | null>(null);
  const [fileNotice, setFileNotice] = useState<Notice | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState<PastePreview | null>(null);
  const [confirmingPasteImport, setConfirmingPasteImport] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const metadataRef = useRef<ShareFileMetadata | null>(null);
  const syncingRef = useRef(false);
  const pendingSyncRef = useRef(false);
  const autoTimerRef = useRef<number | null>(null);
  const syncRef = useRef<(trigger: ShareTrigger) => void>(() => undefined);

  const persistMetadata = async (next: ShareFileMetadata): Promise<void> => {
    metadataRef.current = next;
    setMetadata(next);
    setPermission(next.permissionState);
    try {
      await saveShareMetadata(next);
    } catch (error) {
      setFileNotice({ type: 'error', text: `保存同步状态失败：${errorText(error, '未知错误')}` });
    }
  };

  const readLocalSnapshot = async (): Promise<LocalSnapshotResult> => {
    const response = await MessageService.sendMessage<{ json: string }>({
      type: 'EXPORT_BACKUP_JSON',
      // 共享内容不携带 WebDAV 凭据：两个浏览器各自保留自己的同步设置。
      payload: { includeWebDAVConfig: false },
    });
    if (!response.success || !response.data?.json) {
      return { ok: false, error: response.error || '读取本地资料备份失败' };
    }
    const parsed = parseShareDocument(response.data.json);
    if (!parsed.success) {
      return {
        ok: false,
        error: `本地资料生成备份后校验失败（${parsed.error.code}: ${parsed.error.message}），未做任何写入。`,
      };
    }
    const hash = await sha256BusinessData(parsed.data);
    return {
      ok: true,
      document: parsed.document,
      data: parsed.data,
      hash,
      summary: parsed.summary,
      info: { hash, updatedAt: parsed.summary.latestUpdatedAt, summary: parsed.summary },
    };
  };

  const readRemoteFile = async (handle: FileSystemFileHandle): Promise<RemoteReadResult> => {
    let raw: string;
    try {
      raw = await (await handle.getFile()).text();
    } catch (error) {
      const name = domErrorName(error);
      if (name === 'NotFoundError') {
        // 句柄仍在但文件被删除/移动：交给决策矩阵，不在这里自动重建。
        return {
          ok: true,
          rawJson: null,
          info: { exists: false, hash: null, savedAt: null, summary: null },
        };
      }
      if (name === 'NotAllowedError') {
        return {
          ok: false,
          permissionLost: true,
          error: '共享文件读写权限已失效，请点击「重新授权」。本地资料未做任何更改。',
        };
      }
      return {
        ok: false,
        permissionLost: false,
        error: `读取共享文件失败：${errorText(error, '未知错误')}。本地资料未做任何更改。`,
      };
    }
    if (isEmptyShareFileContent(raw)) {
      return {
        ok: true,
        rawJson: '',
        info: { exists: true, hash: null, savedAt: null, summary: null },
      };
    }
    const parsed = parseShareDocument(raw);
    if (!parsed.success) {
      return {
        ok: false,
        permissionLost: false,
        error: `共享文件格式无效（${parsed.error.code}: ${parsed.error.message}），本地资料未做任何更改。`,
      };
    }
    const hash = await sha256BusinessData(parsed.data);
    return {
      ok: true,
      rawJson: raw,
      info: { exists: true, hash, savedAt: parsed.document.savedAt, summary: parsed.summary },
    };
  };

  const writeShareFile = async (
    handle: FileSystemFileHandle,
    snapshot: LocalSnapshotSuccess,
  ): Promise<WriteResult> => {
    const savedAt = new Date().toISOString();
    const document = buildShareDocument(snapshot.data, {
      extensionVersion: snapshot.document.sourceExtensionVersion,
      savedAt,
    });
    const text = serializeShareDocument(document);
    try {
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    } catch (error) {
      const name = domErrorName(error);
      return {
        ok: false,
        permissionLost: name === 'NotAllowedError',
        error: `写入共享文件失败：${errorText(error, '未知错误')}。本地资料未做任何更改。`,
      };
    }
    // 回读校验：确认文件内容与本地业务数据一致后才更新同步基线。
    const verification = await readRemoteFile(handle);
    if (!verification.ok) {
      return {
        ok: false,
        permissionLost: verification.permissionLost,
        error: `写入后回读共享文件失败：${verification.error}`,
      };
    }
    if (verification.info.hash === null) {
      return { ok: false, permissionLost: false, error: '写入后共享文件内容为空，未更新同步基线。' };
    }
    if (verification.info.hash !== snapshot.hash) {
      return {
        ok: false,
        permissionLost: false,
        error: '写入后回读内容与本地资料不一致，未更新同步基线。',
      };
    }
    return { ok: true, savedAt, hash: verification.info.hash };
  };

  const applyRemoteSnapshot = async (
    rawJson: string,
    expectedHash: string,
  ): Promise<{ ok: true; info: ShareLocalInfo } | { ok: false; error: string }> => {
    // 应用共享文件内容必须走既有的 IMPORT_BACKUP 校验；失败时后台不会改动本地数据。
    const response = await MessageService.sendMessage({
      type: 'IMPORT_BACKUP',
      payload: { json: rawJson },
    });
    if (!response.success) {
      return {
        ok: false,
        error: `导入共享文件失败：${response.error || '备份校验未通过'}。本地资料未更改。`,
      };
    }
    const after = await readLocalSnapshot();
    if (!after.ok) {
      return { ok: false, error: '共享文件已导入，但重新读取本地资料失败；未更新同步基线，请手动核对。' };
    }
    if (after.hash !== expectedHash) {
      return {
        ok: false,
        error: '共享文件已导入，但本地内容校验结果与文件不一致，未更新同步基线，请手动核对。',
      };
    }
    return { ok: true, info: after.info };
  };

  const commitBaseline = async (
    localHash: string,
    remoteHash: string | null,
    remoteSavedAt: string | null,
  ): Promise<void> => {
    const base = metadataRef.current ?? createEmptyShareMetadata(handleRef.current?.name ?? null);
    await persistMetadata({
      ...base,
      fileLabel: handleRef.current?.name ?? base.fileLabel,
      permissionState: 'granted',
      lastLocalHash: localHash,
      lastRemoteHash: remoteHash,
      lastRemoteSavedAt: remoteSavedAt,
      lastSyncedAt: new Date().toISOString(),
    });
  };

  const markPermissionLost = async (handle: FileSystemFileHandle): Promise<void> => {
    const current = await querySharePermission(handle);
    const base = metadataRef.current ?? createEmptyShareMetadata(handle.name);
    await persistMetadata({
      ...base,
      fileLabel: handle.name,
      permissionState: current === 'granted' ? 'prompt' : current,
    });
  };

  const performSync = async (trigger: ShareTrigger): Promise<void> => {
    const handle = handleRef.current;
    if (!handle) return;
    if (syncingRef.current) {
      if (trigger === 'manual') {
        setFileNotice({ type: 'error', text: '上一次同步还在进行，请稍候再试。' });
      } else {
        // 同步期间又有本地写入：结束后补跑一次，避免漏掉最新改动。
        pendingSyncRef.current = true;
      }
      return;
    }
    syncingRef.current = true;
    const userInitiated = trigger === 'manual';
    if (userInitiated) {
      setBusy('sync');
      setFileNotice(null);
    }
    setStatus('syncing');
    try {
      const currentPermission = await querySharePermission(handle);
      if (currentPermission !== 'granted') {
        const base = metadataRef.current ?? createEmptyShareMetadata(handle.name);
        await persistMetadata({ ...base, fileLabel: handle.name, permissionState: currentPermission });
        setStatus('permission');
        if (userInitiated) {
          setFileNotice({
            type: 'error',
            text: '共享文件权限已失效（浏览器重启后通常需要重新授权），请点击「重新授权」。授权前不会读写文件。',
          });
        }
        return;
      }

      const remote = await readRemoteFile(handle);
      if (!remote.ok) {
        if (remote.permissionLost) await markPermissionLost(handle);
        setStatus(remote.permissionLost ? 'permission' : 'error');
        setFileNotice({ type: 'error', text: remote.error });
        return;
      }
      const local = await readLocalSnapshot();
      if (!local.ok) {
        setStatus('error');
        setFileNotice({ type: 'error', text: local.error });
        return;
      }

      const decision = computeSyncDecision(metadataRef.current, local.info, remote.info);
      if (decision.action === 'noop') {
        await commitBaseline(local.hash, remote.info.hash, remote.info.savedAt);
        setConflict(null);
        setStatus('synced');
        if (userInitiated) {
          setFileNotice({ type: 'success', text: '本地资料与共享文件已是最新，无需同步。' });
        }
        return;
      }

      if (decision.action === 'upload') {
        const written = await writeShareFile(handle, local);
        if (!written.ok) {
          if (written.permissionLost) await markPermissionLost(handle);
          setStatus(written.permissionLost ? 'permission' : 'error');
          setFileNotice({ type: 'error', text: written.error });
          return;
        }
        await commitBaseline(local.hash, written.hash, written.savedAt);
        setConflict(null);
        setStatus('synced');
        if (userInitiated) {
          setFileNotice({
            type: 'success',
            text: '已将本地资料写入共享文件；另一个浏览器（Chrome/Edge）打开本页即可读取。',
          });
        }
        return;
      }

      if (decision.action === 'download') {
        if (!remote.rawJson || remote.info.hash === null) {
          setStatus('error');
          setFileNotice({ type: 'error', text: '共享文件内容不可用，未改动本地资料。' });
          return;
        }
        const applied = await applyRemoteSnapshot(remote.rawJson, remote.info.hash);
        if (!applied.ok) {
          setStatus('error');
          setFileNotice({ type: 'error', text: applied.error });
          return;
        }
        await commitBaseline(applied.info.hash, remote.info.hash, remote.info.savedAt);
        setConflict(null);
        setStatus('synced');
        onDataChanged();
        setFileNotice({
          type: 'success',
          text: '已从共享文件同步到本地资料（导入走既有备份校验）。请到资料各页核对。',
        });
        return;
      }

      // 冲突：展示双方条数与时间，等待用户选择；系统不覆盖任何一方。
      setConflict({
        decision,
        local: local.summary,
        remote: remote.info.summary,
        localUpdatedAt: local.info.updatedAt,
        remoteSavedAt: remote.info.savedAt,
        remoteJson: remote.rawJson,
        remoteHash: remote.info.hash,
      });
      setStatus('conflict');
    } catch (error) {
      setStatus('error');
      setFileNotice({
        type: 'error',
        text: `同步失败：${errorText(error, '未知错误')}。本地资料未做任何更改。`,
      });
    } finally {
      syncingRef.current = false;
      if (userInitiated) setBusy(null);
      if (pendingSyncRef.current) {
        pendingSyncRef.current = false;
        window.setTimeout(() => {
          syncRef.current('auto');
        }, 0);
      }
    }
  };

  syncRef.current = (trigger: ShareTrigger) => {
    void performSync(trigger);
  };

  const copyAll = async (): Promise<void> => {
    setBusy('copy');
    setClipboardNotice(null);
    try {
      const response = await MessageService.sendMessage<{ json: string }>({ type: 'EXPORT_BACKUP_JSON' });
      if (!response.success || !response.data?.json) {
        setClipboardNotice({ type: 'error', text: response.error || '生成共享内容失败' });
        return;
      }
      try {
        await navigator.clipboard.writeText(response.data.json);
      } catch (error) {
        setClipboardNotice({
          type: 'error',
          text: `复制到剪贴板失败：${errorText(error, '浏览器拒绝了剪贴板写入')}。可改用「导出完整数据」下载备份文件。`,
        });
        return;
      }
      setClipboardNotice({
        type: 'success',
        text: '已复制，可在另一个浏览器（Chrome/Edge）插件的「数据与同步」页粘贴导入。',
      });
    } finally {
      setBusy(null);
    }
  };

  const previewPaste = async (): Promise<void> => {
    setBusy('preview');
    setPastePreview(null);
    setClipboardNotice(null);
    try {
      const parsed = parseShareDocument(pasteText);
      if (!parsed.success) {
        setClipboardNotice({
          type: 'error',
          text: `无法解析粘贴内容（${parsed.error.code}: ${parsed.error.message}）。本地资料未更改。`,
        });
        return;
      }
      setPastePreview({
        summary: parsed.summary,
        exportedAt: parsed.document.exportedAt,
        schemaVersion: parsed.document.schemaVersion,
      });
    } finally {
      setBusy(null);
    }
  };

  const importPasted = async (): Promise<void> => {
    setBusy('import');
    setClipboardNotice(null);
    try {
      const response = await MessageService.sendMessage({
        type: 'IMPORT_BACKUP',
        payload: { json: pasteText },
      });
      if (!response.success) {
        setClipboardNotice({
          type: 'error',
          text: `导入失败：${response.error || '备份校验未通过'}。本地资料未更改。`,
        });
        return;
      }
      setConfirmingPasteImport(false);
      setPastePreview(null);
      setPasteText('');
      onDataChanged();
      setClipboardNotice({
        type: 'success',
        text: '已用粘贴的 JSON 覆盖本地资料（导入走既有备份校验）。请到资料各页核对。',
      });
    } finally {
      setBusy(null);
    }
  };

  const bindHandle = async (handle: FileSystemFileHandle): Promise<void> => {
    // requestPermission 必须在用户手势里执行，因此放在选择文件后立即调用。
    const nextPermission = await requestSharePermission(handle);
    if (nextPermission !== 'granted') {
      setFileNotice({
        type: 'error',
        text: '没有获得共享文件的读写权限，未绑定。请重试并允许文件读写。',
      });
      return;
    }
    await saveSharedFileHandle(handle);
    handleRef.current = handle;
    const base = createEmptyShareMetadata(handle.name, 'granted');
    await persistMetadata(base);
    setBound(true);
    setPermission('granted');
    setConflict(null);
    setStatus('idle');
    setFileNotice({
      type: 'success',
      text: `已绑定共享文件「${handle.name}」。请用另一个浏览器（Chrome/Edge）的同一设置页绑定同一个文件，即可自动共享资料。`,
    });
    await performSync('open');
  };

  const pickHandleOrAbort = async (
    picker: () => Promise<FileSystemFileHandle>,
    busyKey: BusyKey,
  ): Promise<void> => {
    setBusy(busyKey);
    setFileNotice(null);
    try {
      await bindHandle(await picker());
    } catch (error) {
      if (domErrorName(error) === 'AbortError') return;
      setFileNotice({ type: 'error', text: `选择共享文件失败：${errorText(error, '未知错误')}` });
    } finally {
      setBusy(null);
    }
  };

  const createShareFile = async (): Promise<void> => {
    const picker = window.showSaveFilePicker;
    if (!picker) return;
    await pickHandleOrAbort(
      () => picker.call(window, {
        suggestedName: SHARE_FILE_NAME,
        types: [{
          description: '校招表单助手共享资料（JSON）',
          accept: { 'application/json': ['.json'] },
        }],
      }),
      'bind-create',
    );
  };

  const pickShareFile = async (): Promise<void> => {
    const picker = window.showOpenFilePicker;
    if (!picker) return;
    await pickHandleOrAbort(async () => {
      const handles = await picker.call(window, {
        multiple: false,
        types: [{
          description: '校招表单助手共享资料（JSON）',
          accept: { 'application/json': ['.json'] },
        }],
      });
      const handle = handles[0];
      if (!handle) throw new Error('没有选择文件');
      return handle;
    }, 'bind-open');
  };

  const reauthorize = async (): Promise<void> => {
    const handle = handleRef.current;
    if (!handle) return;
    setBusy('reauth');
    setFileNotice(null);
    try {
      // requestPermission 必须在用户点击的手势里调用。
      const nextPermission = await requestSharePermission(handle);
      const base = metadataRef.current ?? createEmptyShareMetadata(handle.name);
      await persistMetadata({ ...base, fileLabel: handle.name, permissionState: nextPermission });
      if (nextPermission !== 'granted') {
        setStatus('permission');
        setFileNotice({
          type: 'error',
          text: '未能获得共享文件读写权限。请检查浏览器是否拦截了文件权限，或解绑后重新绑定共享文件。',
        });
        return;
      }
      setFileNotice({ type: 'success', text: '已重新授权，正在检查共享文件…' });
      setBusy(null);
      await performSync('manual');
    } finally {
      setBusy(null);
    }
  };

  const unbind = async (): Promise<void> => {
    setBusy('unbind');
    setFileNotice(null);
    try {
      await clearSharedFileHandle();
      await clearShareMetadata();
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    } catch (error) {
      setFileNotice({ type: 'error', text: `解绑共享文件失败：${errorText(error, '未知错误')}` });
      return;
    } finally {
      setBusy(null);
    }
    handleRef.current = null;
    metadataRef.current = null;
    setMetadata(null);
    setBound(false);
    setPermission('unknown');
    setStatus('unbound');
    setConflict(null);
    setFileNotice({ type: 'success', text: '已解绑共享文件；本地资料不受影响。' });
  };

  const resolveWithLocal = async (): Promise<void> => {
    const handle = handleRef.current;
    if (!handle) return;
    setBusy('resolve-local');
    setFileNotice(null);
    try {
      const local = await readLocalSnapshot();
      if (!local.ok) {
        setStatus('error');
        setFileNotice({ type: 'error', text: local.error });
        return;
      }
      const written = await writeShareFile(handle, local);
      if (!written.ok) {
        if (written.permissionLost) await markPermissionLost(handle);
        setStatus(written.permissionLost ? 'permission' : 'error');
        setFileNotice({ type: 'error', text: written.error });
        return;
      }
      await commitBaseline(local.hash, written.hash, written.savedAt);
      setConflict(null);
      setStatus('synced');
      setFileNotice({ type: 'success', text: '已用本地资料覆盖共享文件；另一个浏览器打开本页即可读取。' });
    } finally {
      setBusy(null);
    }
  };

  const resolveWithRemote = async (): Promise<void> => {
    if (!conflict || !conflict.remoteJson || conflict.remoteHash === null) return;
    setBusy('resolve-remote');
    setFileNotice(null);
    try {
      const applied = await applyRemoteSnapshot(conflict.remoteJson, conflict.remoteHash);
      if (!applied.ok) {
        setStatus('error');
        setFileNotice({ type: 'error', text: applied.error });
        return;
      }
      await commitBaseline(applied.info.hash, conflict.remoteHash, conflict.remoteSavedAt);
      setConflict(null);
      setStatus('synced');
      onDataChanged();
      setFileNotice({
        type: 'success',
        text: '已用共享文件覆盖本地资料（导入前本地数据已被替换；如需回退请使用本地备份）。',
      });
    } finally {
      setBusy(null);
    }
  };

  // 打开设置页：读取已绑定句柄与权限；权限可用时自动检查一次共享文件。
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void (async () => {
      try {
        const [handle, storedMetadata] = await Promise.all([
          loadSharedFileHandle(),
          loadShareMetadata(),
        ]);
        if (cancelled) return;
        if (!handle) {
          if (storedMetadata) await clearShareMetadata().catch(() => undefined);
          return;
        }
        handleRef.current = handle;
        const currentPermission = await querySharePermission(handle);
        if (cancelled) return;
        const base = storedMetadata ?? createEmptyShareMetadata(handle.name);
        const nextMetadata: ShareFileMetadata = {
          ...base,
          fileLabel: handle.name,
          permissionState: currentPermission,
        };
        metadataRef.current = nextMetadata;
        setMetadata(nextMetadata);
        setPermission(currentPermission);
        setBound(true);
        setStatus(currentPermission === 'granted' ? 'idle' : 'permission');
        await saveShareMetadata(nextMetadata).catch(() => undefined);
        if (currentPermission === 'granted') syncRef.current('open');
      } catch (error) {
        if (cancelled) return;
        setFileNotice({
          type: 'error',
          text: `读取共享文件绑定信息失败：${errorText(error, '未知错误')}。可尝试重新绑定共享文件。`,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  // 自动同步：设置页常开时，本地资料写入成功后防抖 800ms 写入共享文件。
  useEffect(() => {
    if (!supported) return;
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const watchedKeys = new Set(['resumeProfileLibrary', 'applicationRecords', 'llmConfig', 'settings']);
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (!Object.keys(changes).some(key => watchedKeys.has(key))) return;
      if (!handleRef.current) return;
      if (autoTimerRef.current !== null) window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = window.setTimeout(() => {
        autoTimerRef.current = null;
        syncRef.current('auto');
      }, SHARE_AUTO_SYNC_DEBOUNCE_MS);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
  }, [supported]);

  return (
    <div className="data-sync-settings cross-browser-share">
      <section className="data-section" aria-labelledby="share-clipboard-title">
        <div className="data-section-heading">
          <div>
            <h2 id="share-clipboard-title" className="settings-section-title">快速共享（剪贴板）</h2>
            <p className="settings-description">
              把整套资料复制成一段 JSON，在另一个浏览器（Chrome / Edge 等）的扩展设置页粘贴导入。
              不经过任何服务器；这里只显示条数摘要，不显示个人资料内容。
            </p>
          </div>
          <div className="data-heading-actions">
            <button
              className="btn btn-primary"
              onClick={() => void copyAll()}
              disabled={busy !== null}
            >
              {busy === 'copy' ? '复制中…' : '复制整套资料'}
            </button>
          </div>
        </div>

        <div className="sensitive-warning" role="note">
          复制内容是明文 JSON，包含完整个人信息、简历原文件和 AI Key（以及 WebDAV 账号密码）。
          请只在本人设备/浏览器之间共享；剪贴板内容可能被其他应用读取。
        </div>

        {clipboardNotice && (
          <div className={`data-notice data-notice-${clipboardNotice.type}`} role="status" aria-live="polite">
            {clipboardNotice.text}
          </div>
        )}

        <div className="settings-field share-paste-field">
          <label htmlFor="share-paste-input">粘贴导入</label>
          <textarea
            id="share-paste-input"
            className="settings-input share-paste-textarea"
            value={pasteText}
            onChange={event => {
              setPasteText(event.target.value);
              setPastePreview(null);
            }}
            placeholder="在另一个浏览器复制后，在这里按 Ctrl+V 粘贴 JSON，然后点击「解析并检查」"
            spellCheck={false}
          />
          <p className="settings-hint">
            为避免申请剪贴板读取权限，这里需要手动粘贴（Ctrl+V）；解析通过并二次确认后才会覆盖本地资料。
          </p>
        </div>

        <div className="sync-actions">
          <button
            className="btn btn-secondary"
            onClick={() => void previewPaste()}
            disabled={busy !== null || pasteText.trim() === ''}
          >
            {busy === 'preview' ? '解析中…' : '解析并检查'}
          </button>
        </div>

        {pastePreview && (
          <div className="backup-preview">
            <h3>粘贴内容检查通过（尚未导入）</h3>
            <p className="settings-hint">
              格式版本 V{pastePreview.schemaVersion}，导出时间 {formatTime(pastePreview.exportedAt)}。
              以下只显示条数摘要，确认后才会覆盖当前数据。
            </p>
            <CountSummary summary={pastePreview.summary} />
            <div className="sync-actions">
              <button className="btn btn-secondary" onClick={() => setPastePreview(null)} disabled={busy !== null}>
                取消
              </button>
              <button className="btn btn-primary" onClick={() => setConfirmingPasteImport(true)} disabled={busy !== null}>
                覆盖并导入
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="data-section" aria-labelledby="share-file-title">
        <div className="data-section-heading">
          <div>
            <h2 id="share-file-title" className="settings-section-title">共享文件（自动同步，推荐）</h2>
            <p className="settings-description">
              在 Chrome、Edge 等 Chromium 浏览器里绑定同一个本地 JSON 文件：
              保存资料后自动写入文件，另一个浏览器打开本页时自动读取。文件只在本机读写，不经过服务器。
            </p>
          </div>
          <span className={statusClassName(supported ? status : 'unbound')}>
            {supported ? STATUS_LABELS[status] : '当前浏览器不支持'}
          </span>
        </div>

        {supported && (
          <div className="sensitive-warning" role="note">
            共享文件是本机明文 JSON，包含完整个人信息、简历原文件和 AI Key。
            请只在本人设备/浏览器之间使用，不要放到网盘、共享目录或发送给他人。
          </div>
        )}

        {!supported ? (
          <div className="sensitive-warning" role="note">
            当前浏览器不支持 File System Access API（共享文件自动同步需要 Chrome / Edge 等 Chromium 浏览器）。
            请使用上方「快速共享（剪贴板）」手动复制粘贴，或换用 Chromium 浏览器。
          </div>
        ) : !bound ? (
          <>
            <div className="sync-actions">
              <button className="btn btn-primary" onClick={() => void createShareFile()} disabled={busy !== null}>
                {busy === 'bind-create' ? '选择中…' : '新建共享文件'}
              </button>
              <button className="btn btn-secondary" onClick={() => void pickShareFile()} disabled={busy !== null}>
                {busy === 'bind-open' ? '选择中…' : '选择已有共享文件'}
              </button>
            </div>
            <p className="settings-hint">
              建议新建一个 JSON 文件（默认名 {SHARE_FILE_NAME}），然后在另一个浏览器里用「选择已有共享文件」绑定同一个文件；
              绑定后两端会自动比较更新时间并同步，冲突时由你选择保留哪一份。
            </p>
          </>
        ) : (
          <>
            <dl className="backup-summary share-file-summary">
              <div><dt>共享文件</dt><dd>{metadata?.fileLabel ?? '未命名'}</dd></div>
              <div><dt>权限状态</dt><dd>{PERMISSION_LABELS[permission]}</dd></div>
              <div><dt>上次同步</dt><dd>{formatTime(metadata?.lastSyncedAt)}</dd></div>
              <div><dt>文件保存时间</dt><dd>{formatTime(metadata?.lastRemoteSavedAt)}</dd></div>
            </dl>

            {permission !== 'granted' && (
              <div className="sensitive-warning" role="note">
                共享文件的读写权限需要重新授权（浏览器重启或闲置后常见）。授权前不会读取或写入文件，也不会改动本地资料。
              </div>
            )}

            <div className="sync-actions">
              <button
                className="btn btn-primary"
                onClick={() => void performSync('manual')}
                disabled={busy !== null || permission !== 'granted'}
              >
                {busy === 'sync' ? '同步中…' : '立即同步'}
              </button>
              {permission !== 'granted' && (
                <button className="btn btn-secondary" onClick={() => void reauthorize()} disabled={busy !== null}>
                  重新授权
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => void unbind()} disabled={busy !== null}>
                解绑
              </button>
            </div>
            <p className="settings-hint">
              自动同步触发点：在本页保存/导入资料后（防抖 800ms）自动写入共享文件；打开本页时自动检查一次。
              关闭本页后不会在后台自动同步（下次打开本页会立即补同步）。
              提示：另一个浏览器（Chrome/Edge）也绑定同一个文件即可共享资料。
            </p>

            {conflict && (
              <div className="sync-conflict">
                <h3>本地资料与共享文件不一致</h3>
                <p>
                  {conflict.decision.message}
                  下方只显示条数与时间，不显示个人资料内容；选定前系统不会覆盖任何一方。
                </p>
                <div className="conflict-comparison">
                  <div>
                    <h4>本地版本（最近修改 {formatTime(conflict.localUpdatedAt)}）</h4>
                    <CountSummary summary={conflict.local} showLatestUpdated={false} />
                  </div>
                  <div>
                    <h4>
                      {conflict.remote
                        ? `共享文件版本（保存于 ${formatTime(conflict.remoteSavedAt)}）`
                        : '共享文件'}
                    </h4>
                    {conflict.remote ? (
                      <CountSummary summary={conflict.remote} showLatestUpdated={false} />
                    ) : (
                      <p className="settings-hint">共享文件不存在或为空，没有可下载的内容。</p>
                    )}
                  </div>
                </div>
                <div className="sync-actions">
                  <button className="btn btn-primary" onClick={() => void resolveWithLocal()} disabled={busy !== null}>
                    {busy === 'resolve-local' ? '写入中…' : '用本地覆盖文件'}
                  </button>
                  {conflict.remote && conflict.remoteJson !== null && conflict.remoteHash !== null && (
                    <button className="btn btn-secondary" onClick={() => void resolveWithRemote()} disabled={busy !== null}>
                      {busy === 'resolve-remote' ? '导入中…' : '用文件覆盖本地'}
                    </button>
                  )}
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setConflict(null);
                      setStatus('idle');
                    }}
                    disabled={busy !== null}
                  >
                    稍后处理
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {fileNotice && (
          <div className={`data-notice data-notice-${fileNotice.type}`} role="status" aria-live="polite">
            {fileNotice.text}
          </div>
        )}
      </section>

      {confirmingPasteImport && pastePreview && (
        <div className="confirm-layer" role="dialog" aria-modal="true" aria-labelledby="share-paste-confirm-title">
          <div className="confirm-dialog">
            <h3 id="share-paste-confirm-title">确认用粘贴内容覆盖本地数据？</h3>
            <p>
              会整体覆盖当前全部简历资料、简历原文件、AI 配置和通用设置。导入走既有备份校验，
              校验失败不会改动本地数据；此操作不能撤销，建议先导出一次本地备份。
            </p>
            <div className="sync-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmingPasteImport(false)} disabled={busy !== null}>
                取消
              </button>
              <button className="btn btn-primary" onClick={() => void importPasted()} disabled={busy !== null}>
                {busy === 'import' ? '导入中…' : '确认覆盖并导入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
