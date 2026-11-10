import type {
  FocusedFieldWriteResult,
  Message,
  MessageResponse,
  PageFieldReport,
  PageFrameFieldReport,
  PanelFillSelectedPayload,
  PanelFillSummary,
  PanelFrameFillResult,
  PanelFrameScan,
  PanelFrameUndoResult,
  PanelScanResult,
  PanelUndoResult,
  SaveFieldAliasResult,
  UserProfile,
  ParsedResumeData,
  VisualRegionFillPayload,
  VisualRegionFillRequestPayload,
  WebDAVConfig,
} from '../shared/types.ts';
import { StorageService } from '../shared/storage.ts';
import { updateActiveUserProfile } from '../shared/resumeProfiles.ts';
import {
  addLearnedAlias,
  describeFieldAliasError,
  isKnownProfileField,
  normalizeLearnedAlias,
} from '../shared/fieldLearning.ts';
import {
  createBackupDocument,
  createBackupSummary,
  parseAndValidateBackup,
  serializeBackup,
} from '../shared/backup.ts';
import {
  enqueueSync,
  enqueueSyncAndWait,
  forceDownloadRemote,
  forceUploadLocal,
  resolveConflict,
} from '../shared/sync.ts';
import {
  normalizeWebDAVServerUrl,
  testConnection as testWebDAVConnection,
  validateWebDAVUrl,
} from '../services/webdav.ts';
import { parseResume, isStructuredType, parseStructuredResume } from '../parsers/index.ts';
import { NLPHelper } from '../utils/nlpHelper.ts';
import { LLMService } from '../services/llm/llmService.ts';
import {
  buildAnswerGenerationPrompt,
  buildResumeParsingPrompt,
  buildFieldMatchingPrompt,
  buildSectionFillPrompt,
} from '../services/llm/prompts.ts';
import type { AIFillSectionPayload } from '../services/llm/prompts.ts';
import type { LLMConfig } from '../services/llm/types.ts';
import {
  handleCreateApplicationRecord,
  handleCreateApplicationRecordDraft,
  handleDeleteApplicationRecord,
  handleExportApplicationRecordsCsv,
  handleGetApplicationRecordDraft,
  handleGetApplicationRecords,
  handleImportApplicationRecordsCsv,
  handleUpdateApplicationRecord,
} from './applicationRecords.ts';
import {
  createResumeProfileHandler,
  deleteResumeProfileHandler,
  duplicateResumeProfileHandler,
  getResumeProfilesHandler,
  toResumeProfileSummary,
  renameResumeProfileHandler,
  serializeResumeProfileMutation,
  switchResumeProfileHandler,
} from './resumeProfiles.ts';
import {
  captureVisibleRegion,
  handleVisualRegionFill,
} from './visualRegionFill.ts';

// Background Service Worker 入口
console.log('Background service worker started');

const aiFillControllers = new Map<string, AbortController>();

async function queueAutoSync(reason: string): Promise<'disabled' | 'queued'> {
  const config = await StorageService.getWebDAVConfig();
  if (!config?.enabled) return 'disabled';
  enqueueSync(reason);
  return 'queued';
}

async function queueAutoSyncResult(reason: string): Promise<
  { sync: 'disabled' | 'queued' } | { sync: 'error'; syncError: string }
> {
  try {
    return { sync: await queueAutoSync(reason) };
  } catch (error) {
    return {
      sync: 'error',
      syncError: error instanceof Error ? error.message : '自动同步排队失败',
    };
  }
}

function activeUserProfile(library: Awaited<ReturnType<typeof StorageService.getResumeProfileLibrary>>): UserProfile {
  const active = library.profiles.find(item => item.id === library.activeProfileId);
  if (!active) throw new Error('当前简历不存在');
  return active.profile;
}

// 监听消息
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    // 处理异步消息
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('Message handler error:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });

    // 返回 true 表示异步响应
    return true;
  }
);

