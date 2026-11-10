import { FormDetector } from './formDetector';
import { FormFiller, type FillSection, type FormFillResult, type FillPlanField } from './formFiller';
import { collectFormControls } from './domControls.ts';
import { OpenQuestionDetector } from './openQuestionDetector';
import { groupPageScanFields, type PageScanField, type PageScanSection } from './pageScan';
import { extractApplicationPageMetadata } from './applicationRecordMetadata.ts';
import { createVisualRegionFillController } from './visualRegionFill.ts';
import { createPanel, PANEL_HOST_ID } from './panel.ts';
import { FieldMatcher } from '../utils/fieldMatcher';
import { matchBlockedField } from '../shared/blockedFields.ts';
import { isControlBlank, type FillControl } from './controlState.ts';
import type {
  DetectedField,
  FocusedFieldWriteResult,
  Message,
  MessageResponse,
  PageFieldReportItem,
  PageFrameFieldReport,
  PanelField,
  PanelFieldStatus,
  PanelFillOutcome,
  PanelFillSummary,
  PanelFrameFillResult,
  PanelFrameScan,
  PanelFrameUndoResult,
  PanelScanResult,
  PanelSection,
  PanelUndoResult,
  UserProfile,
} from '../shared/types';
import { FieldType } from '../shared/types';
import { buildProfileAnswerCandidates } from '../shared/profileAnswerCandidates.ts';
import { suggestLearnedAlias } from '../shared/fieldLearning.ts';

type ContentScriptRuntime = typeof globalThis & {
  __JOB_APPLICATION_HELPER_CONTENT_LOADED__?: boolean;
};

const contentScriptRuntime = globalThis as ContentScriptRuntime;
if (!contentScriptRuntime.__JOB_APPLICATION_HELPER_CONTENT_LOADED__) {
  contentScriptRuntime.__JOB_APPLICATION_HELPER_CONTENT_LOADED__ = true;
  initializeContentScript();
}

function initializeContentScript(): void {

async function sendRuntimeMessage<T = any>(message: Message): Promise<MessageResponse<T>> {
  try {
    return await chrome.runtime.sendMessage(message) as MessageResponse<T>;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

console.log('Content script loaded');

// 初始化
const formDetector = new FormDetector();
const formFiller = new FormFiller();
const visualRegionFillController = createVisualRegionFillController({
  sendRuntimeMessage,
  fillElementValues: (values, shouldContinue) => formFiller.fillElementValues(
    values as Parameters<FormFiller['fillElementValues']>[0],
    shouldContinue,
  ),
});

// v1.1：网页内悬浮面板只在顶层 frame 渲染；子 frame 只提供扫描/填充/撤销能力。
const floatingPanel = window === window.top
  ? createPanel({
    scan: () => sendRuntimeMessage<PanelScanResult>({ type: 'PANEL_SCAN' }),
    fillSelected: (fieldIds, options) => sendRuntimeMessage<PanelFillSummary>({
      type: 'PANEL_FILL_SELECTED',
      payload: { fieldIds, options: { allowAutoAddRows: options.allowAutoAddRows } },
    }),
    undo: () => sendRuntimeMessage<PanelUndoResult>({ type: 'PANEL_UNDO' }),
    openOptions: () => {
      void sendRuntimeMessage({ type: 'PANEL_OPEN_OPTIONS' });
    },
    openPopup: () => {
      void sendRuntimeMessage({ type: 'PANEL_OPEN_POPUP' });
    },
  })
  : null;

// 面板本 frame 的字段注册表：localId -> 元素 + 指纹（页面重渲染后按指纹找回）。
let panelScanRegistry = new Map<string, { element: FillControl; fingerprint: string }>();
// 本次面板填充写入的元素 -> localId（撤销结果映射回面板行）。
let panelFillLocalIds = new Map<FillControl, string>();

let detectedFields: DetectedField[] = [];
let lastFocusedControl:
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement
  | null = null;

/** 面板自身注入的控件（Shadow DOM 内）不得被当作页面字段/焦点目标。 */
function isFloatingPanelControl(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  try {
    const root = target.getRootNode();
    return root instanceof ShadowRoot && (root.host as HTMLElement | null)?.id === PANEL_HOST_ID;
  } catch {
    return false;
  }
}

document.addEventListener('focusin', (event) => {
  const target = event.target;
  if (isFloatingPanelControl(target)) return;
  if (isWritableControl(target)) {
    lastFocusedControl = target;
  }
}, true);

function isWritableControl(
  target: EventTarget | null
): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLTextAreaElement) &&
    !(target instanceof HTMLSelectElement)
  ) {
    return false;
  }
  if (target.disabled) return false;

  if (target instanceof HTMLInputElement) {
    const unsupportedTypes = new Set([
      'hidden',
      'file',
      'button',
      'submit',
      'reset',
      'image',
    ]);
    if (unsupportedTypes.has(target.type.toLowerCase())) return false;
    if (target.readOnly) {
      return isCustomSelectInput(target);
    }
  }

  if (target instanceof HTMLTextAreaElement && target.readOnly) return false;
  return true;
}

function isCustomSelectInput(element: HTMLInputElement): boolean {
  if (element.getAttribute('role') === 'combobox') return true;
  return Boolean(element.closest(
    '.ud__select, .ant-select, .el-select, .arco-select, .semi-select, [class*="select" i], [class*="picker" i]',
  ));
}

async function applyValueToFocusedControl(value: string): Promise<FocusedFieldWriteResult> {
  if (!lastFocusedControl) {
    return { written: false, reason: 'NO_FOCUSED_FIELD' };
  }
  if (!lastFocusedControl.isConnected) {
    lastFocusedControl = null;
    return { written: false, reason: 'FIELD_DETACHED' };
  }
  if (!isWritableControl(lastFocusedControl)) {
    return { written: false, reason: 'FIELD_NOT_WRITABLE' };
  }

  const written = await formFiller.fillFocusedControl(lastFocusedControl, value);
  return written
    ? { written: true }
    : { written: false, reason: 'VALUE_REJECTED' };
}

// 页面加载完成后检测表单
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDetection);
} else {
  initializeDetection();
}

function initializeDetection() {
  // 延迟检测，等待动态内容加载
  setTimeout(() => {
    detectedFields = formDetector.detectFields();
  }, 1000);

  // 开始监听 DOM 变化
  formDetector.startObserving((fields) => {
    detectedFields = fields;
    if (fields.length > 0) {
      console.log(`Re-detected ${fields.length} fields`);
    }
  });
}

