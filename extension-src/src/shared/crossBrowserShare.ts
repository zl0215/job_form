// 跨浏览器资料共享（Chrome ↔ Edge 等 Chromium 浏览器，无需服务器）。
//
// 两条路径共用本模块的纯函数：
//   A. 剪贴板快速共享：后台生成与「导出完整数据」一致的 BackupDocument v2 JSON；
//   B. 共享文件自动同步：把一个本地 JSON 文件当作共享介质，文件内容同样是
//      BackupDocument v2，并额外带上 savedAt / sourceExtensionVersion。
//
// 本模块除 sha256（WebCrypto）外没有任何副作用，不依赖 chrome API，
// 可直接在 Node 测试中运行。所有摘要只包含计数/时间/布尔值，绝不包含资料值。
import type {
  BackupData,
  BackupDocumentV2,
  BackupErrorCode,
  BackupParseResult,
} from './types.ts';
import { createBackupDocument, parseAndValidateBackup } from './backup.ts';
import { stableStringifyBusinessData } from './sync.ts';

/** 共享文件默认文件名（设置页「新建共享文件」的 suggestedName）。 */
export const SHARE_FILE_NAME = 'campus-form-agent-share.json';
/** 共享文件在 chrome.storage.local 中的元数据键。 */
export const SHARE_META_STORAGE_KEY = 'cfsShareMeta';
/** 自动同步：本地资料写入后延迟写入共享文件（防抖）。 */
export const SHARE_AUTO_SYNC_DEBOUNCE_MS = 800;

export type SharePermissionState = 'granted' | 'prompt' | 'denied' | 'unknown';

/** 共享文件同步元数据（chrome.storage.local: cfsShareMeta）。 */
export interface ShareFileMetadata {
  /** 绑定文件的显示名（FileSystemHandle.name），不含路径。 */
  fileLabel: string | null;
  /** 上次成功同步（上传/下载/确认一致）的时间。 */
  lastSyncedAt: string | null;
  /** 上次同步基线下本地资料的业务内容哈希。 */
  lastLocalHash: string | null;
  /** 上次同步基线下共享文件的业务内容哈希。 */
  lastRemoteHash: string | null;
  /** 上次同步基线下共享文件的保存时间（文件内 savedAt）。 */
  lastRemoteSavedAt: string | null;
  /** 文件句柄最近一次查询到的读写权限状态。 */
  permissionState: SharePermissionState;
}

/** 只含计数/时间的同步摘要：UI 只能渲染这些字段，禁止放资料值。 */
export interface ShareSyncSummary {
  profileCount: number;
  educationCount: number;
  experienceCount: number;
  projectCount: number;
  awardCount: number;
  certificationCount: number;
  skillCount: number;
  customInformationCount: number;
  applicationRecordCount: number;
  hasResumeFile: boolean;
  hasLLMConfig: boolean;
  hasApiKey: boolean;
  /** 所有简历里最晚的 updatedAt；用于界面显示“本地更新时间”。 */
  latestUpdatedAt: string | null;
}

/** 共享文件文档：在 BackupDocument v2 基础上附加保存时间与来源版本。 */
export interface ShareFileDocument extends BackupDocumentV2 {
  savedAt: string;
  sourceExtensionVersion: string;
}

/** 本地侧参与同步决策的信息。 */
export interface ShareLocalInfo {
  /** 本地资料的业务内容哈希（与 WebDAV 同步一致，按规范化业务数据计算）。 */
  hash: string;
  /** 本地资料最近修改时间（仅用于展示）。 */
  updatedAt: string | null;
  summary: ShareSyncSummary;
}

/** 共享文件侧参与同步决策的信息。 */
export interface ShareRemoteInfo {
  /** 文件是否存在；首次写入前的新文件可能尚不存在。 */
  exists: boolean;
  /** 文件业务内容哈希；空文件为 null。 */
  hash: string | null;
  /** 文件内 savedAt（解析成功时）。 */
  savedAt: string | null;
  summary: ShareSyncSummary | null;
}

export type ShareSyncAction = 'upload' | 'download' | 'noop' | 'conflict';

export type ShareSyncReason =
  /** 共享文件还没有内容（首次写入）。 */
  | 'first-write'
  /** 本地与文件业务内容相同。 */
  | 'identical-content'
  /** 已建立基线且双方自上次同步后都没变。 */
  | 'in-sync'
  /** 仅本地变化：写入共享文件。 */
  | 'local-changed'
  /** 仅共享文件变化：下载到本地。 */
  | 'remote-changed'
  /** 双方都变化：冲突。 */
  | 'both-changed'
  /** 首次绑定且文件已有不同内容，无法判断先后。 */
  | 'first-bind'
  /** 已同步过的文件被删除/移动：不自动重建。 */
  | 'remote-file-missing'
  /** 已同步过的文件被清空：不自动覆盖。 */
  | 'remote-file-empty';

