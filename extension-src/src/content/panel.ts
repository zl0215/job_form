// 网页内悬浮面板（vanilla TS + Shadow DOM，样式内联，不引入 React）。
// 面板只在顶层 frame 创建；扫描/填充/撤销全部通过 background 按 frame 路由，
// 因此点网页其它位置不会关闭面板，也不会丢失已勾选状态与填充结果。

import type {
  MessageResponse,
  PanelField,
  PanelFillSummary,
  PanelLayout,
  PanelScanResult,
  PanelSettings,
  PanelUndoResult,
} from '../shared/types.ts';
import {
  applyPanelFillResults,
  countPanelFields,
  defaultPanelSelection,
  formatPanelFillSummary,
  formatPanelUndoSummary,
  groupPanelFields,
  groupUnmatchedFields,
  isFieldSelectable,
  maskPanelValue,
  panelOutcomeDisplay,
  panelStatusLabel,
  panelUndoOutcomeDisplay,
  sectionSelectionState,
  selectSectionBlankFields,
  selectedFieldIdsInOrder,
  updateFieldSelection,
} from './panelSelection.ts';

export const PANEL_HOST_ID = 'jah-floating-panel-host';
export const PANEL_SETTINGS_STORAGE_KEY = 'jahPanelSettings';
export const PANEL_LAYOUT_STORAGE_KEY = 'jahPanelLayout';

export interface PanelApi {
  scan(): Promise<MessageResponse<PanelScanResult>>;
  fillSelected(
    fieldIds: string[],
    options: { allowAutoAddRows: boolean },
  ): Promise<MessageResponse<PanelFillSummary>>;
  undo(): Promise<MessageResponse<PanelUndoResult>>;
  openOptions(): void;
  openPopup(): void;
}

export interface PanelController {
  toggle(): { visible: boolean };
  show(): void;
  hide(): void;
  isVisible(): boolean;
  destroy(): void;
}

const DEFAULT_SETTINGS: PanelSettings = {
  allowAutoAddRows: false,
  maskSensitive: true,
};

const DEFAULT_LAYOUT: PanelLayout = { collapsed: false };

interface PanelState {
  visible: boolean;
  collapsed: boolean;
  scanning: boolean;
  filling: boolean;
  undoing: boolean;
  scan: PanelScanResult | null;
  error: string;
  notice: string;
  warning: string;
  selected: Set<string>;
  revealed: Set<string>;
  settings: PanelSettings;
  layout: PanelLayout;
  fillSummary: PanelFillSummary | null;
  undoSummary: PanelUndoResult | null;
  /** 最近一次填充是否仍可撤销（重扫不会清掉该标记，撤销成功后置 false）。 */
  undoAvailable: boolean;
}