// 处理填充按钮点击
async function handleFillButtonClick() {
  return fillSection('all');
}

// AI 入口已按合规要求关闭：实现保留供以后重新评估后复用（当前故意不调用）。
// oxlint-disable-next-line no-unused-vars
async function handleAIPageFill() {
  const status = showAIRegionStatus('正在扫描整页表单...');
  const requestId = crypto.randomUUID();
  let cancelled = false;

  status.setCancelHandler(async () => {
    if (cancelled) return;
    cancelled = true;
    status.update('正在终止 AI 扫描填充...');
    await sendRuntimeMessage({
      type: 'CANCEL_AI_FILL',
      payload: { requestId },
    });
    status.update('AI 扫描填充已终止', 'warning');
  });

  try {
    const response = await sendRuntimeMessage<UserProfile>({
      type: 'GET_USER_PROFILE',
    });
    if (!response.success || !response.data) {
      throw new Error('请先在插件选项页面中设置个人信息');
    }

    await formFiller.prepareDynamicSections(response.data, 'all');
    detectedFields = formDetector.detectFields({
      candidates: buildProfileAnswerCandidates(response.data, response.data.fieldAliasOverrides),
    });
    const scannedFields = collectPageScanFields();
    if (scannedFields.length === 0) {
      const skippedChoices = countSkippedChoiceGroups();
      status.update(
        skippedChoices
          ? `没有可自动填写的输入框；${skippedChoices} 组选项请手动选择`
          : '未检测到可扫描的空白表单字段',
        'warning',
      );
      return;
    }

    const groups = groupPageScanFields(scannedFields);
    const fieldsByIndex = new Map(scannedFields.map(field => [field.index, field]));
    let filledCount = 0;

    for (const group of groups) {
      if (cancelled) return;
      const fields = group.fields
        .map(field => fieldsByIndex.get(field.index))
        .filter((field): field is ScannedPageField => Boolean(field));
      if (fields.length === 0) continue;

      status.update(`AI 正在扫描${getPageSectionName(group.section)}：${fields.length} 个字段...`);
      filledCount += await fillPageScanGroup(
        group.section,
        fields,
        requestId,
        () => !cancelled,
      );
    }

    if (cancelled) return;

    const fileInputs = formDetector.findFileInputs();
    if (fileInputs.length > 0 && response.data.resume) {
      for (const fileInput of fileInputs) {
        if (fileInput.files && fileInput.files.length > 0) continue;
        await formFiller.uploadResume(
          fileInput,
          response.data.resume.fileData,
          response.data.resume.fileName,
        );
      }
    }

    const skippedChoices = countSkippedChoiceGroups();
    status.update(
      `AI 扫描填充完成：已填 ${filledCount} 项${skippedChoices ? `，${skippedChoices} 组选项请手动选择` : ''}`,
      filledCount > 0 ? 'success' : 'warning',
    );
  } catch (error) {
    if (cancelled) return;
    console.error('AI page scan fill failed:', error);
    status.update(
      `AI 扫描填充失败：${error instanceof Error ? error.message : '未知错误'}`,
      'error',
    );
  }
}

async function fillSection(section: FillSection): Promise<FormFillResult> {
  const hrefBefore = window.location.href;
  try {
    // 获取用户资料
    const response = await sendRuntimeMessage<UserProfile>({
      type: 'GET_USER_PROFILE'
    });

    if (!response.success || !response.data) {
      alert('请先在插件选项页面中设置个人信息！');
      return { detected: 0, attempted: 0, filled: 0, failed: 0 };
    }

    // 先补足需要点击“添加”才会出现的动态经历行，再重新检测字段。
    // 安全模式（默认）：不点“添加/没有实习经历”，避免站点默认提交造成刷新。
    // 统一候选参与同一次检测：精确别名层先于内置规则（方案 §6 / §12.10）。
    const prepareResult = await formFiller.prepareDynamicSections(response.data, section);
    if (prepareResult.navigationDetected) {
      console.warn('[校招表单助手] 自动补齐经历行时检测到页面地址变化，已停止后续自动点击（未输出个人资料值）');
    }
    detectedFields = formDetector.detectFields({
      candidates: buildProfileAnswerCandidates(response.data, response.data.fieldAliasOverrides),
      aliasOverrides: response.data.fieldAliasOverrides,
    });

    // 普通快速填充是纯本地、确定性的匹配，绝不自动调用 AI（方案 §11.1）。

    let fieldsToFill = filterFieldsBySection(detectedFields, section);

    if (fieldsToFill.length === 0) {
      const emptyResult: FormFillResult = {
        detected: 0,
        attempted: 0,
        filled: 0,
        failed: 0,
        skippedChoices: countSkippedChoiceGroups(),
      };
      if (window === window.top) showFillResultMessage(emptyResult);
      return emptyResult;
    }

    // 填充表单。React/Vue 表单可能在写入过程中重建模块，导致部分写入落在
    // 已脱离的死节点上（计为 failed）。失败时自动重新检测并补填（最多两轮）；
    // 空白检查保证重试绝不会覆盖任何已有内容——相当于自动替用户"再点一次"。
    let result = await formFiller.fillForm(fieldsToFill, response.data);
    for (let retry = 0; retry < 2 && result.failed > 0; retry += 1) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      detectedFields = formDetector.detectFields({
        candidates: buildProfileAnswerCandidates(response.data, response.data.fieldAliasOverrides),
        aliasOverrides: response.data.fieldAliasOverrides,
      });
      const retryFields = filterFieldsBySection(detectedFields, section);
      if (retryFields.length === 0) break;
      const retryResult = await formFiller.fillForm(retryFields, response.data);
      fieldsToFill = retryFields;
      result = {
        ...retryResult,
        detected: result.detected,
        attempted: result.attempted + retryResult.attempted,
        filled: result.filled + retryResult.filled,
        skippedExisting: (result.skippedExisting || 0) + (retryResult.skippedExisting || 0),
        skippedBlocked: (result.skippedBlocked || 0) + (retryResult.skippedBlocked || 0),
        skippedAmbiguous: (result.skippedAmbiguous || 0) + (retryResult.skippedAmbiguous || 0),
        skippedChoices: result.skippedChoices,
      };
    }
    result.skippedChoices = countSkippedChoiceGroups();

    // 填充诊断报告（§19 填充报告）：逐字段记录标识、命中与禁止原因，供排查。
    saveFillReport(response.data, fieldsToFill, result);

    // 处理简历文件上传（已有文件的控件不重复上传）
    const fileInputs = formDetector.findFileInputs();
    if (fileInputs.length > 0 && response.data.resume) {
      for (const fileInput of fileInputs) {
        if (fileInput.files && fileInput.files.length > 0) continue;
        try {
          await formFiller.uploadResume(
            fileInput,
            response.data.resume.fileData,
            response.data.resume.fileName
          );
        } catch (error) {
          console.error('Failed to upload resume to input:', error);
        }
      }
    }

    // 只把写入后回读成功的控件计为成功。
    const urlChanged = window.location.href !== hrefBefore;
    if (urlChanged) {
      // 只记录地址变化事实，不输出任何个人资料值；扩展绝不主动 reload/submit。
      console.warn('[校招表单助手] 填充期间检测到页面地址变化（未输出个人资料值），本次填充可能被站点打断');
    }
    result.urlChanged = urlChanged;
    if (window === window.top) showFillResultMessage(result);
    return result;

  } catch (error) {
    console.error('Fill form error:', error);
    alert('填充表单时出错，请查看控制台了解详情');
    throw error;
  }
}