// 处理消息
export async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender
): Promise<MessageResponse> {
  switch (message.type) {
    case 'GET_USER_PROFILE':
      return await handleGetUserProfile();

    case 'GET_ACTIVE_RESUME_CONTEXT': {
      const library = await StorageService.getResumeProfileLibrary();
      const active = library.profiles.find(item => item.id === library.activeProfileId);
      if (!active) return { success: false, error: '当前简历不存在' };
      return { success: true, data: { ...toResumeProfileSummary(library), profile: active.profile, revision: active.updatedAt } };
    }

    case 'SAVE_USER_PROFILE':
      return await handleSaveUserProfile('profile' in message.payload ? message.payload.profile : message.payload, 'profile' in message.payload ? message.payload.expectedProfileId : undefined);

    case 'GET_RESUME_PROFILES':
      return await getResumeProfilesHandler();

    case 'SWITCH_RESUME_PROFILE':
      return await switchResumeProfileHandler(message.payload, { now: () => new Date().toISOString(), queueAutoSync });

    case 'CREATE_RESUME_PROFILE':
      return await createResumeProfileHandler(message.payload, { now: () => new Date().toISOString(), queueAutoSync });

    case 'DUPLICATE_RESUME_PROFILE':
      return await duplicateResumeProfileHandler(message.payload, { now: () => new Date().toISOString(), queueAutoSync });

    case 'RENAME_RESUME_PROFILE':
      return await renameResumeProfileHandler(message.payload, { now: () => new Date().toISOString(), queueAutoSync });

    case 'DELETE_RESUME_PROFILE':
      return await deleteResumeProfileHandler(message.payload, { now: () => new Date().toISOString(), queueAutoSync });

    case 'PARSE_RESUME':
      return await handleParseResume(
        message.payload.file,
        message.payload.fileType,
        message.payload.fileName,
        message.payload.rawText
      );

    case 'GET_PAGE_FIELD_REPORT':
      return await handleGetPageFieldReport(message.payload);

    case 'SAVE_FIELD_ALIAS':
      return await handleSaveFieldAlias(message.payload);

    // v1.1 网页内悬浮面板：面板在顶层 frame，扫描/填充/撤销由 background 按 frame 路由。
    case 'PANEL_SCAN':
      return await handlePanelScan(message.payload, sender);

    case 'PANEL_FILL_SELECTED':
      return await handlePanelFillSelected(message.payload, sender);

    case 'PANEL_UNDO':
      return await handlePanelUndo(sender);

    case 'PANEL_OPEN_OPTIONS':
      try {
        await chrome.runtime.openOptionsPage();
        return { success: true };
      } catch (error) {
        console.warn('打开设置页失败:', error);
        return { success: false, error: '打开设置页失败，请从扩展管理页进入选项' };
      }

    case 'PANEL_OPEN_POPUP':
      return await handleOpenPopupTab();

    case 'CREATE_APPLICATION_RECORD_DRAFT':
      return await handleCreateApplicationRecordDraft(message.payload.tabId);

    case 'GET_APPLICATION_RECORD_DRAFT':
      return await handleGetApplicationRecordDraft(message.payload.draftId);

    case 'GET_APPLICATION_RECORDS':
      return await handleGetApplicationRecords();

    case 'CREATE_APPLICATION_RECORD':
      return await handleApplicationRecordMutation(
        () => handleCreateApplicationRecord(message.payload),
        'application-record-create',
      );

    case 'UPDATE_APPLICATION_RECORD':
      return await handleApplicationRecordMutation(
        () => handleUpdateApplicationRecord(message.payload),
        'application-record-update',
      );

    case 'DELETE_APPLICATION_RECORD':
      return await handleApplicationRecordMutation(
        () => handleDeleteApplicationRecord(message.payload.id),
        'application-record-delete',
      );

    case 'EXPORT_APPLICATION_RECORDS_CSV':
      return await handleExportApplicationRecordsCsv();

    case 'IMPORT_APPLICATION_RECORDS_CSV':
      return await handleApplicationRecordMutation(
        () => handleImportApplicationRecordsCsv(message.payload.csv),
        'application-record-import',
      );

    case 'GET_RESUME_DATA':
      return await handleGetResumeData();

    case 'GENERATE_ANSWER':
      return await handleGenerateAnswer(message.payload);

    case 'MATCH_FIELDS_LLM':
      return await handleMatchFieldsLLM(message.payload);

    case 'AI_FILL_SECTION':
      return await handleAIFillSection(message.payload);

    case 'AI_FILL_VISUAL_REGION':
      return await handleVisualRegionFillRequest(message.payload, sender);

    case 'CANCEL_AI_FILL':
      return handleCancelAIFill(message.payload.requestId);

    case 'WRITE_FOCUSED_FIELD':
      return await handleWriteFocusedField(message.payload.tabId, message.payload.value);

    case 'GET_LLM_CONFIG':
      return await handleGetLLMConfig();

    case 'SAVE_LLM_CONFIG':
      return await handleSaveLLMConfig(message.payload);

    case 'TEST_LLM_CONNECTION':
      return await handleTestConnection(message.payload);

    case 'EXPORT_BACKUP':
      return await handleExportBackup();

    case 'PREVIEW_BACKUP_IMPORT':
      return handlePreviewBackup(message.payload.json);

    case 'IMPORT_BACKUP':
      return await handleImportBackup(message.payload.json);

    case 'GET_WEBDAV_CONFIG':
      return { success: true, data: await StorageService.getWebDAVConfig() };

    case 'SAVE_WEBDAV_CONFIG':
      return await handleSaveWebDAVConfig(message.payload);

    case 'TEST_WEBDAV':
      return await handleTestWebDAV(message.payload);

    case 'GET_SYNC_STATUS':
      return { success: true, data: await StorageService.getSyncMetadata() };

    case 'SYNC_NOW':
      return { success: true, data: await enqueueSyncAndWait('manual') };

    case 'FORCE_UPLOAD_LOCAL':
      return { success: true, data: { status: await forceUploadLocal() } };

    case 'FORCE_DOWNLOAD_REMOTE':
      return { success: true, data: { status: await forceDownloadRemote() } };

    case 'RESOLVE_SYNC_CONFLICT':
      return {
        success: true,
        data: { status: await resolveConflict(message.payload.choice) },
      };

    default:
      return {
        success: false,
        error: 'Unknown message type'
      };
  }
}

async function handleApplicationRecordMutation(
  operation: () => Promise<MessageResponse>,
  reason: string,
): Promise<MessageResponse> {
  const response = await operation();
  if (response.success) {
    await queueAutoSync(reason);
  }
  return response;
}

// —— 「本页字段对照」：读取各 frame 的未识别字段（只含网页字段元数据，不含资料值） ——

async function resolvePageReportTabId(payload?: { tabId?: number } | null): Promise<number> {
  if (typeof payload?.tabId === 'number') {
    try {
      const tab = await chrome.tabs.get(payload.tabId);
      if (tab?.id) return tab.id;
    } catch {
      // 指定标签页已关闭时回退到当前活动标签页。
    }
  }
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused?.id) return focused.id;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id) return active.id;
  throw new Error('没有可用的当前标签页');
}

async function discoverPageReportFrameIds(tabId: number): Promise<number[]> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => true,
    });
    return Array.from(new Set(results.map(result => result.frameId)));
  } catch {
    // 无法枚举 frame 时至少尝试主 frame（content script 可能已经注入）。
    return [0];
  }
}