export interface ShareSyncDecision {
  action: ShareSyncAction;
  reason: ShareSyncReason;
  /** 中文说明，供 UI 直接展示（不含任何资料值）。 */
  message: string;
}

export type ShareParseErrorCode = 'EMPTY_FILE' | BackupErrorCode;

export interface ShareParseError {
  code: ShareParseErrorCode;
  message: string;
}

export type ShareParseResult =
  | {
      success: true;
      document: ShareFileDocument;
      data: BackupData;
      summary: ShareSyncSummary;
    }
  | { success: false; error: ShareParseError };

export interface BuildShareDocumentOptions {
  extensionVersion?: string;
  /** 文件内 savedAt；默认取当前时间。 */
  savedAt?: string;
  /** 备份文档 exportedAt；默认与 savedAt 相同。 */
  exportedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验时间字符串；无效时返回 null（不抛错）。 */
export function normalizeShareTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function normalizeHash(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function normalizeSharePermissionState(value: unknown): SharePermissionState {
  return value === 'granted' || value === 'prompt' || value === 'denied' ? value : 'unknown';
}

/** 把 chrome.storage.local 读出的任意值规范化为同步元数据。 */
export function normalizeShareMetadata(value: unknown): ShareFileMetadata {
  const record = isRecord(value) ? value : {};
  return {
    fileLabel: typeof record.fileLabel === 'string' && record.fileLabel.trim() !== ''
      ? record.fileLabel
      : null,
    lastSyncedAt: normalizeShareTimestamp(record.lastSyncedAt),
    lastLocalHash: normalizeHash(record.lastLocalHash),
    lastRemoteHash: normalizeHash(record.lastRemoteHash),
    lastRemoteSavedAt: normalizeShareTimestamp(record.lastRemoteSavedAt),
    permissionState: normalizeSharePermissionState(record.permissionState),
  };
}

export function createEmptyShareMetadata(
  fileLabel: string | null = null,
  permissionState: SharePermissionState = 'unknown',
): ShareFileMetadata {
  return {
    fileLabel,
    lastSyncedAt: null,
    lastLocalHash: null,
    lastRemoteHash: null,
    lastRemoteSavedAt: null,
    permissionState,
  };
}

/** 是否已经建立过可用同步基线（两个哈希都来自同一次成功同步）。 */
export function hasShareBaseline(meta: ShareFileMetadata | null | undefined): boolean {
  return Boolean(meta?.lastLocalHash && meta?.lastRemoteHash);
}

/**
 * 统计一套资料库/备份数据的条数，绝不带出任何资料值。
 * 多个简历时教育/实习/项目等计数为各简历之和。
 */
export function buildSyncSummary(data: BackupData): ShareSyncSummary {
  const profiles = data.resumeProfileLibrary?.profiles ?? [];
  let educationCount = 0;
  let experienceCount = 0;
  let projectCount = 0;
  let awardCount = 0;
  let certificationCount = 0;
  let skillCount = 0;
  let customInformationCount = 0;
  let latestUpdatedAt: string | null = null;

  for (const entry of profiles) {
    const profile = entry.profile;
    educationCount += profile.education?.length ?? 0;
    experienceCount += profile.experience?.length ?? 0;
    projectCount += profile.projects?.length ?? 0;
    awardCount += profile.awards?.length ?? 0;
    certificationCount += profile.certifications?.length ?? 0;
    skillCount += profile.skills?.length ?? 0;
    customInformationCount += profile.customInformation?.length ?? 0;
    const updatedAt = normalizeShareTimestamp(entry.updatedAt);
    if (updatedAt && (latestUpdatedAt === null || Date.parse(updatedAt) > Date.parse(latestUpdatedAt))) {
      latestUpdatedAt = updatedAt;
    }
  }

  return {
    profileCount: profiles.length,
    educationCount,
    experienceCount,
    projectCount,
    awardCount,
    certificationCount,
    skillCount,
    customInformationCount,
    applicationRecordCount: data.applicationRecords?.length ?? 0,
    hasResumeFile: profiles.some(item => Boolean(item.profile.resume?.fileData)),
    hasLLMConfig: Boolean(data.llmConfig),
    hasApiKey: Boolean(data.llmConfig?.apiKey),
    latestUpdatedAt,
  };
}

/** 业务内容哈希：与 WebDAV 同步复用同一套规范化字符串，避免格式差异误判。 */
export async function sha256BusinessData(data: BackupData): Promise<string> {
  return sha256Hex(stableStringifyBusinessData(data));
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** 生成共享文件文档（BackupDocument v2 + savedAt + sourceExtensionVersion）。 */
export function buildShareDocument(
  data: BackupData,
  options: BuildShareDocumentOptions = {},
): ShareFileDocument {
  const savedAt = normalizeShareTimestamp(options.savedAt) ?? new Date().toISOString();
  const extensionVersion = options.extensionVersion?.trim() || 'unknown';
  const document = createBackupDocument(
    data,
    extensionVersion,
    normalizeShareTimestamp(options.exportedAt) ?? savedAt,
  );
  return {
    ...document,
    savedAt,
    sourceExtensionVersion: extensionVersion,
  };
}

export function serializeShareDocument(document: ShareFileDocument): string {
  return JSON.stringify(document, null, 2);
}

/**
 * 解析共享文件内容：复用 backup.ts 的既有校验（兼容 v1 备份文档）。
 * 空文件返回 EMPTY_FILE，其他错误沿用 BackupErrorCode，消息不含任何资料值。
 */
export function parseShareDocument(raw: string): ShareParseResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { success: false, error: { code: 'EMPTY_FILE', message: '共享文件为空' } };
  }
  const parsed: BackupParseResult = parseAndValidateBackup(raw);
  if (!parsed.success) {
    return {
      success: false,
      error: { code: parsed.error.code, message: parsed.error.message },
    };
  }
  let envelope: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value)) envelope = value;
  } catch {
    // parseAndValidateBackup 已校验 JSON 合法性，这里的解析只用于读取扩展字段。
  }
  const exportedAt = parsed.document.exportedAt;
  const savedAt = normalizeShareTimestamp(envelope.savedAt) ?? exportedAt;
  const sourceExtensionVersion = typeof envelope.sourceExtensionVersion === 'string'
    && envelope.sourceExtensionVersion.trim() !== ''
    ? envelope.sourceExtensionVersion
    : parsed.document.source.extensionVersion;
  const document: ShareFileDocument = {
    ...parsed.document,
    savedAt,
    sourceExtensionVersion,
  };
  return {
    success: true,
    document,
    data: parsed.document.data,
    summary: buildSyncSummary(parsed.document.data),
  };
}