function filterFieldsBySection(fields: DetectedField[], section: FillSection): DetectedField[] {
  if (section === 'all') return fields;

  return fields.filter(field => getElementSection(field.element) === section);
}

interface FillReportField {
  label: string;
  placeholder: string;
  name: string;
  id: string;
  inputType: string;
  autocomplete: string;
  matchType: string;
  wantValue: string;
  valueAtDetect: string;
  blankNow: boolean;
  blocked: string;
  ambiguous: boolean;
  matchReason: string;
  raw: string;
}

interface FillReport {
  url: string;
  time: string;
  counts: FormFillResult;
  candidates: Array<{ key: string; label: string; aliases: string; value: string }>;
  fields: FillReportField[];
  unmatched: Array<{ label: string; placeholder: string; name: string; id: string; inputType: string; reason: string; raw: string }>;
}

function buildFillReportField(field: DetectedField): FillReportField {
  const identifiers = FieldMatcher.extractIdentifiers(field.element);
  const blocked = matchBlockedField(identifiers);
  return {
    label: identifiers.labelText.replace(/\s+/g, ' ').trim().slice(0, 40),
    placeholder: identifiers.placeholder.slice(0, 30),
    name: identifiers.name.slice(0, 50),
    id: identifiers.id.slice(0, 50),
    inputType: identifiers.type,
    autocomplete: identifiers.autocomplete,
    matchType: String(field.fieldType),
    wantValue: (field.profileValue ?? '').slice(0, 6),
    valueAtDetect: (field.value ?? '').slice(0, 12),
    blankNow: isControlBlank(field.element),
    blocked: blocked ? `${blocked.category}(${blocked.label})` : '',
    ambiguous: Boolean(field.ambiguous),
    matchReason: (field.matchReason || '').slice(0, 80),
    raw: JSON.stringify({
      module: identifiers.moduleContext.slice(0, 30),
      row: identifiers.rowContext.slice(0, 40),
      auto: identifiers.autocomplete,
    }),
  };
}

async function saveFillReport(
  profile: UserProfile,
  fieldsToFill: DetectedField[],
  result: FormFillResult,
): Promise<void> {
  try {
    const report: FillReport = {
      url: window.location.href.slice(0, 150),
      time: new Date().toISOString(),
      counts: result,
      candidates: buildProfileAnswerCandidates(profile, profile.fieldAliasOverrides)
        .filter(candidate => candidate.value.trim())
        .slice(0, 60)
        .map(candidate => ({
          key: candidate.key,
          label: candidate.label,
          aliases: candidate.aliases.join('、').slice(0, 60),
          value: candidate.value.slice(0, 6),
        })),
      fields: fieldsToFill.map(buildFillReportField),
      unmatched: formDetector.getUnmatchedFields().slice(0, 60).map(unmatched => {
        const ids = unmatched.identifiers;
        return {
          label: ids.labelText.replace(/\s+/g, ' ').trim().slice(0, 40),
          placeholder: ids.placeholder.slice(0, 30),
          name: ids.name.slice(0, 50),
          id: ids.id.slice(0, 50),
          inputType: ids.type,
          reason: (unmatched.reason || '').slice(0, 80),
          raw: JSON.stringify({
            module: ids.moduleContext.slice(0, 30),
            row: ids.rowContext.slice(0, 40),
            auto: ids.autocomplete,
          }),
        };
      }),
    };
    await chrome.storage.local.set({ jahFillReport: report });
  } catch (error) {
    console.warn('Failed to save fill report:', error);
  }
}