async function requestPageFrameReport(
  tabId: number,
  frameId: number,
): Promise<PageFrameFieldReport | null> {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      { type: 'GET_PAGE_FIELD_REPORT' } satisfies Message,
      { frameId },
    ) as MessageResponse<PageFrameFieldReport> | undefined;
    if (!response?.success || !response.data) return null;
    return {
      detected: Number(response.data.detected) || 0,
      matched: Number(response.data.matched) || 0,
      unmatched: Array.isArray(response.data.unmatched) ? response.data.unmatched : [],
      matchedFields: Array.isArray(response.data.matchedFields) ? response.data.matchedFields : [],
      blocked: Array.isArray(response.data.blocked) ? response.data.blocked : [],
      blockedCount: Number(response.data.blockedCount) || 0,
    };
  } catch {
    // 该 frame 没有 content script（受限 iframe / about:blank 等）时跳过。
    return null;
  }
}

async function handleGetPageFieldReport(
  payload?: { tabId?: number } | null,
): Promise<MessageResponse<PageFieldReport>> {
  try {
    const tabId = await resolvePageReportTabId(payload);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url && isRestrictedPage(tab.url)) {
      return {
        success: false,
        error: '当前页面是浏览器内置页面或扩展商店页面，无法读取招聘表单字段',
      };
    }

    const frameIds = await discoverPageReportFrameIds(tabId);
    const frameReports = await Promise.all(frameIds.map(async frameId => ({
      frameId,
      report: await requestPageFrameReport(tabId, frameId),
    })));
    const available = frameReports.filter(
      (item): item is { frameId: number; report: PageFrameFieldReport } => Boolean(item.report),
    );
    if (available.length === 0) {
      return {
        success: false,
        error: '无法读取当前页面的表单字段：请确认招聘网页已打开，并刷新页面后重试',
      };
    }

    const frames = available.map(({ frameId, report }) => ({ ...report, frameId }));
    return {
      success: true,
      data: {
        detected: frames.reduce((total, frame) => total + frame.detected, 0),
        matched: frames.reduce((total, frame) => total + frame.matched, 0),
        unmatched: frames.flatMap(frame => frame.unmatched.map(item => ({
          ...item,
          id: `${frame.frameId}:${item.id}`,
        }))),
        matchedFields: frames.flatMap(frame => frame.matchedFields),
        blocked: frames.flatMap(frame => frame.blocked),
        blockedCount: frames.reduce((total, frame) => total + frame.blockedCount, 0),
        frames,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '读取本页字段失败',
    };
  }
}

// —— v1.1 网页内悬浮面板：background 按 frame 路由 扫描 / 选择性填充 / 撤销 ——
// 面板只在顶层 frame；字段 id 统一为 `frame-<frameId>:<localId>`，由 background 拆回各 frame。

const PANEL_FIELD_ID_PATTERN = /^frame-(\d+):(.+)$/;
const PANEL_MAX_SELECTED_FIELDS = 300;

function buildPanelFieldId(frameId: number, localId: string): string {
  return `frame-${frameId}:${localId}`;
}

function parsePanelFieldId(fieldId: string): { frameId: number; localId: string } | null {
  const match = PANEL_FIELD_ID_PATTERN.exec((fieldId || '').trim());
  if (!match) return null;
  const frameId = Number(match[1]);
  if (!Number.isInteger(frameId) || frameId < 0) return null;
  return { frameId, localId: match[2] };
}

/** 面板消息来自页面 content script：优先使用 sender.tab，其次按 payload/活动标签页回退。 */
async function resolvePanelSenderTabId(
  sender: chrome.runtime.MessageSender,
  payload?: { tabId?: number } | null,
): Promise<number> {
  if (sender?.tab?.id) return sender.tab.id;
  return resolvePageReportTabId(payload);
}

async function requestPanelFrameScan(
  tabId: number,
  frameId: number,
): Promise<PanelFrameScan | null> {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      { type: 'PANEL_FRAME_SCAN' } satisfies Message,
      { frameId },
    ) as MessageResponse<PanelFrameScan> | undefined;
    if (!response?.success || !response.data) return null;
    const data = response.data;
    return {
      frameId,
      detected: Number(data.detected) || 0,
      blockedCount: Number(data.blockedCount) || 0,
      fields: Array.isArray(data.fields) ? data.fields : [],
      unmatched: Array.isArray(data.unmatched) ? data.unmatched : [],
    };
  } catch {
    // 该 frame 没有 content script（受限 iframe / about:blank 等）时跳过。
    return null;
  }
}

async function handlePanelScan(
  payload: { tabId?: number } | null | undefined,
  sender: chrome.runtime.MessageSender,
): Promise<MessageResponse<PanelScanResult>> {
  try {
    const tabId = await resolvePanelSenderTabId(sender, payload);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url && isRestrictedPage(tab.url)) {
      return {
        success: false,
        error: '当前页面是浏览器内置页面或扩展商店页面，无法使用页面面板',
      };
    }

    const frameIds = (await discoverPageReportFrameIds(tabId)).sort((a, b) => a - b);
    const frameScans = await Promise.all(
      frameIds.map(async frameId => requestPanelFrameScan(tabId, frameId)),
    );
    const available = frameScans.filter(
      (scan): scan is PanelFrameScan => Boolean(scan),
    );
    if (available.length === 0) {
      return {
        success: false,
        error: '无法读取当前页面字段：请确认招聘网页已打开，并刷新页面后重试',
      };
    }

    const fields = available.flatMap(scan => scan.fields.map(field => ({
      ...field,
      id: buildPanelFieldId(scan.frameId, field.id),
      frameId: scan.frameId,
    })));
    const unmatched = available.flatMap(scan => scan.unmatched.map(item => ({
      ...item,
      id: buildPanelFieldId(scan.frameId, item.id),
      frameId: scan.frameId,
    })));

    return {
      success: true,
      data: {
        fields,
        unmatched,
        detected: available.reduce((total, scan) => total + scan.detected, 0),
        blockedCount: available.reduce((total, scan) => total + scan.blockedCount, 0),
        frames: available.map(scan => ({
          frameId: scan.frameId,
          detected: scan.detected,
          blockedCount: scan.blockedCount,
        })),
        scannedAt: new Date().toISOString(),
        topFrameUrl: tab?.url || '',
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '扫描本页字段失败',
    };
  }
}