/** 共享文件里是否还是空内容（可以是 0 字节，也可以是只有空白）。 */
export function isEmptyShareFileContent(raw: string): boolean {
  return raw.trim() === '';
}

/**
 * 同步决策矩阵（纯函数）：
 *   - noop：内容相同，或已建立基线且双方自上次同步后都没变；
 *   - upload：共享文件无内容（首次写入），或仅本地变化；
 *   - download：仅共享文件变化；
 *   - conflict：双方都变化、首次绑定内容不同、已同步文件被删除/清空。
 * 没有把握时一律返回 conflict：绝不静默覆盖任何一方。
 */
export function computeSyncDecision(
  meta: ShareFileMetadata | null | undefined,
  local: ShareLocalInfo,
  remote: ShareRemoteInfo,
): ShareSyncDecision {
  const baseline = hasShareBaseline(meta) ? meta : null;
  const everSynced = Boolean(meta?.lastSyncedAt) || baseline !== null;

  if (!remote.exists) {
    if (!everSynced) {
      return {
        action: 'upload',
        reason: 'first-write',
        message: '共享文件还没有内容，将把本地资料写入共享文件。',
      };
    }
    return {
      action: 'conflict',
      reason: 'remote-file-missing',
      message: '共享文件不存在或已被移动/删除，系统不会自动重建，也没有改动本地资料。',
    };
  }

  if (remote.hash === null) {
    if (!everSynced) {
      return {
        action: 'upload',
        reason: 'first-write',
        message: '共享文件为空，将把本地资料写入共享文件。',
      };
    }
    return {
      action: 'conflict',
      reason: 'remote-file-empty',
      message: '共享文件内容为空（可能被其他程序清空），系统没有改动本地资料。',
    };
  }

  if (remote.hash === local.hash) {
    return {
      action: 'noop',
      reason: 'identical-content',
      message: '本地资料与共享文件内容一致，无需同步。',
    };
  }

  if (!baseline) {
    return {
      action: 'conflict',
      reason: 'first-bind',
      message: '首次连接这个共享文件，无法判断哪边更新。系统没有覆盖任何一方，请选择保留哪个版本。',
    };
  }

  const localChanged = local.hash !== baseline.lastLocalHash;
  const remoteChanged = remote.hash !== baseline.lastRemoteHash;

  if (!localChanged && !remoteChanged) {
    return {
      action: 'noop',
      reason: 'in-sync',
      message: '双方自上次同步后都没有变化，无需同步。',
    };
  }
  if (localChanged && !remoteChanged) {
    return {
      action: 'upload',
      reason: 'local-changed',
      message: '本地资料有更新、共享文件未变化，将把本地资料写入共享文件。',
    };
  }
  if (!localChanged && remoteChanged) {
    return {
      action: 'download',
      reason: 'remote-changed',
      message: '共享文件有更新、本地资料未变化，将从共享文件更新本地资料。',
    };
  }
  return {
    action: 'conflict',
    reason: 'both-changed',
    message: '本地资料与共享文件都已变化。系统没有覆盖任何一方，请选择保留哪个版本。',
  };
}