function getElementSection(element: Element): FillSection | null {
  const module = element.closest<HTMLElement>('[class*=applyFormModuleWrapper]');
  const text = (module?.textContent || '').replace(/\s+/g, ' ');

  if (text.includes('基本信息')) return 'personal';
  if (text.includes('教育经历')) return 'education';
  if (text.includes('实习经历')) return 'experience';
  if (text.includes('项目经历')) return 'projects';
  if (/奖项|荣誉|获奖/.test(text)) return 'awards';

  let current = element.parentElement;
  for (let depth = 0; current && current !== document.body && depth < 7; depth += 1, current = current.parentElement) {
    const localText = (current.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (/教育背景|教育经历|就读时间|入学时间|毕业时间|学校名称|院校名称/.test(localText)) return 'education';
    if (/实习经历|工作经历|任职经历|公司名称|单位名称/.test(localText)) return 'experience';
    if (/项目经历|项目经验|项目名称/.test(localText)) return 'projects';
    if (/奖项|荣誉|获奖经历/.test(localText)) return 'awards';
    if (/个人信息|基本信息|手机号码|出生日期/.test(localText)) return 'personal';
  }

  return null;
}

// AI 框选入口已按合规要求关闭：实现保留供以后重新评估后复用（当前故意不调用）。
// oxlint-disable-next-line no-unused-vars
function startAIRegionSelection() {
  visualRegionFillController.beginVisualRegionFill();
}

type ScannedPageField = PageScanField & {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
};

function collectPageScanFields(): ScannedPageField[] {
  const elements = collectFormControls().filter(element => {
    const inputType = element.tagName === 'INPUT'
      ? (element as HTMLInputElement).type.toLowerCase()
      : '';
    if (['hidden', 'file', 'submit', 'button', 'reset', 'image', 'radio', 'checkbox'].includes(inputType)) return false;
    if (element.offsetParent === null || element.disabled) return false;
    if ('readOnly' in element && element.readOnly
      && !(element instanceof HTMLInputElement && isCustomSelectInput(element))) {
      return false;
    }
    return !getControlValue(element);
  });
  const rowCounters = new Map<string, number>();
  const dateGroupRows = new Map<HTMLElement, number>();
  const nextDateRow = new Map<PageScanSection, number>();

  return elements.map((element, index) => {
    const container = element.closest<HTMLElement>(
      '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name]',
    ) || element.closest<HTMLElement>(
      'label, [class*="form-item" i], [class*="formitem" i], [class*="field-wrapper" i], [class*="fieldWrapper" i], [class*="form-field" i]',
    );
    const name = (
      element.getAttribute('data-form-field-name') ||
      container?.getAttribute('data-form-field-name') ||
      element.getAttribute('data-form-field-id') ||
      container?.getAttribute('data-form-field-id') ||
      (element as HTMLInputElement).name ||
      ''
    ).trim();
    const label = (
      element.getAttribute('data-form-field-i18n-name') ||
      container?.getAttribute('data-form-field-i18n-name') ||
      container?.querySelector('label')?.textContent ||
      element.getAttribute('aria-label') ||
      element.getAttribute('placeholder') ||
      ''
    ).trim();
    const key = `${name}|${label}`;
    const occurrence = rowCounters.get(key) || 0;
    rowCounters.set(key, occurrence + 1);
    const section = toPageScanSection(getElementSection(element));
    const datePart = getDatePartMetadata(element, section, name, label);
    if (datePart && !dateGroupRows.has(datePart.group)) {
      const next = nextDateRow.get(section) || 0;
      dateGroupRows.set(datePart.group, next);
      nextDateRow.set(section, next + 1);
    }
    const context = `${getPageSectionName(section)}；${(container?.textContent || element.parentElement?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)}`;

    return {
      element,
      index,
      rowIndex: datePart ? (dateGroupRows.get(datePart.group) || 0) : occurrence,
      section,
      name,
      label,
      type: datePart
        ? datePart.type
        : (element.getAttribute('role') === 'combobox'
          ? 'combobox'
          : (element.tagName === 'INPUT' ? (element as HTMLInputElement).type : element.tagName.toLowerCase())),
      options: getKnownOptions(element, label, name),
      context,
    };
  });
}

function getControlValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (element.tagName === 'INPUT' && ['checkbox', 'radio'].includes((element as HTMLInputElement).type)) {
    const input = element as HTMLInputElement;
    return input.checked ? (input.value || 'checked') : '';
  }
  const container = element.closest<HTMLElement>(
    '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name]',
  );
  return (
    container?.querySelector('.ud__select__selector__selectItem')?.textContent ||
    element.value ||
    ''
  ).trim();
}

function getDatePartMetadata(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  section: PageScanSection,
  name: string,
  label: string,
): { group: HTMLElement; type: string } | null {
  let current = element.parentElement;
  for (let depth = 0; current && current !== document.body && depth < 6; depth += 1, current = current.parentElement) {
    const text = (current.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const controls = Array.from(current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select',
    )).filter(control => control.offsetParent !== null && !control.disabled);
    if (controls.length < 2 || controls.length > 6) continue;

    const isRange = /就读时间|起止时间|在校时间|学习时间|开始时间.*结束时间|入学.*毕业|start.*end/i.test(`${name} ${label} ${text}`);
    const isSingleDate = /出生日期|出生年月|生日|birth/i.test(`${name} ${label} ${text}`);
    if (!isRange && !isSingleDate) continue;

    const ordered = [...controls].sort((left, right) => {
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return Math.abs(a.top - b.top) < 8 ? a.left - b.left : a.top - b.top;
    });
    const position = ordered.indexOf(element);
    if (position < 0) continue;

    if (isRange && ordered.length >= 4) {
      return {
        group: current,
        type: ['date-start-year', 'date-start-month', 'date-end-year', 'date-end-month'][position] || 'date-part',
      };
    }
    if (isRange && ordered.length === 2) {
      return { group: current, type: position === 0 ? 'date-start' : 'date-end' };
    }
    if (isSingleDate) {
      return {
        group: current,
        type: ['date-year', 'date-month', 'date-day'][position] || 'date-part',
      };
    }
  }

  return null;
}

function toPageScanSection(section: FillSection | null): PageScanSection {
  return section && section !== 'all' ? section : 'other';
}

function getPageSectionName(section: PageScanSection): string {
  return {
    personal: '基本信息',
    education: '教育经历',
    experience: '实习经历',
    projects: '项目经历',
    awards: '奖项 / 荣誉',
    other: '其它表单',
  }[section];
}

// —— 「本页字段对照」报告（popup 未识别字段学习入口） ——
// 只返回网页字段元数据与匹配原因：绝不返回用户资料值或已填写内容。
const FIELD_REPORT_MAX_UNMATCHED = 40;
const FIELD_REPORT_MAX_MATCHED = 40;
const FIELD_REPORT_MAX_BLOCKED = 20;

function normalizeReportText(value: string, maxLength: number): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function describeControlType(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): string {
  if (element.tagName === 'SELECT') return 'select';
  if (element.tagName === 'TEXTAREA') return 'textarea';
  if (element.getAttribute('role') === 'combobox') return 'combobox';
  if (element instanceof HTMLInputElement) return element.type || 'text';
  return element.tagName.toLowerCase();
}

function reportFieldLabel(
  identifiers: ReturnType<typeof FieldMatcher.extractIdentifiers>,
): string {
  return normalizeReportText(identifiers.labelText, 60)
    || normalizeReportText(identifiers.placeholder, 40)
    || normalizeReportText(identifiers.name || identifiers.id, 60)
    || '未命名字段';
}