async function requestPanelFrameFill(
  tabId: number,
  frameId: number,
  localIds: string[],
  allowAutoAddRows: boolean,
): Promise<PanelFrameFillResult | null> {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      {
        type: 'PANEL_FRAME_FILL',
        payload: { localIds, allowAutoAddRows },
      } satisfies Message,
      { frameId },
    ) as MessageResponse<PanelFrameFillResult> | undefined;
    if (!response?.success || !response.data) return null;
    const data = response.data;
    return {
      frameId,
      results: Array.isArray(data.results) ? data.results : [],
      attempted: Number(data.attempted) || 0,
      filled: Number(data.filled) || 0,
      failed: Number(data.failed) || 0,
      skippedExisting: Number(data.skippedExisting) || 0,
      skippedBlocked: Number(data.skippedBlocked) || 0,
      skippedAmbiguous: Number(data.skippedAmbiguous) || 0,
      urlBefore: String(data.urlBefore || ''),
      urlAfter: String(data.urlAfter || ''),
      urlChanged: data.urlChanged === true,
      undoAvailable: data.undoAvailable === true,
      autoAddedRows: Number(data.autoAddedRows) || 0,
    };
  } catch {
    return null;
  }
}

async function handlePanelFillSelected(
  payload: PanelFillSelectedPayload,
  sender: chrome.runtime.MessageSender,
): Promise<MessageResponse<PanelFillSummary>> {
  try {
    const tabId = await resolvePanelSenderTabId(sender, null);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url && isRestrictedPage(tab.url)) {
      return { success: false, error: '当前页面不是可访问的招聘网页，无法填充' };
    }

    const requested = Array.isArray(payload?.fieldIds)
      ? payload.fieldIds.filter((fieldId): fieldId is string => typeof fieldId === 'string')
      : [];
    if (requested.length === 0) return { success: false, error: '没有勾选任何字段' };
    if (requested.length > PANEL_MAX_SELECTED_FIELDS) {
      return {
        success: false,
        error: `一次最多填充 ${PANEL_MAX_SELECTED_FIELDS} 个字段，请分批勾选`,
      };
    }

    const grouped = new Map<number, string[]>();
    const invalidIds: string[] = [];
    for (const fieldId of requested) {
      const parsed = parsePanelFieldId(fieldId);
      if (!parsed) {
        invalidIds.push(fieldId);
        continue;
      }
      const current = grouped.get(parsed.frameId) || [];
      current.push(parsed.localId);
      grouped.set(parsed.frameId, current);
    }

    const allowAutoAddRows = payload?.options?.allowAutoAddRows === true
      || payload?.allowAutoAddRows === true;
    const frameIds = (await discoverPageReportFrameIds(tabId)).sort((a, b) => a - b);
    const targetFrameIds = frameIds.filter(frameId => grouped.has(frameId));
    const responses = await Promise.all(targetFrameIds.map(async frameId => ({
      frameId,
      result: await requestPanelFrameFill(
        tabId,
        frameId,
        grouped.get(frameId) || [],
        allowAutoAddRows,
      ),
    })));

    const summary: PanelFillSummary = {
      results: [],
      attempted: 0,
      filled: 0,
      failed: 0,
      skippedExisting: 0,
      skippedBlocked: 0,
      skippedAmbiguous: 0,
      notFound: 0,
      urlChanged: false,
      undoAvailable: false,
      autoAddedRows: 0,
      frames: [],
    };

    for (const { frameId, result } of responses) {
      if (!result) {
        summary.frames.push({ frameId, urlChanged: false, error: '该嵌入页没有响应，已跳过' });
        continue;
      }
      summary.frames.push({ frameId, urlChanged: result.urlChanged });
      for (const item of result.results) {
        summary.results.push({
          fieldId: buildPanelFieldId(frameId, item.localId),
          localId: item.localId,
          frameId,
          outcome: item.outcome,
          ...(item.message ? { message: item.message } : {}),
        });
      }
      summary.attempted += result.attempted;
      summary.filled += result.filled;
      summary.failed += result.failed;
      summary.skippedExisting += result.skippedExisting;
      summary.skippedBlocked += result.skippedBlocked;
      summary.skippedAmbiguous += result.skippedAmbiguous;
      summary.urlChanged = summary.urlChanged || result.urlChanged;
      summary.undoAvailable = summary.undoAvailable || result.undoAvailable;
      summary.autoAddedRows += result.autoAddedRows;
    }

    // 已卸载 / 未响应的 frame 以及无效 id：明确报告“未找到”，不静默丢失。
    for (const [frameId, localIds] of grouped.entries()) {
      if (frameIds.includes(frameId)) continue;
      for (const localId of localIds) {
        summary.results.push({
          fieldId: buildPanelFieldId(frameId, localId),
          localId,
          frameId,
          outcome: 'not-found',
          message: '嵌入页已卸载，字段未找到',
        });
      }
    }
    for (const fieldId of invalidIds) {
      summary.results.push({
        fieldId,
        localId: '',
        frameId: -1,
        outcome: 'not-found',
        message: '字段 id 无效',
      });
    }
    summary.notFound = summary.results.filter(item => item.outcome === 'not-found').length;

    return { success: true, data: summary };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '填充所选字段失败',
    };
  }
}