const PANEL_STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.jah-panel {
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  overflow: hidden;
  border: 1px solid #a7f3d0;
  border-radius: 10px;
  background: #ffffff;
  color: #172033;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.22);
  font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.jah-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: linear-gradient(135deg, #10b981, #059669);
  color: #ffffff;
  cursor: move;
  user-select: none;
  touch-action: none;
}
.jah-title { font-size: 13px; font-weight: 600; flex: 1 1 auto; }
.jah-header-badge { font-size: 11px; background: rgba(255,255,255,.22); border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
.jah-icon-btn {
  flex: none; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 5px;
  background: rgba(255,255,255,.18); color: #fff; font-size: 14px; line-height: 1; cursor: pointer;
}
.jah-icon-btn:hover { background: rgba(255,255,255,.34); }
.jah-body { overflow-y: auto; padding: 8px 10px 6px; display: flex; flex-direction: column; gap: 8px; }
.jah-panel.jah-collapsed .jah-body, .jah-panel.jah-collapsed .jah-footer { display: none; }
.jah-status { color: #334155; font-size: 12px; }
.jah-status strong { color: #047857; }
.jah-hint { margin: 0; color: #64748b; font-size: 11px; }
.jah-error { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 6px 8px; font-size: 11px; white-space: pre-wrap; }
.jah-warning { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 8px; font-size: 11px; }
.jah-notice { color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 6px 8px; font-size: 11px; }
.jah-settings { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
.jah-setting { display: flex; align-items: flex-start; gap: 6px; font-size: 11px; color: #334155; cursor: pointer; }
.jah-setting input { margin: 2px 0 0; accent-color: #059669; }
.jah-progress { color: #047857; font-size: 11px; }
.jah-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.jah-mini-btn {
  border: 1px solid #cbd5e1; background: #ffffff; color: #334155; border-radius: 5px;
  padding: 2px 8px; font-size: 11px; cursor: pointer;
}
.jah-mini-btn:hover:not(:disabled) { border-color: #10b981; color: #047857; }
.jah-mini-btn:disabled { opacity: .5; cursor: not-allowed; }
.jah-selected-count { margin-left: auto; font-size: 11px; color: #047857; font-weight: 600; }
.jah-groups { display: flex; flex-direction: column; gap: 8px; }
.jah-group { border: 1px solid #e2e8f0; border-radius: 7px; overflow: hidden; }
.jah-group-head {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px;
  background: #ecfdf5; border-bottom: 1px solid #d1fae5; font-size: 11px;
}
.jah-group-head input { margin: 0; accent-color: #059669; }
.jah-group-name { font-weight: 600; color: #065f46; }
.jah-group-count { margin-left: auto; color: #64748b; font-size: 10px; }
.jah-rows { display: flex; flex-direction: column; }
.jah-row { display: flex; gap: 6px; padding: 5px 8px; border-top: 1px dashed #eef2f7; }
.jah-row:first-child { border-top: 0; }
.jah-row > input { margin: 2px 0 0; flex: none; accent-color: #059669; }
.jah-row-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.jah-row-head { display: flex; align-items: baseline; gap: 5px; }
.jah-row-label { font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
.jah-chip { flex: none; font-size: 10px; border-radius: 999px; padding: 0 6px; line-height: 16px; }
.jah-chip-blank { color: #047857; background: #d1fae5; }
.jah-chip-filled { color: #475569; background: #e2e8f0; }
.jah-chip-blocked { color: #b91c1c; background: #fee2e2; }
.jah-chip-ambiguous, .jah-chip-unmatched { color: #92400e; background: #fef3c7; }
.jah-outcome { margin-left: auto; flex: none; font-size: 10px; color: #047857; }
.jah-row-value { color: #0f172a; word-break: break-all; display: flex; align-items: baseline; gap: 5px; }
.jah-value { white-space: pre-wrap; }
.jah-value-masked { color: #64748b; letter-spacing: 1px; }
.jah-value-empty { color: #94a3b8; }
.jah-reveal {
  flex: none; border: 0; background: none; color: #2563eb; font-size: 10px;
  padding: 0; cursor: pointer; text-decoration: underline;
}
.jah-row-meta { color: #94a3b8; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jah-unmatched { border: 1px solid #f1f5f9; border-radius: 6px; background: #f8fafc; padding: 4px 8px; }
.jah-unmatched > summary { cursor: pointer; font-size: 11px; color: #475569; }
.jah-unmatched-list { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.jah-unmatched-item { font-size: 10px; color: #475569; border-top: 1px dashed #e2e8f0; padding-top: 3px; }
.jah-unmatched-item .jah-reason { color: #94a3b8; }
.jah-stats { font-size: 11px; color: #334155; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px 8px; }
.jah-stats-success { color: #065f46; background: #ecfdf5; border-color: #a7f3d0; }
.jah-footer {
  display: flex; flex-direction: column; gap: 5px; padding: 8px 10px;
  border-top: 1px solid #e2e8f0; background: #f8fafc;
}
.jah-footer-main { display: flex; gap: 6px; }
.jah-primary {
  flex: 1 1 auto; border: 1px solid #059669; background: #10b981; color: #ffffff;
  border-radius: 6px; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.jah-primary:hover:not(:disabled) { background: #059669; }
.jah-primary:disabled { opacity: .55; cursor: not-allowed; }
.jah-secondary {
  flex: none; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;
  border-radius: 6px; padding: 6px 9px; font-size: 11px; cursor: pointer;
}
.jah-secondary:hover:not(:disabled) { border-color: #10b981; color: #047857; }
.jah-secondary:disabled { opacity: .5; cursor: not-allowed; }
.jah-footer-links { display: flex; gap: 10px; align-items: center; }
.jah-link { border: 0; background: none; color: #2563eb; font-size: 11px; padding: 0; cursor: pointer; text-decoration: underline; }
.jah-footer-hint { margin-left: auto; font-size: 10px; color: #94a3b8; }
`;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createButton(className: string, text: string, action: string): HTMLButtonElement {
  const button = element('button', className, text) as HTMLButtonElement;
  button.type = 'button';
  button.dataset.action = action;
  return button;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function createPanel(api: PanelApi): PanelController {
  const doc = document;
  const state: PanelState = {
    visible: false,
    collapsed: DEFAULT_LAYOUT.collapsed,
    scanning: false,
    filling: false,
    undoing: false,
    scan: null,
    error: '',
    notice: '',
    warning: '',
    selected: new Set<string>(),
    revealed: new Set<string>(),
    settings: { ...DEFAULT_SETTINGS },
    layout: { ...DEFAULT_LAYOUT },
    fillSummary: null,
    undoSummary: null,
    undoAvailable: false,
  };

  const host = doc.createElement('div');
  host.id = PANEL_HOST_ID;
  host.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'right:16px',
    'bottom:16px',
    'width:min(340px, calc(100vw - 24px))',
    'display:none',
  ].join(';');
  const shadow = host.attachShadow({ mode: 'open' });
  const styleNode = element('style');
  styleNode.textContent = PANEL_STYLE;
  shadow.appendChild(styleNode);

  const root = element('div', 'jah-panel');
  shadow.appendChild(root);

  // —— 静态骨架 ——
  const header = element('div', 'jah-header');
  const title = element('span', 'jah-title', '校招表单助手');
  const headerBadge = element('span', 'jah-header-badge', '面板');
  const collapseButton = createButton('jah-icon-btn', '–', 'collapse');
  collapseButton.setAttribute('aria-label', '折叠面板');
  collapseButton.title = '折叠 / 展开';
  const closeButton = createButton('jah-icon-btn', '×', 'close');
  closeButton.setAttribute('aria-label', '关闭面板');
  closeButton.title = '关闭（Esc）';
  header.append(title, headerBadge, collapseButton, closeButton);

  const body = element('div', 'jah-body');
  const statusLine = element('div', 'jah-status');
  const errorLine = element('div', 'jah-error');
  errorLine.hidden = true;
  const warningLine = element('div', 'jah-warning');
  warningLine.hidden = true;
  const noticeLine = element('div', 'jah-notice');
  noticeLine.hidden = true;

  const settingsBox = element('div', 'jah-settings');
  const autoAddLabel = element('label', 'jah-setting');
  const autoAddInput = element('input') as HTMLInputElement;
  autoAddInput.type = 'checkbox';
  autoAddInput.dataset.setting = 'allowAutoAddRows';
  const autoAddText = element(
    'span',
    '',
    '自动补齐经历行（会点击页面“添加”，默认关闭；仅少数需要新区间的站点使用）',
  );
  autoAddLabel.append(autoAddInput, autoAddText);
  const maskLabel = element('label', 'jah-setting');
  const maskInput = element('input') as HTMLInputElement;
  maskInput.type = 'checkbox';
  maskInput.dataset.setting = 'maskSensitive';
  const maskText = element('span', '', '敏感信息遮罩（手机号/身份证等默认显示为 ••••）');
  maskLabel.append(maskInput, maskText);
  const safetyHint = element(
    'p',
    'jah-hint',
    '安全模式：只填勾选字段、只写空白项；扩展不会主动刷新、提交表单或勾选承诺。',
  );
  settingsBox.append(autoAddLabel, maskLabel, safetyHint);

  const progressLine = element('div', 'jah-progress', '正在扫描本页字段…');
  progressLine.hidden = true;

  const toolbar = element('div', 'jah-toolbar');
  const selectAllButton = createButton('jah-mini-btn', '全选空白', 'select-all');
  const clearButton = createButton('jah-mini-btn', '全不选', 'clear-selection');
  const selectedCount = element('span', 'jah-selected-count', '已选 0');
  toolbar.append(selectAllButton, clearButton, selectedCount);

  const groupsBox = element('div', 'jah-groups');

  const unmatchedBox = element('details', 'jah-unmatched') as HTMLDetailsElement;
  const unmatchedSummary = element('summary', '', '未识别字段');
  const unmatchedHint = element(
    'p',
    'jah-hint',
    '可在「更多」打开的扩展页面里用“本页字段对照”记住这些字段，下次自动填写。',
  );
  const unmatchedList = element('div', 'jah-unmatched-list');
  unmatchedBox.append(unmatchedSummary, unmatchedHint, unmatchedList);
  unmatchedBox.hidden = true;

  const fillStats = element('div', 'jah-stats');
  fillStats.hidden = true;
  const undoStats = element('div', 'jah-stats');
  undoStats.hidden = true;

  body.append(
    statusLine,
    errorLine,
    warningLine,
    noticeLine,
    settingsBox,
    progressLine,
    toolbar,
    groupsBox,
    unmatchedBox,
    fillStats,
    undoStats,
  );

  const footer = element('div', 'jah-footer');
  const footerMain = element('div', 'jah-footer-main');
  const fillButton = createButton('jah-primary', '填充勾选(0)', 'fill');
  const undoButton = createButton('jah-secondary', '撤销本次填充', 'undo');
  undoButton.disabled = true;
  const rescanButton = createButton('jah-secondary', '重新扫描', 'rescan');
  footerMain.append(fillButton, undoButton, rescanButton);
  const footerLinks = element('div', 'jah-footer-links');
  const optionsLink = createButton('jah-link', '设置', 'options');
  const popupLink = createButton('jah-link', '更多', 'popup');
  const footerHint = element('span', 'jah-footer-hint', '本页面板 · 点击图标开关');
  footerLinks.append(optionsLink, popupLink, footerHint);
  footer.append(footerMain, footerLinks);

  root.append(header, body, footer);

  // —— 持久化 ——
  async function loadSettings(): Promise<PanelSettings> {
    try {
      const stored = await chrome.storage.local.get(PANEL_SETTINGS_STORAGE_KEY);
      const value = stored?.[PANEL_SETTINGS_STORAGE_KEY] as Partial<PanelSettings> | undefined;
      return {
        allowAutoAddRows: value?.allowAutoAddRows === true,
        maskSensitive: value?.maskSensitive !== false,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async function saveSettings(): Promise<void> {
    try {
      await chrome.storage.local.set({ [PANEL_SETTINGS_STORAGE_KEY]: { ...state.settings } });
    } catch {
      // 存储不可用时仍允许本次会话内使用开关。
    }
  }

  async function loadLayout(): Promise<PanelLayout> {
    try {
      const stored = await chrome.storage.local.get(PANEL_LAYOUT_STORAGE_KEY);
      const value = stored?.[PANEL_LAYOUT_STORAGE_KEY] as Partial<PanelLayout> | undefined;
      return {
        left: typeof value?.left === 'number' ? value.left : undefined,
        top: typeof value?.top === 'number' ? value.top : undefined,
        collapsed: value?.collapsed === true,
      };
    } catch {
      return { ...DEFAULT_LAYOUT };
    }
  }

  async function saveLayout(): Promise<void> {
    const left = Number.parseFloat(host.style.left);
    const top = Number.parseFloat(host.style.top);
    state.layout = {
      left: Number.isFinite(left) ? Math.round(left) : state.layout.left,
      top: Number.isFinite(top) ? Math.round(top) : state.layout.top,
      collapsed: state.collapsed,
    };
    try {
      await chrome.storage.local.set({ [PANEL_LAYOUT_STORAGE_KEY]: { ...state.layout } });
    } catch {
      // ignore
    }
  }

  function applyLayout(): void {
    root.classList.toggle('jah-collapsed', state.collapsed);
    collapseButton.textContent = state.collapsed ? '+' : '–';
    collapseButton.title = state.collapsed ? '展开面板' : '折叠面板';
    if (typeof state.layout.left === 'number' && typeof state.layout.top === 'number') {
      const panelWidth = host.offsetWidth || Math.min(340, window.innerWidth - 24);
      const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - 48);
      host.style.left = `${clampNumber(state.layout.left, 8, maxLeft)}px`;
      host.style.top = `${clampNumber(state.layout.top, 8, maxTop)}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    }
  }

  function toggleCollapsed(): void {
    state.collapsed = !state.collapsed;
    state.layout.collapsed = state.collapsed;
    applyLayout();
    void saveLayout();
  }

  // —— 动作 ——
  async function runScan(): Promise<void> {
    if (state.scanning) return;
    state.scanning = true;
    state.error = '';
    state.notice = '';
    renderAll();
    try {
      const response = await api.scan();
      if (!response.success || !response.data) {
        state.error = response.error || '扫描本页字段失败';
        state.scan = null;
        state.selected = new Set();
      } else {
        state.scan = response.data;
        state.selected = defaultPanelSelection(response.data.fields);
        state.revealed = new Set();
        state.fillSummary = null;
        state.undoSummary = null;
        state.warning = '';
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : '扫描本页字段失败';
      state.scan = null;
    } finally {
      state.scanning = false;
      renderAll();
    }
  }

  async function runFill(): Promise<void> {
    if (state.filling || state.scanning) return;
    const fieldIds = state.scan
      ? selectedFieldIdsInOrder(state.scan.fields, state.selected)
      : [];
    if (fieldIds.length === 0) return;

    state.filling = true;
    state.error = '';
    state.notice = '';
    state.warning = '';
    renderAll();
    try {
      const response = await api.fillSelected(fieldIds, {
        allowAutoAddRows: state.settings.allowAutoAddRows,
      });
      if (!response.success || !response.data) {
        state.error = response.error || '填充所选字段失败';
      } else {
        const summary = response.data;
        state.fillSummary = summary;
        state.undoSummary = null;
        state.undoAvailable = summary.undoAvailable;
        if (state.scan) {
          state.scan = {
            ...state.scan,
            fields: applyPanelFillResults(state.scan.fields, summary.results),
          };
          // 已填字段不再保持勾选；其余空白字段保留用户勾选。
          const stillSelected = new Set<string>();
          for (const field of state.scan.fields) {
            if (state.selected.has(field.id) && isFieldSelectable(field)) stillSelected.add(field.id);
          }
          state.selected = stillSelected;
        }
        if (summary.urlChanged) {
          state.warning = '检测到页面跳转/刷新，本次填充可能被站点打断。扩展不会主动刷新或提交页面，请刷新后重新扫描确认。';
          console.warn('[校招表单助手] 面板填充期间检测到页面地址变化（未输出任何个人资料值）');
        }
        const failedFrames = summary.frames.filter(frame => frame.error);
        if (failedFrames.length > 0) {
          const frameText = `有 ${failedFrames.length} 个嵌入页面未响应（frame ${failedFrames.map(frame => frame.frameId).join('、')}），这些页面里的字段未填。`;
          state.warning = state.warning ? `${state.warning} ${frameText}` : frameText;
        }
        if (summary.autoAddedRows > 0) {
          state.notice = `已自动补齐 ${summary.autoAddedRows} 行经历，可点“重新扫描”勾选新增字段。`;
        }
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : '填充所选字段失败';
    } finally {
      state.filling = false;
      renderAll();
    }
  }

  async function runUndo(): Promise<void> {
    if (state.undoing || state.filling) return;
    state.undoing = true;
    state.error = '';
    renderAll();
    try {
      const response = await api.undo();
      if (!response.success || !response.data) {
        state.error = response.error || '撤销填充失败';
      } else {
        state.undoSummary = response.data;
        state.fillSummary = null;
        state.undoAvailable = false;
        state.warning = '';
        state.notice = formatPanelUndoSummary(response.data);
        if (response.data.skipped > 0 || response.data.failed > 0) {
          state.notice += '（自定义下拉框或页面重渲染的控件无法安全撤销，请手动检查）';
        }
        await refreshAfterUndo();
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : '撤销填充失败';
    } finally {
      state.undoing = false;
      renderAll();
    }
  }

  /** 撤销后静默重扫：让面板状态回到页面真实值，保留撤销统计提示。 */
  async function refreshAfterUndo(): Promise<void> {
    const notice = state.notice;
    const undoSummary = state.undoSummary;
    try {
      const response = await api.scan();
      if (response.success && response.data) {
        state.scan = response.data;
        state.selected = defaultPanelSelection(response.data.fields);
        state.revealed = new Set();
        state.fillSummary = null;
      }
    } catch {
      // 重扫失败不覆盖撤销结果提示。
    } finally {
      state.notice = notice;
      state.undoSummary = undoSummary;
    }
  }

  // —— 渲染 ——
  function renderAll(): void {
    host.style.display = state.visible ? 'block' : 'none';
    root.classList.toggle('jah-collapsed', state.collapsed);
    autoAddInput.checked = state.settings.allowAutoAddRows;
    maskInput.checked = state.settings.maskSensitive;
    progressLine.hidden = !state.scanning;
    errorLine.hidden = !state.error;
    errorLine.textContent = state.error;
    warningLine.hidden = !state.warning;
    warningLine.textContent = state.warning;
    noticeLine.hidden = !state.notice;
    noticeLine.textContent = state.notice;
    renderStatus();
    renderGroups();
    renderUnmatched();
    renderStats();
    renderFooter();
  }

  function renderStatus(): void {
    if (!state.scan) {
      statusLine.textContent = state.scanning ? '正在扫描本页字段…' : '点击页面工具栏图标可开关本面板。';
      headerBadge.textContent = '面板';
      return;
    }
    const counts = countPanelFields(state.scan.fields);
    const unmatchedTotal = state.scan.unmatched.length;
    statusLine.replaceChildren();
    const parts = [
      `共 ${counts.total} 个字段`,
      `空白可填 ${counts.selectable}`,
      `已有内容 ${counts.filled}`,
      `禁止 ${state.scan.blockedCount}`,
      `未识别 ${unmatchedTotal}`,
    ];
    if (state.scan.detected === 0) {
      parts.length = 0;
      parts.push('本页未检测到可填写字段；请确认页面已打开并已加载表单。');
    }
    for (const text of parts) {
      if (statusLine.childNodes.length > 0) statusLine.append(doc.createTextNode(' · '));
      statusLine.append(doc.createTextNode(text));
    }
    const selectedCountValue = state.selected.size;
    headerBadge.textContent = selectedCountValue > 0 ? `已选 ${selectedCountValue}` : `${counts.selectable} 可填`;
  }

  function renderGroups(): void {
    groupsBox.replaceChildren();
    if (!state.scan || state.scan.fields.length === 0) return;
    const groups = groupPanelFields(state.scan.fields);
    for (const group of groups) {
      const sectionEl = element('section', 'jah-group');
      const head = element('div', 'jah-group-head');
      const sectionCheck = element('input') as HTMLInputElement;
      sectionCheck.type = 'checkbox';
      sectionCheck.dataset.section = group.section;
      const selectionState = sectionSelectionState(
        state.scan.fields,
        group.section,
        state.selected,
      );
      sectionCheck.checked = selectionState === 'all';
      sectionCheck.indeterminate = selectionState === 'partial';
      sectionCheck.disabled = group.selectableCount === 0;
      sectionCheck.setAttribute('aria-label', `${group.sectionName}全选空白字段`);
      const name = element('span', 'jah-group-name', group.sectionName);
      const count = element(
        'span',
        'jah-group-count',
        `可填 ${group.selectableCount} / 共 ${group.fields.length}`,
      );
      head.append(sectionCheck, name, count);
      sectionEl.appendChild(head);

      const rows = element('div', 'jah-rows');
      for (const field of group.fields) rows.appendChild(renderFieldRow(field));
      sectionEl.appendChild(rows);
      groupsBox.appendChild(sectionEl);
    }
  }

  function renderFieldRow(field: PanelField): HTMLElement {
    const row = element('div', 'jah-row');
    const checkbox = element('input') as HTMLInputElement;
    checkbox.type = 'checkbox';
    checkbox.dataset.field = field.id;
    checkbox.checked = state.selected.has(field.id);
    checkbox.disabled = !isFieldSelectable(field);
    checkbox.setAttribute('aria-label', `选择字段 ${field.label || '未命名字段'}`);
    row.appendChild(checkbox);

    const main = element('div', 'jah-row-main');
    const head = element('div', 'jah-row-head');
    const label = element('span', 'jah-row-label', field.label || '未命名字段');
    label.title = field.label || '';
    const chip = element(
      'span',
      `jah-chip jah-chip-${field.status}`,
      panelStatusLabel(field.status),
    );
    head.append(label, chip);

    const fillResult = state.fillSummary?.results.find(result => result.fieldId === field.id);
    if (fillResult) {
      const display = panelOutcomeDisplay(fillResult.outcome);
      const outcome = element('span', 'jah-outcome', `${display.icon} ${display.label}`);
      if (fillResult.message) outcome.title = fillResult.message;
      head.append(outcome);
    } else if (state.undoSummary) {
      const undoEntry = state.undoSummary.entries.find(item => item.fieldId === field.id);
      if (undoEntry) {
        const display = panelUndoOutcomeDisplay(undoEntry.outcome);
        const outcome = element('span', 'jah-outcome', `${display.icon} ${display.label}`);
        if (undoEntry.message) outcome.title = undoEntry.message;
        head.append(outcome);
      }
    }
    main.appendChild(head);

    const valueRow = element('div', 'jah-row-value');
    const hasValue = Boolean((field.plannedValue || '').trim());
    if (field.status !== 'blank' || !hasValue) {
      const empty = field.status === 'filled'
        ? '已有内容，不会覆盖'
        : field.status === 'blocked'
          ? '禁止字段，永不填写'
          : field.status === 'ambiguous'
            ? '候选冲突，无法唯一确定，不会填写'
            : field.status === 'unmatched'
              ? '没有可填的计划值'
              : '没有可填的计划值';
      valueRow.appendChild(element('span', 'jah-value-empty', `— ${empty}`));
    } else {
      const revealed = state.revealed.has(field.id);
      const masked = field.sensitive && state.settings.maskSensitive && !revealed;
      const displayValue = maskPanelValue(field.plannedValue, field.sensitive, masked);
      const valueEl = element(
        'span',
        masked ? 'jah-value jah-value-masked' : 'jah-value',
        truncateDisplay(displayValue),
      );
      valueRow.appendChild(valueEl);
      if (field.sensitive && state.settings.maskSensitive) {
        const revealButton = createButton('jah-reveal', revealed ? '隐藏' : '显示', 'reveal');
        revealButton.dataset.field = field.id;
        valueRow.appendChild(revealButton);
      }
    }
    main.appendChild(valueRow);

    const metaParts: string[] = [];
    if (field.profileLabel) metaParts.push(`资料字段：${field.profileLabel}`);
    if (field.type) metaParts.push(field.type);
    if (field.frameId !== 0) metaParts.push(`嵌入页 #${field.frameId}`);
    if (metaParts.length > 0) main.appendChild(element('div', 'jah-row-meta', metaParts.join(' · ')));

    row.appendChild(main);
    return row;
  }

  function truncateDisplay(value: string): string {
    const flat = (value || '').replace(/\s+/g, ' ').trim();
    if (flat.length <= 80) return flat;
    return `${flat.slice(0, 79)}…`;
  }

  function renderUnmatched(): void {
    const unmatched = state.scan?.unmatched || [];
    unmatchedBox.hidden = unmatched.length === 0;
    unmatchedSummary.textContent = `未识别字段（${unmatched.length}）`;
    unmatchedList.replaceChildren();
    const groups = groupUnmatchedFields(unmatched);
    for (const group of groups) {
      for (const item of group.fields) {
        const itemEl = element('div', 'jah-unmatched-item');
        const label = element('span', '', `${group.sectionName} · ${item.label || '未命名字段'}`);
        const reason = element('span', 'jah-reason', `（${item.reason || '未识别'}）`);
        itemEl.append(label, reason);
        unmatchedList.appendChild(itemEl);
      }
    }
  }

  function renderStats(): void {
    if (state.fillSummary) {
      fillStats.hidden = false;
      fillStats.className = state.fillSummary.filled > 0 ? 'jah-stats jah-stats-success' : 'jah-stats';
      fillStats.textContent = formatPanelFillSummary(state.fillSummary);
    } else {
      fillStats.hidden = true;
      fillStats.textContent = '';
    }
    if (state.undoSummary) {
      undoStats.hidden = false;
      undoStats.textContent = formatPanelUndoSummary(state.undoSummary);
    } else {
      undoStats.hidden = true;
      undoStats.textContent = '';
    }
  }

  function renderFooter(): void {
    const selectableSelected = state.scan
      ? state.scan.fields.filter(field => state.selected.has(field.id) && isFieldSelectable(field)).length
      : 0;
    selectedCount.textContent = `已选 ${selectableSelected}`;
    selectAllButton.disabled = !state.scan || state.scanning;
    clearButton.disabled = state.selected.size === 0;
    fillButton.disabled = selectableSelected === 0 || state.filling || state.scanning;
    fillButton.textContent = state.filling
      ? '正在填充…'
      : `填充勾选(${selectableSelected})`;
    undoButton.disabled = !state.undoAvailable || state.undoing || state.filling;
    undoButton.textContent = state.undoing ? '正在撤销…' : '撤销本次填充';
    rescanButton.disabled = state.scanning || state.filling || state.undoing;
    rescanButton.textContent = state.scanning ? '扫描中…' : '重新扫描';
  }

  // —— 事件 ——
  shadow.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    if (target.dataset.setting === 'allowAutoAddRows') {
      state.settings.allowAutoAddRows = target.checked;
      void saveSettings();
      renderFooter();
      return;
    }
    if (target.dataset.setting === 'maskSensitive') {
      state.settings.maskSensitive = target.checked;
      void saveSettings();
      renderAll();
      return;
    }
    if (target.dataset.section && state.scan) {
      const section = target.dataset.section as PanelField['section'];
      const blankIds = selectSectionBlankFields(state.scan.fields, section);
      const sectionFieldIds = new Set(
        state.scan.fields.filter(field => field.section === section).map(field => field.id),
      );
      if (target.checked) {
        state.selected = new Set([...state.selected, ...blankIds]);
      } else {
        state.selected = new Set(
          [...state.selected].filter(fieldId => !sectionFieldIds.has(fieldId)),
        );
      }
      renderAll();
      return;
    }
    if (target.dataset.field) {
      state.selected = updateFieldSelection(state.selected, target.dataset.field, target.checked);
      renderAll();
    }
  });

  shadow.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      'button, summary',
    );
    if (!target) return;
    if (target.dataset.field && target.dataset.action === 'reveal') {
      const fieldId = target.dataset.field;
      if (state.revealed.has(fieldId)) state.revealed.delete(fieldId);
      else state.revealed.add(fieldId);
      renderGroups();
      return;
    }
    switch (target.dataset.action) {
      case 'collapse':
        toggleCollapsed();
        return;
      case 'close':
        hide();
        return;
      case 'select-all':
        if (state.scan) {
          state.selected = defaultPanelSelection(state.scan.fields);
          renderAll();
        }
        return;
      case 'clear-selection':
        state.selected = new Set();
        renderAll();
        return;
      case 'rescan':
        void runScan();
        return;
      case 'fill':
        void runFill();
        return;
      case 'undo':
        void runUndo();
        return;
      case 'options':
        api.openOptions();
        return;
      case 'popup':
        api.openPopup();
        return;
      default:
        return;
    }
  });

  // 面板内交互不向页面冒泡，避免触发页面点击/快捷键逻辑；页面点击其它位置也不会关闭面板。
  host.addEventListener('click', (event) => event.stopPropagation());
  host.addEventListener('keydown', (event) => event.stopPropagation());

  // —— 拖拽 ——
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;

  header.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    const rect = host.getBoundingClientRect();
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartLeft = rect.left;
    dragStartTop = rect.top;
    header.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  // —— Esc 关闭 ——
  function handleKeydown(event: KeyboardEvent): void {
    if (!state.visible) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  }
  doc.addEventListener('keydown', handleKeydown, true);

  // —— 生命周期 ——
  function isVisible(): boolean {
    return state.visible;
  }

  function show(): void {
    if (state.visible) return;
    state.visible = true;
    applyLayout();
    renderAll();
    if (!state.scan && !state.scanning) {
      void runScan();
    } else if (state.scan && state.fillSummary === null && state.undoSummary === null) {
      // 重新打开时刷新一次，避免显示过期字段状态（填充结果/撤销提示仍以已有数据为准）。
      void runScan();
    }
  }

  function hide(): void {
    state.visible = false;
    renderAll();
  }

  function toggle(): { visible: boolean } {
    if (state.visible) hide();
    else show();
    return { visible: state.visible };
  }

  function destroy(): void {
    doc.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('resize', onWindowResize);
    host.remove();
  }

  // 命名引用便于 destroy 时解绑（window 监听不阻止垃圾回收，但面板热重载/重复初始化时应清理）。
  function onWindowPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const width = host.offsetWidth || 320;
    const left = clampNumber(dragStartLeft + (event.clientX - dragStartX), 8, window.innerWidth - width - 8);
    const top = clampNumber(dragStartTop + (event.clientY - dragStartY), 8, window.innerHeight - 48);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  }

  function onWindowPointerUp(): void {
    if (!dragging) return;
    dragging = false;
    void saveLayout();
  }

  function onWindowResize(): void {
    if (typeof state.layout.left !== 'number' || typeof state.layout.top !== 'number') return;
    applyLayout();
  }

  // 命名函数注册 window 监听，destroy 时可解绑。
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('resize', onWindowResize);

  // 初始：读取设置/布局后挂载（隐藏状态）。
  void (async () => {
    const [settings, layout] = await Promise.all([loadSettings(), loadLayout()]);
    state.settings = settings;
    state.layout = layout;
    state.collapsed = layout.collapsed;
    applyLayout();
    renderAll();
  })();

  const mountTarget = doc.body || doc.documentElement;
  mountTarget.appendChild(host);

  return { toggle, show, hide, isVisible, destroy };
}