function buildUnmatchedReportItem(
  unmatched: ReturnType<FormDetector['getUnmatchedFields']>[number],
  index: number,
): PageFieldReportItem {
  const identifiers = unmatched.identifiers;
  const element = unmatched.element;
  // 防御：blocked 字段理论上不会进入 unmatched；万一竞态混入也绝不可学习。
  const blocked = matchBlockedField(identifiers);
  const suggestedAlias = blocked
    ? ''
    : suggestLearnedAlias({
      label: identifiers.labelText,
      placeholder: identifiers.placeholder,
      name: identifiers.name || identifiers.id,
    });
  const section = getElementSection(element);

  return {
    id: String(index),
    label: reportFieldLabel(identifiers),
    suggestedAlias,
    section: section ? getPageSectionName(toPageScanSection(section)) : '其它表单',
    module: normalizeReportText(identifiers.moduleContext, 60),
    type: describeControlType(element),
    options: getKnownOptions(element, identifiers.labelText, identifiers.name).slice(0, 20),
    reason: normalizeReportText(unmatched.reason || '未识别', 80),
    blank: isControlBlank(element),
    learnable: Boolean(suggestedAlias),
  };
}

function buildMatchedReportField(
  field: DetectedField,
  candidates: ReturnType<typeof buildProfileAnswerCandidates>,
): { label: string; targetLabel: string } {
  const identifiers = FieldMatcher.extractIdentifiers(field.element);
  const matchedCandidate = candidates.find(candidate => (
    candidate.id === field.fieldType || candidate.coreFieldType === field.fieldType
  ));
  return {
    label: reportFieldLabel(identifiers),
    targetLabel: matchedCandidate?.label || '',
  };
}

function buildBlockedReportField(field: DetectedField): { label: string; reason: string } {
  const identifiers = FieldMatcher.extractIdentifiers(field.element);
  return {
    label: reportFieldLabel(identifiers),
    reason: normalizeReportText(
      (field.matchReason || '禁止自动填写').replace(/^禁止自动填写[:：]\s*/, ''),
      40,
    ),
  };
}

async function buildPageFieldReport(): Promise<MessageResponse<PageFrameFieldReport>> {
  const profileResponse = await sendRuntimeMessage<UserProfile>({ type: 'GET_USER_PROFILE' });
  if (!profileResponse.success || !profileResponse.data) {
    return { success: false, error: '请先在设置中完善个人信息后再使用字段对照' };
  }

  const profile = profileResponse.data;
  const candidates = buildProfileAnswerCandidates(profile, profile.fieldAliasOverrides);
  detectedFields = formDetector.detectFields({
    candidates,
    aliasOverrides: profile.fieldAliasOverrides,
  });

  const unmatchedSources = formDetector.getUnmatchedFields();
  const unmatched = unmatchedSources
    .slice(0, FIELD_REPORT_MAX_UNMATCHED)
    .map((unmatchedField, index) => buildUnmatchedReportItem(unmatchedField, index));

  const matchedDetected = detectedFields.filter(field => (
    !field.blocked && !field.ambiguous && field.fieldType !== FieldType.UNKNOWN
  ));
  const blockedDetected = detectedFields.filter(field => field.blocked);

  return {
    success: true,
    data: {
      detected: detectedFields.length,
      matched: matchedDetected.length,
      unmatched,
      matchedFields: matchedDetected
        .slice(0, FIELD_REPORT_MAX_MATCHED)
        .map(field => buildMatchedReportField(field, candidates)),
      blocked: blockedDetected
        .slice(0, FIELD_REPORT_MAX_BLOCKED)
        .map(buildBlockedReportField),
      blockedCount: blockedDetected.length,
    },
  };
}

async function fillPageScanGroup(
  section: PageScanSection,
  fields: ScannedPageField[],
  requestId: string,
  shouldContinue: () => boolean,
): Promise<number> {
  const response = await sendRuntimeMessage<Record<string, string>>({
    type: 'AI_FILL_SECTION',
    payload: {
      requestId,
      section,
      domain: window.location.hostname,
      fields: fields.map(field => ({
        index: field.index,
        rowIndex: field.rowIndex,
        name: field.name,
        label: field.label,
        type: field.type,
        options: field.options,
        context: field.context,
      })),
    },
  });

  if (!response.success || !response.data) {
    throw new Error(response.error || 'AI 未返回扫描结果');
  }

  const values = Object.entries(response.data)
    .map(([index, value]) => {
      const field = fields.find(item => item.index === Number(index));
      return field ? { element: field.element, value: normalizeAIFieldValue(field, value) } : null;
    })
    .filter((item): item is {
      element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      value: string;
    } => Boolean(item))
    .sort((a, b) => getDateRangeFillPriority(a.element) - getDateRangeFillPriority(b.element));

  return formFiller.fillElementValues(values, shouldContinue);
}

function normalizeAIFieldValue(field: ScannedPageField, value: string): string {
  const match = value.match(/((?:19|20)\d{2})(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?/);
  let target = value.trim();
  if (match) {
    if (/year$/.test(field.type)) target = match[1];
    if (/month$/.test(field.type) && match[2]) target = String(Number(match[2]));
    if (/day$/.test(field.type) && match[3]) target = String(Number(match[3]));
  }

  const option = field.options.find(candidate => dateChoiceEquivalent(candidate, target));
  return option || target;
}

function dateChoiceEquivalent(left: string, right: string): boolean {
  const normalize = (value: string) => value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^0+(?=\d)/, '')
    .replace(/[年月日号\s._/-]/g, '');
  return normalize(left) === normalize(right);
}

function showAIRegionStatus(initialText: string) {
  const element = document.createElement('div');
  const textElement = document.createElement('span');
  const cancelButton = document.createElement('button');
  element.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:1000005;max-width:440px;padding:12px 14px;border-radius:8px;background:#24262d;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.28);font:500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;gap:12px;';
  textElement.textContent = initialText;
  cancelButton.type = 'button';
  cancelButton.textContent = '终止';
  cancelButton.style.cssText = 'flex:none;padding:5px 10px;border:1px solid rgba(255,255,255,.65);border-radius:5px;background:transparent;color:#fff;cursor:pointer;font:500 12px inherit;';
  element.append(textElement, cancelButton);
  document.body.appendChild(element);

  return {
    setCancelHandler(handler: () => void | Promise<void>) {
      cancelButton.onclick = () => {
        cancelButton.disabled = true;
        cancelButton.textContent = '终止中';
        void handler();
      };
    },
    update(text: string, type: 'normal' | 'success' | 'warning' | 'error' = 'normal') {
      textElement.textContent = text;
      element.style.background = type === 'success'
        ? '#15803d'
        : type === 'warning'
          ? '#a16207'
          : type === 'error'
            ? '#b91c1c'
            : '#24262d';
      if (type !== 'normal') {
        cancelButton.remove();
        setTimeout(() => element.remove(), 5000);
      }
    },
  };
}