async function requestPanelFrameUndo(
  tabId: number,
  frameId: number,
): Promise<PanelFrameUndoResult | null> {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      { type: 'PANEL_FRAME_UNDO' } satisfies Message,
      { frameId },
    ) as MessageResponse<PanelFrameUndoResult> | undefined;
    if (!response?.success || !response.data) return null;
    const data = response.data;
    return {
      frameId,
      restored: Number(data.restored) || 0,
      skipped: Number(data.skipped) || 0,
      failed: Number(data.failed) || 0,
      entries: Array.isArray(data.entries) ? data.entries : [],
    };
  } catch {
    return null;
  }
}

async function handlePanelUndo(
  sender: chrome.runtime.MessageSender,
): Promise<MessageResponse<PanelUndoResult>> {
  try {
    const tabId = await resolvePanelSenderTabId(sender, null);
    const frameIds = (await discoverPageReportFrameIds(tabId)).sort((a, b) => a - b);
    if (frameIds.length === 0) {
      return { success: false, error: '找不到可撤销的页面' };
    }
    const responses = await Promise.all(frameIds.map(async frameId => ({
      frameId,
      result: await requestPanelFrameUndo(tabId, frameId),
    })));

    const result: PanelUndoResult = {
      restored: 0,
      skipped: 0,
      failed: 0,
      entries: [],
      frames: [],
    };
    for (const { frameId, result: frameResult } of responses) {
      if (!frameResult) {
        result.frames.push({ frameId, restored: 0, skipped: 0, failed: 0, error: '该嵌入页没有响应' });
        continue;
      }
      result.frames.push({
        frameId,
        restored: frameResult.restored,
        skipped: frameResult.skipped,
        failed: frameResult.failed,
      });
      for (const entry of frameResult.entries) {
        result.entries.push({
          ...(entry.localId
            ? { localId: entry.localId, fieldId: buildPanelFieldId(frameId, entry.localId) }
            : {}),
          frameId,
          outcome: entry.outcome,
          ...(entry.message ? { message: entry.message } : {}),
        });
      }
      result.restored += frameResult.restored;
      result.skipped += frameResult.skipped;
      result.failed += frameResult.failed;
    }
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '撤销填充失败',
    };
  }
}

async function handleOpenPopupTab(): Promise<MessageResponse> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/index.html') });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '无法打开扩展页面',
    };
  }
}

// —— 工具栏图标：打开/关闭页面内悬浮面板（fallback：注入 content.js → 选项页） ——

async function tryTogglePanel(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      { type: 'PANEL_TOGGLE' } satisfies Message,
      { frameId: 0 },
    ) as MessageResponse<{ visible: boolean }> | undefined;
    return Boolean(response?.success);
  } catch {
    return false;
  }
}

async function openOptionsPageSafely(reason: string): Promise<void> {
  console.warn(`[校招表单助手] ${reason}，改为打开设置页`);
  try {
    await chrome.runtime.openOptionsPage();
  } catch (error) {
    console.warn('[校招表单助手] 打开设置页也失败:', error);
  }
}

async function handleActionClicked(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab?.id;
  if (!tabId) {
    await openOptionsPageSafely('无法获取当前标签页');
    return;
  }
  const url = tab.url || '';
  if (isRestrictedPage(url)) {
    // 浏览器内置页/扩展商店页无法注入面板，按约定回退到设置页（不静默失败）。
    await openOptionsPageSafely('当前页面不支持页面内面板');
    return;
  }

  if (await tryTogglePanel(tabId)) return;

  // 内容脚本未注入（页面在扩展安装前已打开等）：先注入 content.js，再重试。
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['content.js'],
    });
  } catch (error) {
    console.warn('[校招表单助手] 注入页面面板脚本失败:', error);
    await openOptionsPageSafely('无法在当前页面注入面板');
    return;
  }

  if (await tryTogglePanel(tabId)) return;
  await openOptionsPageSafely('页面面板无响应');
}

try {
  if (chrome.action?.onClicked?.addListener) {
    chrome.action.onClicked.addListener(tab => {
      void handleActionClicked(tab);
    });
  }
} catch (error) {
  // 单测/旧版运行时可能没有 chrome.action：记录但不影响消息处理注册。
  console.warn('无法注册工具栏图标点击处理:', error);
}

// —— “记住一次”：把网页字段标题写入当前活动简历的 fieldAliasOverrides ——

type FieldAliasMutationOutcome =
  | {
      saved: true;
      profileKey: string;
      alias: string;
      alreadyExists: boolean;
      keyAliasCount: number;
      totalAliasCount: number;
    }
  | { saved: false; error: string };

async function handleSaveFieldAlias(
  payload: { profileKey: string; alias: string },
): Promise<MessageResponse<SaveFieldAliasResult>> {
  const profileKey = (payload?.profileKey || '').trim();
  const alias = payload?.alias || '';
  try {
    const outcome = await serializeResumeProfileMutation(
      async (): Promise<FieldAliasMutationOutcome> => {
        const library = await StorageService.getResumeProfileLibrary();
        const active = library.profiles.find(item => item.id === library.activeProfileId);
        if (!active) return { saved: false, error: '当前简历不存在' };
        if (!isKnownProfileField(active.profile, profileKey)) {
          return { saved: false, error: '所选资料字段不存在或已被删除，请刷新后重试' };
        }

        const result = addLearnedAlias(active.profile.fieldAliasOverrides, profileKey, alias);
        if (!result.ok) {
          return { saved: false, error: describeFieldAliasError(result.error, result.blockedLabel) };
        }

        if (result.added) {
          const nextProfile: UserProfile = {
            ...active.profile,
            fieldAliasOverrides: result.overrides,
          };
          const nextLibrary = updateActiveUserProfile(
            library,
            nextProfile,
            new Date().toISOString(),
          );
          await StorageService.saveResumeProfileLibrary(nextLibrary);
        }

        return {
          saved: true,
          profileKey,
          alias: normalizeLearnedAlias(alias),
          alreadyExists: result.alreadyExists,
          keyAliasCount: result.keyAliasCount,
          totalAliasCount: result.totalAliasCount,
        };
      },
    );

    if (!outcome.saved) return { success: false, error: outcome.error };
    // 保存成功后再排队自动同步；同步失败不影响本地已保存的字段对照。
    await queueAutoSyncResult('field-alias-learn');
    return { success: true, data: outcome };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '保存字段对照失败',
    };
  }
}