function getKnownOptions(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  label: string,
  name: string,
): string[] {
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options)
      .map(option => option.text.trim())
      .filter(option => option && !/^(请选择|请选择年份|请选择月份|请选择日期|选择|年|月|日)$/.test(option));
  }
  if (label === '学历类型' || name === 'education_type') {
    return ['海外及港澳台', '统招全日制', '统招非全日制', '自考', '其他'];
  }
  if (label === '学历' || name === 'degree') {
    return ['高中', '专科', '本科', '硕士', '博士'];
  }
  if (/性别|gender|sex/i.test(`${label} ${name}`)) {
    return ['男', '女'];
  }
  return [];
}

function getDateRangeFillPriority(element: Element): number {
  const container = element.closest<HTMLElement>(
    '[data-form-field-id="start_end_time"], [data-form-field-name="start_end_time"], [data-form-field-i18n-name="起止时间"]'
  );
  if (!container) return 2;

  const inputs = Array.from(
    container.querySelectorAll('input:not([type="hidden"]), textarea, select')
  ).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  return inputs.indexOf(element) === 1 ? 0 : 1;
}

// 注入 AI 生成按钮到开放性问题旁。
// 合规要求：本版本已关闭该入口（不再调用），实现保留供以后重新评估后复用。
// oxlint-disable-next-line no-unused-vars
function injectAIButtons() {
  const detector = new OpenQuestionDetector();
  const openFields = detector.detect();

  for (const field of openFields) {
    if (field.element.parentElement?.querySelector('.ai-gen-btn')) continue;

    const btn = document.createElement('button');
    btn.className = 'ai-gen-btn';
    btn.textContent = 'AI 生成';
    btn.style.cssText = `
      margin-left: 8px; margin-top: 6px; padding: 4px 12px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white; border: none; border-radius: 4px;
      font-size: 12px; cursor: pointer; display: inline-block;
    `;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.textContent = '生成中...';
      (btn as HTMLButtonElement).disabled = true;

      const response = await sendRuntimeMessage({
        type: 'GENERATE_ANSWER',
        payload: {
          questionText: field.questionText,
          context: field.context,
          fieldMaxLength: parseInt(field.element.getAttribute('maxlength') || '0') || undefined,
          language: /[一-鿿]/.test(field.questionText) ? 'zh' : 'en',
        },
      });

      if (response.success && response.data) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(field.element, response.data.answer);
        } else {
          field.element.value = response.data.answer;
        }
        field.element.dispatchEvent(new Event('input', { bubbles: true }));
        field.element.dispatchEvent(new Event('change', { bubbles: true }));
        field.element.style.border = '2px solid #667eea';
        btn.textContent = 'AI 生成 ✓';
      } else {
        btn.textContent = '生成失败';
        console.error('Generation failed:', response.error);
      }

      setTimeout(() => {
        btn.textContent = 'AI 生成';
        (btn as HTMLButtonElement).disabled = false;
      }, 3000);
    });

    field.element.insertAdjacentElement('afterend', btn);
  }
}