async function handleWriteFocusedField(
  tabId: number,
  value: string
): Promise<MessageResponse<FocusedFieldWriteResult>> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.id) {
      return { success: true, data: { written: false, reason: 'NO_ACTIVE_TAB' } };
    }

    const url = tab.url || '';
    if (isRestrictedPage(url)) {
      return { success: true, data: { written: false, reason: 'RESTRICTED_PAGE' } };
    }

    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'APPLY_FOCUSED_FIELD',
      payload: { value },
    } satisfies Message) as MessageResponse<FocusedFieldWriteResult>;

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /Receiving end does not exist|Could not establish connection/i.test(message)
      ? 'NO_CONTENT_SCRIPT'
      : 'NO_ACTIVE_TAB';
    return { success: true, data: { written: false, reason } };
  }
}

async function handleVisualRegionFillRequest(
  payload: VisualRegionFillPayload | VisualRegionFillRequestPayload,
  sender: chrome.runtime.MessageSender,
): Promise<MessageResponse> {
  const requestId = payload.requestId?.trim();
  let controller: AbortController | undefined;
  if (requestId) {
    controller = new AbortController();
    aiFillControllers.set(requestId, controller);
  }

  try {
    if (isVisualRegionFillPayload(payload)) {
      return await handleVisualRegionFill(payload, undefined, controller?.signal);
    }

    const windowId = sender.tab?.windowId;
    if (typeof windowId !== 'number') {
      return { success: false, error: '无法获取当前页面截图' };
    }

    const image = await captureVisibleRegion(windowId, payload.region);
    if (controller?.signal.aborted) {
      return { success: false, error: 'AI 补填已终止' };
    }

    const strictPayload: VisualRegionFillPayload = { ...payload, image };
    return await handleVisualRegionFill(strictPayload, undefined, controller?.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, error: 'AI 补填已终止' };
    }
    throw error;
  } finally {
    if (requestId) {
      aiFillControllers.delete(requestId);
    }
  }
}

function isVisualRegionFillPayload(
  payload: VisualRegionFillPayload | VisualRegionFillRequestPayload,
): payload is VisualRegionFillPayload {
  return 'image' in payload && Boolean(payload.image?.base64 && payload.image?.mimeType);
}

function isRestrictedPage(url: string): boolean {
  return (
    /^(chrome|edge|about|chrome-extension|edge-extension):\/\//i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com\//i.test(url) ||
    /^https:\/\/microsoftedge\.microsoft\.com\/addons\//i.test(url)
  );
}

async function handleAIFillSection(
  payload: AIFillSectionPayload
): Promise<MessageResponse<Record<string, string>>> {
  const controller = new AbortController();
  aiFillControllers.set(payload.requestId, controller);

  try {
    const config = await StorageService.getLLMConfig();
    if (!config?.apiKey) {
      return { success: false, error: '请先在设置中配置 AI 服务' };
    }

    const profile = await StorageService.getUserProfile();
    if (!profile) {
      return { success: false, error: '请先保存个人资料' };
    }

    const llm = new LLMService(config);
    const { system, user } = buildSectionFillPrompt(payload, profile);
    const result = await llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], controller.signal);

    let jsonStr = result.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const rawMappings = JSON.parse(jsonStr) as Record<string, unknown>;
    const validFields = new Map(payload.fields.map(field => [String(field.index), field]));
    const mappings: Record<string, string> = {};

    for (const [index, rawValue] of Object.entries(rawMappings)) {
      const field = validFields.get(index);
      if (!field || typeof rawValue !== 'string') continue;

      const value = rawValue.trim();
      if (!value) continue;
      if (!aiValueExistsInProfile(profile, value)) continue;
      const option = field.options.find(candidate => aiOptionEquivalent(candidate, value));
      if (field.options.length > 0 && !option) continue;
      mappings[index] = option || value;
    }

    return { success: true, data: mappings };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, error: 'AI 补填已终止' };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI 补填失败',
    };
  } finally {
    aiFillControllers.delete(payload.requestId);
  }
}

function aiOptionEquivalent(left: string, right: string): boolean {
  const normalize = (value: string) => value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^0+(?=\d)/, '')
    .replace(/[年月日号\s._/-]/g, '');
  return normalize(left) === normalize(right);
}

function aiValueExistsInProfile(profile: UserProfile, target: string): boolean {
  const values: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.trim()) values.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(profile);

  return values.some(source => {
    if (source === target) return true;
    const date = source.match(/((?:19|20)\d{2})(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?/);
    if (!date) return false;
    return [date[1], date[2], date[2] && String(Number(date[2])), date[3], date[3] && String(Number(date[3]))]
      .filter(Boolean)
      .some(part => aiOptionEquivalent(String(part), target));
  });
}

function handleCancelAIFill(requestId: string): MessageResponse {
  const controller = aiFillControllers.get(requestId);
  if (!controller) {
    return { success: true, data: { cancelled: false } };
  }

  controller.abort();
  aiFillControllers.delete(requestId);
  return { success: true, data: { cancelled: true } };
}

// 获取用户资料
async function handleGetUserProfile(): Promise<MessageResponse<UserProfile>> {
  try {
    const library = await StorageService.getResumeProfileLibrary();
    const profile = activeUserProfile(library);
    return {
      success: true,
      data: profile
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get user profile'
    };
  }
}