// 显示经过回读验证的实际填充结果
function showFillResultMessage(result: FormFillResult) {
  const message = document.createElement('div');
  message.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000000;
    background: ${result.urlChanged ? '#a16207' : result.filled > 0 && result.failed === 0 ? '#10b981' : '#a16207'};
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 10px;
    animation: slideIn 0.3s ease;
  `;

  // 只汇报真实发生的事：成功、跳过已有内容、禁止字段、无法确定、写入失败。
  const parts: string[] = [];
  if (result.filled > 0) parts.push(`成功填写 ${result.filled} 项`);
  if (result.skippedExisting) parts.push(`跳过已有内容 ${result.skippedExisting} 项`);
  if (result.skippedBlocked) parts.push(`禁止字段 ${result.skippedBlocked} 项`);
  if (result.skippedAmbiguous) parts.push(`无法确定 ${result.skippedAmbiguous} 项`);
  if (result.failed) parts.push(`${result.failed} 项未能写入`);
  if (result.skippedChoices) parts.push(`${result.skippedChoices} 组选项请手动选择`);
  const resultText = parts.length
    ? parts.join('；')
    : (result.detected === 0 ? '未检测到可填充字段' : '检测到了字段，但没有可自动填写的空白项');
  message.textContent = result.urlChanged
    ? `检测到页面跳转/刷新，填充可能被站点打断；${resultText}`
    : resultText;

  document.body.appendChild(message);

  setTimeout(() => {
    message.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => {
      document.body.removeChild(message);
    }, 300);
  }, 3000);
}

function countSkippedChoiceGroups(): number {
  const visibleChoices = collectFormControls().filter((control): control is HTMLInputElement =>
    control instanceof HTMLInputElement
    && (control.type === 'radio' || control.type === 'checkbox')
    && control.offsetParent !== null
    && !control.disabled
    // 扩展自己的悬浮面板（Shadow DOM）里的勾选框不算页面选项。
    && !isFloatingPanelControl(control),
  );
  const groups = new Set(visibleChoices.map(choice =>
    choice.name
      || choice.closest('[role="radiogroup"], [role="group"], fieldset, [class*="formItem" i]')?.textContent?.slice(0, 120)
      || choice.id,
  ));
  return groups.size;
}

// —— 悬浮面板：单 frame 扫描 / 选择性填充 / 撤销（由 background 按 frame 路由） ——

const PANEL_PLANNED_VALUE_MAX_LENGTH = 500;
const PANEL_SENSITIVE_LABEL_PATTERN = /身份证|证件|手机|电话|邮箱|微信|紧急联系|银行卡/;

function panelFrameFieldStatus(
  field: DetectedField,
  planField: FillPlanField | undefined,
): PanelFieldStatus {
  if (field.blocked || planField?.status === 'blocked') return 'blocked';
  if (field.ambiguous || planField?.status === 'ambiguous') return 'ambiguous';
  if (planField?.status === 'planned') return 'blank';
  if (planField?.status === 'existing' || !isControlBlank(field.element)) return 'filled';
  return 'unmatched';
}

/**
 * 字段指纹：模块 + 字段类型 + 规范化标题 + 同指纹出现序号。
 * 面板扫描后页面重渲染时，用它在最新检测结果里找回原字段。
 */
function buildPanelFingerprint(
  section: PanelSection,
  fieldType: string,
  label: string,
  counters: Map<string, number>,
): string {
  const base = `${section}|${fieldType}|${normalizeReportText(label, 40)}`;
  const occurrence = counters.get(base) ?? 0;
  counters.set(base, occurrence + 1);
  return `${base}|${occurrence}`;
}

async function buildPanelFrameScan(): Promise<MessageResponse<PanelFrameScan>> {
  const profileResponse = await sendRuntimeMessage<UserProfile>({ type: 'GET_USER_PROFILE' });
  if (!profileResponse.success || !profileResponse.data) {
    return { success: false, error: '请先在设置中完善个人信息后再使用页面面板' };
  }
  const profile = profileResponse.data;
  const candidates = buildProfileAnswerCandidates(profile, profile.fieldAliasOverrides);
  detectedFields = formDetector.detectFields({
    candidates,
    aliasOverrides: profile.fieldAliasOverrides,
  });
  const plan = formFiller.resolvePlan(detectedFields, profile, candidates);

  panelScanRegistry = new Map();
  panelFillLocalIds = new Map();
  const fingerprintCounters = new Map<string, number>();

  const fields: PanelField[] = detectedFields.map((field, index) => {
    const localId = `f${index}`;
    const element = field.element as FillControl;
    const planField = plan.byElement.get(element);
    const label = reportFieldLabel(FieldMatcher.extractIdentifiers(field.element));
    const section = toPageScanSection(getElementSection(field.element));
    const status = panelFrameFieldStatus(field, planField);
    const blankNow = isControlBlank(field.element);
    const plannedValue = (planField?.value ?? '').slice(0, PANEL_PLANNED_VALUE_MAX_LENGTH);
    const sensitive = planField?.sensitive === true
      || PANEL_SENSITIVE_LABEL_PATTERN.test(`${label} ${planField?.profileLabel || ''}`);
    const fingerprint = buildPanelFingerprint(
      section,
      planField?.fieldType || field.fieldType,
      label,
      fingerprintCounters,
    );
    panelScanRegistry.set(localId, { element, fingerprint });
    return {
      id: localId,
      frameId: 0,
      label,
      section,
      sectionName: getPageSectionName(section),
      type: describeControlType(field.element),
      status,
      blank: blankNow,
      currentValuePresent: !blankNow,
      plannedValue,
      profileLabel: planField?.profileLabel || '',
      sensitive,
      writable: status === 'blank' && Boolean(plannedValue.trim()),
    };
  });

  const unmatched = formDetector.getUnmatchedFields().map((item, index) => {
    const section = toPageScanSection(getElementSection(item.element));
    return {
      id: `u${index}`,
      frameId: 0,
      label: reportFieldLabel(item.identifiers),
      section,
      sectionName: getPageSectionName(section),
      type: describeControlType(item.element),
      reason: normalizeReportText(item.reason || '未识别', 80),
      blank: isControlBlank(item.element),
    };
  });

  return {
    success: true,
    data: {
      frameId: 0,
      fields,
      unmatched,
      detected: detectedFields.length,
      blockedCount: detectedFields.filter(field => field.blocked).length,
    },
  };
}

function toPanelFillOutcome(
  detail: { outcome: string } | undefined,
): { outcome: PanelFillOutcome; message?: string } {
  switch (detail?.outcome) {
    case 'filled':
    case 'failed':
    case 'skipped-existing':
    case 'blocked':
    case 'ambiguous':
      return { outcome: detail.outcome as PanelFillOutcome };
    default:
      return {
        outcome: 'ambiguous',
        message: '没有可写入的计划值（资料缺失或页面选项不匹配）',
      };
  }
}

async function fillPanelFrame(
  payload: { localIds: string[]; allowAutoAddRows?: boolean },
): Promise<MessageResponse<PanelFrameFillResult>> {
  const profileResponse = await sendRuntimeMessage<UserProfile>({ type: 'GET_USER_PROFILE' });
  if (!profileResponse.success || !profileResponse.data) {
    return { success: false, error: '请先在设置中完善个人信息后再填充' };
  }
  const profile = profileResponse.data;
  const candidates = buildProfileAnswerCandidates(profile, profile.fieldAliasOverrides);
  const requestedLocalIds = Array.isArray(payload?.localIds)
    ? payload.localIds.filter((localId): localId is string => typeof localId === 'string')
    : [];
  if (requestedLocalIds.length === 0) {
    return { success: false, error: '没有勾选任何字段' };
  }
  const allowAutoAddRows = payload?.allowAutoAddRows === true;
  const urlBefore = window.location.href;
  const prepareResult = await formFiller.prepareDynamicSections(profile, 'all', {
    allowAutoAddRows,
  });

  if (prepareResult.navigationDetected) {
    return {
      success: true,
      data: {
        frameId: 0,
        results: requestedLocalIds.map(localId => ({
          localId,
          outcome: 'not-found' as const,
          message: '自动补齐经历行时页面发生跳转，已停止填充',
        })),
        attempted: 0,
        filled: 0,
        failed: 0,
        skippedExisting: 0,
        skippedBlocked: 0,
        skippedAmbiguous: 0,
        urlBefore,
        urlAfter: window.location.href,
        urlChanged: true,
        undoAvailable: formFiller.hasPendingUndo(),
        autoAddedRows: prepareResult.clickedAdds,
      },
    };
  }

  detectedFields = formDetector.detectFields({
    candidates,
    aliasOverrides: profile.fieldAliasOverrides,
  });
  const plan = formFiller.resolvePlan(detectedFields, profile, candidates);

  // 指纹 -> 最新检测到的元素（同一指纹可能有多个，按顺序取未使用项）。
  const fingerprintCounters = new Map<string, number>();
  const fingerprintToElements = new Map<string, FillControl[]>();
  for (const field of detectedFields) {
    const element = field.element as FillControl;
    const planField = plan.byElement.get(element);
    if (!planField) continue;
    const label = reportFieldLabel(FieldMatcher.extractIdentifiers(field.element));
    const section = toPageScanSection(getElementSection(field.element));
    const fingerprint = buildPanelFingerprint(
      section,
      planField.fieldType,
      label,
      fingerprintCounters,
    );
    const bucket = fingerprintToElements.get(fingerprint) || [];
    bucket.push(element);
    fingerprintToElements.set(fingerprint, bucket);
  }

  const used = new Set<FillControl>();
  const selectedElements: FillControl[] = [];
  const results: Array<{ localId: string; outcome: PanelFillOutcome; message?: string }> = [];
  for (const localId of requestedLocalIds) {
    const registryEntry = panelScanRegistry.get(localId);
    let element: FillControl | null = null;
    if (registryEntry) {
      if (plan.byElement.has(registryEntry.element)) {
        element = registryEntry.element;
      } else {
        // 页面重渲染后旧节点脱离文档：按指纹找回同名字段（多个同指纹按顺序取未使用项）。
        const bucket = (fingerprintToElements.get(registryEntry.fingerprint) || [])
          .filter(candidate => !used.has(candidate));
        if (bucket.length > 0) element = bucket[0];
      }
    }
    if (!element) {
      results.push({
        localId,
        outcome: 'not-found',
        message: '页面已变化，未找到该字段，请重新扫描',
      });
      continue;
    }
    used.add(element);
    selectedElements.push(element);
    panelFillLocalIds.set(element, localId);
  }

  const execution = await formFiller.fillPlanSelected(
    plan,
    selectedElements,
    detectedFields.length,
    { captureUndo: true },
  );
  const detailByElement = new Map(execution.details.map(detail => [detail.element, detail]));
  for (const element of selectedElements) {
    const localId = panelFillLocalIds.get(element) || '';
    const mapped = toPanelFillOutcome(detailByElement.get(element));
    results.push({ localId, outcome: mapped.outcome, ...(mapped.message ? { message: mapped.message } : {}) });
  }

  const urlAfter = window.location.href;
  const urlChanged = urlAfter !== urlBefore;
  if (urlChanged) {
    console.warn('[校招表单助手] 面板填充期间检测到页面地址变化（未输出个人资料值），填充可能被站点打断');
  }

  return {
    success: true,
    data: {
      frameId: 0,
      results,
      attempted: execution.result.attempted,
      filled: execution.result.filled,
      failed: execution.result.failed,
      skippedExisting: execution.result.skippedExisting || 0,
      skippedBlocked: execution.result.skippedBlocked || 0,
      skippedAmbiguous: execution.result.skippedAmbiguous || 0,
      urlBefore,
      urlAfter,
      urlChanged,
      undoAvailable: formFiller.hasPendingUndo(),
      autoAddedRows: prepareResult.clickedAdds,
    },
  };
}

function findPanelLocalIdForElement(element: FillControl): string | undefined {
  const direct = panelFillLocalIds.get(element);
  if (direct) return direct;
  for (const [localId, entry] of panelScanRegistry) {
    if (entry.element === element) return localId;
  }
  return undefined;
}

async function undoPanelFrame(): Promise<MessageResponse<PanelFrameUndoResult>> {
  const restore = await formFiller.undoPendingFill();
  const entries = restore.entries.map(entry => {
    const localId = findPanelLocalIdForElement(entry.element);
    return {
      ...(localId ? { localId } : {}),
      outcome: entry.outcome,
      ...(entry.message ? { message: entry.message } : {}),
    };
  });
  panelFillLocalIds = new Map();
  return {
    success: true,
    data: {
      frameId: 0,
      restored: restore.restored,
      skipped: restore.skipped,
      failed: restore.failed,
      entries,
    },
  };
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_APPLICATION_PAGE_METADATA') {
    sendResponse({
      success: true,
      data: extractApplicationPageMetadata(document, window.location.href),
    });
    return true;
  }

  if (message.type === 'DETECT_FIELDS') {
    detectedFields = formDetector.detectFields();
    sendResponse({
      success: true,
      data: {
        count: detectedFields.length,
        fields: detectedFields.map((f) => ({
          fieldType: f.fieldType,
          confidence: f.confidence
        }))
      }
    });
    return true;
  }

  if (message.type === 'GET_PAGE_FIELD_REPORT') {
    buildPageFieldReport().then((response) => {
      sendResponse(response);
    }).catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : '读取本页字段失败',
      });
    });
    return true;
  }

  if (message.type === 'FILL_FORM') {
    handleFillButtonClick().then((result) => {
      sendResponse({ success: true, data: result });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // AI 填充入口已按合规要求关闭：本版本只做本地确定性匹配，
  // 不启用云端 AI 生成个人答案，也不向模型发送已保存资料。
  // 底层实现（handleAIPageFill / 框选补填）保留在文件中，方便以后重新评估后再启用。
  if (message.type === 'START_AI_PAGE_FILL' || message.type === 'START_AI_REGION_FILL') {
    sendResponse({
      success: false,
      error: 'AI 填充入口已关闭：当前版本只做本地确定性匹配，不会把资料发送给模型',
    });
    return true;
  }

  if (message.type === 'APPLY_FOCUSED_FIELD') {
    applyValueToFocusedControl(message.payload.value).then((result) => {
      sendResponse({ success: true, data: result });
    }).catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : '写入目标字段失败',
      });
    });
    return true;
  }

  // —— 悬浮面板（background 按 frame 路由） ——
  if (message.type === 'PANEL_TOGGLE') {
    if (!floatingPanel) {
      sendResponse({ success: false, error: '页面内面板只在顶层页面显示' });
      return true;
    }
    sendResponse({ success: true, data: floatingPanel.toggle() });
    return true;
  }

  if (message.type === 'PANEL_FRAME_SCAN') {
    buildPanelFrameScan().then((response) => {
      sendResponse(response);
    }).catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : '扫描本页字段失败',
      });
    });
    return true;
  }

  if (message.type === 'PANEL_FRAME_FILL') {
    fillPanelFrame(message.payload).then((response) => {
      sendResponse(response);
    }).catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : '填充所选字段失败',
      });
    });
    return true;
  }

  if (message.type === 'PANEL_FRAME_UNDO') {
    undoPanelFrame().then((response) => {
      sendResponse(response);
    }).catch((error) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : '撤销填充失败',
      });
    });
    return true;
  }
});

// 添加 CSS 动画
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);
}