// 保存用户资料
async function handleSaveUserProfile(
  profile: UserProfile,
  expectedProfileId?: string,
): Promise<MessageResponse> {
  try {
    await serializeResumeProfileMutation(async () => {
      const library = await StorageService.getResumeProfileLibrary();
      activeUserProfile(library);
      if (expectedProfileId && library.activeProfileId !== expectedProfileId) throw new Error('当前简历已切换，已拒绝保存陈旧草稿');
      const next = updateActiveUserProfile(library, profile, new Date().toISOString());
      await StorageService.saveResumeProfileLibrary(next);
    });
    const syncResult = await queueAutoSyncResult('profile-save');
    return {
      success: true,
      data: { localSaved: true, ...syncResult }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save user profile'
    };
  }
}

/** 去掉空字符串/空白值，避免解析结果把已填字段清空 */
function dropEmptyValues<T extends object>(source: T | undefined): Partial<T> {
  if (!source) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && !value.trim()) continue;
    if (value === null || value === undefined) continue;
    result[key] = value;
  }
  return result as Partial<T>;
}

/**
 * 解析结果为空数组时保留原有内容。
 * 直接用 `parsed || current` 不行：空数组是真值，会把已有记录清空。
 */
function pickNonEmpty<T>(parsed: T[] | undefined, current: T[] | undefined): T[] {
  if (parsed && parsed.length > 0) return parsed;
  return current || [];
}

// 解析简历
async function handleParseResume(
  fileData: string,
  fileType: string,
  fileName: string,
  preParsedText?: string
): Promise<MessageResponse> {
  try {
    const rawText = preParsedText ?? await parseResume(fileData, fileType);

    let parsedData: ParsedResumeData;
    let parseMethod: 'structured' | 'llm' | 'regex' = 'regex';
    let llmError: string | undefined;

    if (isStructuredType(fileType)) {
      // JSON 简历本身已结构化，直接映射，避免 LLM 二次推断带来的误差
      parsedData = parseStructuredResume(rawText);
      parseMethod = 'structured';
    } else {
      const llmConfig = await StorageService.getLLMConfig();
      if (llmConfig?.apiKey) {
        try {
          parsedData = await parseResumeWithLLM(rawText, llmConfig);
          parseMethod = 'llm';
        } catch (error) {
          // 静默回退会让用户以为 AI 生效了，这里记下原因并回报给界面
          llmError = error instanceof Error ? error.message : String(error);
          console.warn('LLM resume parsing failed, falling back to regex:', error);
          parsedData = NLPHelper.parseResumeText(rawText);
        }
      } else {
        parsedData = NLPHelper.parseResumeText(rawText);
      }
    }

    await serializeResumeProfileMutation(async () => {
      const library = await StorageService.getResumeProfileLibrary();
      const currentProfile = activeUserProfile(library);
      const updatedProfile: UserProfile = {
        // 解析结果里的空值不能覆盖用户已填的内容
        personal: {
          ...currentProfile.personal,
          ...dropEmptyValues(parsedData.personal)
        } as any,
        education: pickNonEmpty(parsedData.education, currentProfile.education) as any,
        experience: pickNonEmpty(parsedData.experience, currentProfile.experience) as any,
        projects: pickNonEmpty(parsedData.projects, currentProfile.projects) as any,
        awards: pickNonEmpty(parsedData.awards, currentProfile.awards) as any,
        customInformation: currentProfile.customInformation || [],
        skills: pickNonEmpty(parsedData.skills, currentProfile.skills),
        certifications: currentProfile.certifications || [],
        resume: {
          fileName,
          fileData,
          fileType,
          parsedText: rawText,
          uploadDate: new Date().toISOString()
        }
      };

      const next = updateActiveUserProfile(library, updatedProfile, new Date().toISOString());
      await StorageService.saveResumeProfileLibrary(next);
    });
    const syncResult = await queueAutoSyncResult('resume-save');

    return {
      success: true,
      data: {
        parsedData,
        rawText,
        parseMethod,
        llmError,
        ...syncResult
      }
    };
  } catch (error) {
    console.error('Resume parsing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse resume'
    };
  }
}

// 获取简历数据
async function handleGetResumeData(): Promise<MessageResponse> {
  try {
    const profile = await StorageService.getUserProfile();
    return {
      success: true,
      data: profile?.resume || null
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get resume data'
    };
  }
}

// LLM 简历解析
async function parseResumeWithLLM(
  rawText: string,
  config: LLMConfig
): Promise<ParsedResumeData> {
  const llm = new LLMService(config);
  const { system, user } = buildResumeParsingPrompt(rawText);

  const result = await llm.chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);

  let jsonStr = result.content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr);

  return {
    personal: parsed.personal,
    education: (parsed.education || []).map((e: any, i: number) => ({
      id: `edu-${i}`, ...e
    })),
    experience: (parsed.experience || []).map((entry: any, i: number) => ({
      id: `exp-${i}`,
      company: entry.company || '',
      position: entry.position || '',
      startDate: entry.startDate || '',
      endDate: entry.endDate || '',
      description: entry.description || '',
    })),
    projects: (parsed.projects || []).map((entry: any, i: number) => ({
      id: `proj-${i}`,
      name: entry.name || '',
      role: entry.role || '',
      startDate: entry.startDate || '',
      endDate: entry.endDate || '',
      description: entry.description || '',
    })),
    awards: (parsed.awards || [])
      .filter((award: any) => award.name)
      .map((award: any, i: number) => ({
        id: `award-${i}`,
        name: award.name,
        role: award.role || '',
        date: award.date || '',
        description: award.description || '',
      })),
    skills: parsed.skills || [],
    rawText,
  };
}

// AI 生成开放性问题回答
async function handleGenerateAnswer(
  payload: { questionText: string; context?: string; fieldMaxLength?: number; language?: 'zh' | 'en' }
): Promise<MessageResponse> {
  try {
    const config = await StorageService.getLLMConfig();
    if (!config?.apiKey) {
      return { success: false, error: '请先在设置中配置AI服务' };
    }

    const profile = await StorageService.getUserProfile();
    if (!profile) {
      return { success: false, error: '请先填写个人信息' };
    }

    const llm = new LLMService(config);
    const { system, user } = buildAnswerGenerationPrompt(payload, profile);

    const result = await llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);

    return { success: true, data: { answer: result.content } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI生成失败',
    };
  }
}

// LLM 语义字段匹配
async function handleMatchFieldsLLM(
  payload: { fields: Array<{ index: number; name: string; id: string; placeholder: string; labelText: string; type: string }>; domain: string }
): Promise<MessageResponse> {
  try {
    const cacheKey = `fieldMatch_${payload.domain}`;
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) {
      const cachedResult = cached[cacheKey] as Record<string, string>;
      const allCovered = payload.fields.every(f => f.index.toString() in cachedResult);
      if (allCovered) {
        return { success: true, data: cachedResult };
      }
    }

    const config = await StorageService.getLLMConfig();
    if (!config?.apiKey) {
      return { success: false, error: 'LLM not configured' };
    }

    const llm = new LLMService(config);
    const { system, user } = buildFieldMatchingPrompt(payload.fields);

    const result = await llm.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);

    let jsonStr = result.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const mappings: Record<string, string> = JSON.parse(jsonStr);

    await chrome.storage.local.set({ [cacheKey]: mappings });

    return { success: true, data: mappings };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '字段匹配失败',
    };
  }
}

// 获取 LLM 配置
async function handleGetLLMConfig(): Promise<MessageResponse> {
  try {
    const config = await StorageService.getLLMConfig();
    return { success: true, data: config };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get LLM config',
    };
  }
}

// 保存 LLM 配置
async function handleSaveLLMConfig(config: LLMConfig): Promise<MessageResponse> {
  try {
    const success = await StorageService.saveLLMConfig(config);
    const sync = success ? await queueAutoSync('llm-save') : 'disabled';
    return {
      success,
      data: success ? { localSaved: true, sync } : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save LLM config',
    };
  }
}

function backupFilename(date = new Date()): string {
  const compact = date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `job-application-helper-backup-${compact}.json`;
}

async function handleExportBackup(): Promise<MessageResponse> {
  const [data, webdavConfig] = await Promise.all([
    StorageService.getBackupData(),
    StorageService.getWebDAVConfig(),
  ]);
  const document = createBackupDocument(
    data,
    chrome.runtime.getManifest().version,
    undefined,
    webdavConfig,
  );
  return {
    success: true,
    data: {
      json: serializeBackup(document),
      filename: backupFilename(),
    },
  };
}

function handlePreviewBackup(json: string): MessageResponse {
  const parsed = parseAndValidateBackup(json);
  if (!parsed.success) {
    return { success: false, error: `${parsed.error.code}: ${parsed.error.message}` };
  }
  return { success: true, data: createBackupSummary(parsed.document) };
}

async function handleImportBackup(json: string): Promise<MessageResponse> {
  const parsed = parseAndValidateBackup(json);
  if (!parsed.success) {
    return { success: false, error: `${parsed.error.code}: ${parsed.error.message}` };
  }
  // 备份里带 WebDAV 设置时一并恢复；旧备份没有该字段则保留当前配置。
  await StorageService.replaceBusinessData(parsed.document.data, parsed.document.webdavConfig);
  const sync = await queueAutoSync('backup-import');
  return {
    success: true,
    data: { imported: true, summary: createBackupSummary(parsed.document), sync },
  };
}

async function handleSaveWebDAVConfig(config: WebDAVConfig): Promise<MessageResponse> {
  const urlError = config.serverUrl.trim() ? validateWebDAVUrl(config.serverUrl) : null;
  if (config.enabled && !config.serverUrl.trim()) {
    return { success: false, error: '启用同步前请填写 WebDAV 服务器地址' };
  }
  if (urlError) return { success: false, error: urlError };
  await StorageService.saveWebDAVConfig({
    ...config,
    serverUrl: config.serverUrl.trim()
      ? normalizeWebDAVServerUrl(config.serverUrl)
      : '',
    username: config.username.trim(),
  });
  return { success: true };
}

async function handleTestWebDAV(config: WebDAVConfig): Promise<MessageResponse> {
  try {
    const result = await testWebDAVConnection(config);
    return {
      success: true,
      data: {
        exists: result.exists,
        message: result.exists ? '连接成功，已找到远端文件' : '连接成功，远端文件尚未创建',
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'WebDAV 连接测试失败',
    };
  }
}

// 测试 LLM 连接
// payload 为界面上当前填写的配置；缺省时回退到已保存的配置
async function handleTestConnection(payload?: LLMConfig | null): Promise<MessageResponse> {
  try {
    const config = payload ?? await StorageService.getLLMConfig();
    if (!config?.apiKey?.trim()) {
      return { success: false, error: '请先填写 API Key' };
    }
    if (!config.baseUrl?.trim()) {
      return { success: false, error: '请先填写 API 地址' };
    }
    if (!config.model?.trim()) {
      return { success: false, error: '请先填写模型名称' };
    }

    const llm = new LLMService(config);
    await llm.testConnection();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '连接测试失败',
    };
  }
}

// 监听安装事件
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details.reason);

  if (details.reason === 'install') {
    // 首次安装时打开选项页面
    chrome.runtime.openOptionsPage();
  }
});
