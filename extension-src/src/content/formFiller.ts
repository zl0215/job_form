import type { DetectedField, UserProfile } from '../shared/types';
import { FieldType } from '../shared/types';
import { GENDER_OPTIONS, DEGREE_OPTIONS } from '../shared/constants';
import { matchBlockedField } from '../shared/blockedFields.ts';
import { PROFILE_FIELD_REGISTRY } from '../shared/profileFieldRegistry.ts';
import type { ProfileAnswerCandidate } from '../shared/profileAnswerCandidates.ts';
import {
  getControlDisplayedValue,
  isControlBlank,
  type FillControl,
} from './controlState.ts';
import {
  chooseBooleanUndoRestore,
  chooseUndoRestore,
} from './panelSelection.ts';
import { FieldMatcher } from '../utils/fieldMatcher';

export type FillSection = 'all' | 'personal' | 'education' | 'experience' | 'projects' | 'awards';

export interface FormFillResult {
  detected: number;
  attempted: number;
  filled: number;
  failed: number;
  skippedChoices?: number;
  skippedExisting?: number;
  skippedBlocked?: number;
  skippedAmbiguous?: number;
  /** 填充前后 location.href 是否变化（站点跳转/刷新打断填充的告警）。 */
  urlChanged?: boolean;
}

/** 安全模式：默认不点击页面“添加/没有实习经历”，避免站点按钮默认提交导致刷新。 */
export interface PrepareDynamicSectionsOptions {
  allowAutoAddRows?: boolean;
}

export interface PrepareDynamicSectionsResult {
  /** 是否允许自动点击“添加”。 */
  allowAutoAddRows: boolean;
  /** 实际点击“添加”按钮次数。 */
  clickedAdds: number;
  /** 是否点击过“没有实习经历”勾选框。 */
  clickedNoExperience: boolean;
  /** 点击期间检测到 location.href 变化：立即停止继续点击。 */
  navigationDetected: boolean;
}

/** 预览计划：与真实 fillForm 使用同一套取值/跳过判断，绝不写 DOM、点“添加”或触发事件。 */
export type FillPlanStatus =
  | 'planned'      // 空白且计划值可写
  | 'existing'     // 已有内容，不会覆盖
  | 'blocked'      // 永久禁止字段
  | 'ambiguous'    // 多候选冲突，无法唯一确定
  | 'no-value'     // 空白但没有可填值 / 选项无法匹配
  | 'error';       // 解析/适配异常（计为 failed）

export interface FillPlanField {
  element: FillControl;
  /** DetectedField.fieldType 原样保留（核心 FieldType 或 custom:<id>）。 */
  fieldType: string;
  status: FillPlanStatus;
  /** 计划写入的值；仅 planned 一定可写，date-range existing 也会记录计划值。 */
  value: string | null;
  /** 命中的资料字段名称，用于面板展示。 */
  profileLabel: string;
  /** 敏感字段（手机号/身份证等），面板默认遮罩。 */
  sensitive: boolean;
  kind: 'field' | 'date-range';
}

export interface FillPlan {
  /** 按页面字段顺序排列的全部计划项（含禁止/冲突/已有内容）。 */
  fields: FillPlanField[];
  byElement: Map<FillControl, FillPlanField>;
  /** 日期范围组：每组按既有顺序（先结束再开始 / 每组先年后月）排列。 */
  dateRangeGroups: FillPlanField[][];
}

export type FillExecutionOutcome =
  | 'filled'
  | 'failed'
  | 'skipped-existing'
  | 'blocked'
  | 'ambiguous'
  | 'skipped';

export interface FillExecutionDetail {
  element: FillControl;
  outcome: FillExecutionOutcome;
  /** 本次尝试/计划写入的值（成功或失败都可能带值）。 */
  plannedValue?: string;
}

export interface FillPlanExecution {
  result: FormFillResult;
  details: FillExecutionDetail[];
}

/** 选择性填充（面板勾选）的执行结果，附带可撤销快照。 */
export interface FillPlanSelectedExecution extends FillPlanExecution {
  undoAvailable: boolean;
}

type UndoEntryKind = 'value' | 'select' | 'checkbox' | 'radio-group' | 'custom-select';

interface UndoSnapshotEntry {
  element: FillControl;
  kind: UndoEntryKind;
  /** 面板本地 id（用于把撤销结果映射回面板行）。 */
  localId?: string;
  /** 填充前的值/显示文本。 */
  previousValue: string;
  previousIndex?: number;
  previousChecked?: boolean;
  radioStates?: Array<{ element: HTMLInputElement; checked: boolean }>;
  /** 填充写入的值/显示文本。 */
  writtenValue?: string;
  writtenChecked?: boolean;
  /** 本次填充实际勾选的 radio（用于撤销时判断“仍是扩展写入的选项”）。 */
  writtenRadio?: HTMLInputElement;
}

export interface UndoRestoreEntryResult {
  element: FillControl;
  localId?: string;
  outcome: 'restored' | 'skipped' | 'failed';
  message?: string;
}

export interface UndoRestoreResult {
  restored: number;
  skipped: number;
  failed: number;
  entries: UndoRestoreEntryResult[];
}

const EDUCATION_FIELD_TYPES = new Set<FieldType>([
  FieldType.SCHOOL,
  FieldType.COLLEGE,
  FieldType.EDUCATION_TYPE,
  FieldType.MAJOR,
  FieldType.DEGREE,
  FieldType.GPA,
  FieldType.EDUCATION_START_DATE,
  FieldType.GRADUATION_DATE,
]);

const AWARD_FIELD_TYPES = new Set<FieldType>([
  FieldType.AWARD_NAME,
  FieldType.AWARD_ROLE,
  FieldType.AWARD_DATE,
  FieldType.AWARD_DESCRIPTION,
]);

const EXPERIENCE_FIELD_TYPES = new Set<FieldType>([
  FieldType.COMPANY,
  FieldType.POSITION,
  FieldType.START_DATE,
  FieldType.END_DATE,
  FieldType.DESCRIPTION,
]);

const PROJECT_FIELD_TYPES = new Set<FieldType>([
  FieldType.PROJECT_NAME,
  FieldType.PROJECT_ROLE,
  FieldType.PROJECT_START_DATE,
  FieldType.PROJECT_END_DATE,
  FieldType.PROJECT_DESCRIPTION,
]);

// 明确的值等价映射（方案 §10.4）：只做等价组转换，不做近似猜测。
const VALUE_EQUIVALENCE_GROUPS: string[][] = [
  ['中国', '中华人民共和国', 'china', 'cn'],
];

// 资料字段中文名 / 敏感标记：面板预览展示“将填什么值、来自哪个资料字段”。
const CORE_FIELD_LABELS: Record<string, string> = {};
const CORE_FIELD_SENSITIVE: Record<string, boolean> = {};
for (const definition of PROFILE_FIELD_REGISTRY) {
  if (!definition.fieldType) continue;
  CORE_FIELD_LABELS[definition.fieldType] = definition.label;
  if (definition.sensitive) CORE_FIELD_SENSITIVE[definition.fieldType] = true;
}

// 即使注册表没标 sensitive，以下核心字段也属于面板默认遮罩范围（手机号/身份证等）。
const PANEL_SENSITIVE_FIELD_TYPES = new Set<string>([
  FieldType.PHONE,
  FieldType.EMAIL,
  FieldType.WECHAT,
  FieldType.ID_CARD,
  FieldType.BIRTH_DATE,
]);

const SENSITIVE_LABEL_PATTERN = /身份证|证件|手机|电话|邮箱|微信|紧急联系|银行卡|出生|生日/;

function sameValueGroup(left: string, right: string): boolean {
  return VALUE_EQUIVALENCE_GROUPS.some(group => group.includes(left) && group.includes(right));
}

export class FormFiller {
  /** 最近一次面板选择性填充的撤销快照（每个 frame 的 content script 各自持有）。 */
  private pendingUndo: { entries: UndoSnapshotEntry[]; createdAt: number } | null = null;

  // 字节等网申页面常见模式：经历条目需要先点击“添加”才会出现空白行。
  // 安全模式（默认）：完全不点页面上的“添加/没有实习经历”，避免站点按钮默认提交造成刷新。
  async prepareDynamicSections(
    profile: UserProfile,
    section: FillSection = 'all',
    options: PrepareDynamicSectionsOptions = {},
  ): Promise<PrepareDynamicSectionsResult> {
    const allowAutoAddRows = options.allowAutoAddRows === true;
    const result: PrepareDynamicSectionsResult = {
      allowAutoAddRows,
      clickedAdds: 0,
      clickedNoExperience: false,
      navigationDetected: false,
    };
    if (!allowAutoAddRows) return result;

    if (section === 'all' || section === 'education') {
      const education = await this.ensureEducationRows(profile.education.length);
      result.clickedAdds += education.clickedAdds;
      result.navigationDetected = result.navigationDetected || education.navigationDetected;
    }
    if (!result.navigationDetected && (section === 'all' || section === 'experience')) {
      const experience = await this.ensureExperienceRows(profile.experience.length);
      result.clickedAdds += experience.clickedAdds;
      result.clickedNoExperience = experience.clickedNoExperience;
      result.navigationDetected = result.navigationDetected || experience.navigationDetected;
    }
    return result;
  }

  /**
   * 安全点击：点击前在 document 捕获阶段挂一次性监听，preventDefault 目标按钮的
   * 默认提交/跳转行为（不阻止站点自身的 onClick，也不改页面 type 属性），点击后立即移除。
   */
  private clickSafely(element: HTMLElement): void {
    if (!element || typeof element.click !== 'function') return;
    const doc = element.ownerDocument;
    const guard = (event: Event) => {
      try {
        const target = event.target as Node | null;
        const hitsElement = target === element
          || Boolean(target && typeof element.contains === 'function' && element.contains(target));
        if (!hitsElement) return;
        if (event.cancelable) event.preventDefault();
      } catch {
        // 事件对象异常时忽略：宁可让站点行为继续，也不抛错中断填充流程。
      }
    };
    let attached = false;
    try {
      doc.addEventListener('click', guard, true);
      attached = true;
    } catch {
      // 测试替身可能没有事件 API：退化为普通 click。
    }
    try {
      element.click();
    } finally {
      if (attached) {
        try {
          doc.removeEventListener('click', guard, true);
        } catch {
          // ignore
        }
      }
    }
  }

  private currentHref(): string {
    try {
      return window.location.href;
    } catch {
      return '';
    }
  }

  async fillElementValues(
    values: Array<{
      element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      value: string;
    }>,
    shouldContinue: () => boolean = () => true
  ): Promise<number> {
    let filledCount = 0;

    for (const item of values) {
      if (!shouldContinue()) break;
      if (!item.value) continue;

      // AI / 视觉链路同样必须通过禁止名单与空白检查，绝不覆盖已有内容。
      if (this.isBlockedControl(item.element)) continue;
      if (!isControlBlank(item.element)) continue;

      if (await this.fillField(item.element, item.value)) {
        filledCount++;
      }
    }

    return filledCount;
  }

  async fillFocusedControl(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string
  ): Promise<boolean> {
    if (!element.isConnected || element.disabled) return false;

    return this.fillField(element, value);
  }

  // 填充所有检测到的字段（popup 快速填充 / 全量填充入口）
  async fillForm(fields: DetectedField[], profile: UserProfile): Promise<FormFillResult> {
    console.log(`Filling ${fields.length} form fields`);
    const plan = this.resolvePlan(fields, profile);
    const execution = await this.executePlan(plan, fields.length);
    console.log('Form filling completed');
    return execution.result;
  }

  /**
   * 解析填充计划（纯预览）：不写 DOM、不点“添加”、不触发任何事件。
   * 与真实 fillForm 共用同一套记录索引 / 日期范围 / 跳过判断；
   * 面板预览值与 fillForm 实际写入值因此保持一致，避免“预览 A 实际填 B”。
   */
  resolvePlan(
    fields: DetectedField[],
    profile: UserProfile,
    candidates?: ProfileAnswerCandidate[],
  ): FillPlan {
    const byElement = new Map<FillControl, FillPlanField>();
    const planFields: FillPlanField[] = [];
    const dateRangeGroups: FillPlanField[][] = [];
    const handled = new Set<Element>();

    const createEntry = (
      element: FillControl,
      fieldType: string,
      status: FillPlanStatus,
      value: string | null,
      kind: 'field' | 'date-range',
    ): FillPlanField => {
      const entry: FillPlanField = {
        element,
        fieldType,
        status,
        value,
        profileLabel: this.describeFieldLabel(fieldType, candidates),
        sensitive: this.isSensitiveFieldType(fieldType, candidates),
        kind,
      };
      byElement.set(element, entry);
      planFields.push(entry);
      return entry;
    };

    // —— 日期范围组：沿用 fillDateRangeFields 的分组、记录索引与写入顺序 ——
    const rangeFields = fields.filter(field => this.isDateRangeField(field.fieldType as FieldType));
    const groups = new Map<HTMLElement, DetectedField[]>();
    for (const field of rangeFields) {
      const container = this.findDateRangeContainer(field.element);
      if (!container) continue;
      groups.set(container, [...(groups.get(container) || []), field]);
    }

    const sectionIndexes: Partial<Record<FillSection, number>> = {};
    const orderedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    for (const [container, groupFields] of orderedGroups) {
      const section = this.getSectionForElement(container);
      if (section !== 'education' && section !== 'experience') continue;

      const index = sectionIndexes[section] ?? 0;
      sectionIndexes[section] = index + 1;

      const source = section === 'education'
        ? profile.education[index]
        : profile.experience[index];
      if (!source) continue;

      const dates = this.getOrderedDateRange(source.startDate, source.endDate);
      const typeByElement = new Map<Element, string>(
        groupFields.map(field => [field.element, field.fieldType]),
      );
      const inputs = groupFields
        .map(field => field.element)
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const groupEntries: FillPlanField[] = [];

      const pushRangeEntry = (element: Element, value: string, fallbackType: string) => {
        const entry = createEntry(
          element as FillControl,
          typeByElement.get(element) || fallbackType,
          isControlBlank(element as FillControl) ? 'planned' : 'existing',
          value,
          'date-range',
        );
        handled.add(element);
        groupEntries.push(entry);
      };

      if (inputs.length >= 4) {
        const values = [
          this.datePart(dates.start, 'year'),
          this.datePart(dates.start, 'month'),
          this.datePart(dates.end, 'year'),
          this.datePart(dates.end, 'month'),
        ];
        // 很多联动日期框只有选中年份后才会生成月份选项；先结束日期，再开始日期，每组先年后月。
        for (const inputIndex of [2, 3, 0, 1]) {
          const input = inputs[inputIndex];
          const value = values[inputIndex];
          if (!input || !value) continue;
          pushRangeEntry(input, value, FieldType.START_DATE);
        }
        if (groupEntries.length > 0) dateRangeGroups.push(groupEntries);
        continue;
      }

      const startInput = inputs[0];
      const endInput = inputs[1];

      // 字节日期范围组件会校验“开始时间不能晚于结束时间”。
      // 先写右侧较晚时间，再写左侧较早时间，避免旧值触发校验回滚。
      if (endInput && dates.end) pushRangeEntry(endInput, dates.end, FieldType.END_DATE);
      if (startInput && dates.start) pushRangeEntry(startInput, dates.start, FieldType.START_DATE);
      if (groupEntries.length > 0) dateRangeGroups.push(groupEntries);
    }

    // —— 常规字段：只排除已经作为日期范围处理过的控件 ——
    const orderedFields = fields.filter(field => !handled.has(field.element));
    const awardElements = orderedFields
      .filter(field => AWARD_FIELD_TYPES.has(field.fieldType as FieldType))
      .map(field => field.element);
    const awardRows = new Map(awardElements.map(element => [
      element,
      this.getAwardRowContainer(element, awardElements),
    ]));
    const educationIndexes: Partial<Record<FieldType, number>> = {};
    const experienceIndexes: Partial<Record<FieldType, number>> = {};
    const projectIndexes: Partial<Record<FieldType, number>> = {};
    const awardRowIndexes = new Map<Element, number>();
    let fallbackAwardIndex = -1;

    for (const field of orderedFields) {
      try {
        const fieldType = field.fieldType as FieldType;
        const element = field.element as FillControl;

        // 第 1 层：永久禁止字段。无论是否为空、无论用户是否配置了相似别名，绝不写入。
        if (field.blocked || this.isBlockedControl(field.element)) {
          createEntry(element, field.fieldType, 'blocked', null, 'field');
          continue;
        }

        // 多候选冲突：宁可少填，不能乱填。
        if (field.ambiguous) {
          createEntry(element, field.fieldType, 'ambiguous', null, 'field');
          continue;
        }

        // 第 2 层：已有内容保护（第一道实时检查）。
        if (!isControlBlank(field.element)) {
          createEntry(element, field.fieldType, 'existing', null, 'field');
          continue;
        }

        const educationIndex = this.getNextEducationIndex(fieldType, educationIndexes);
        const experienceIndex = this.getNextExperienceIndex(fieldType, experienceIndexes);
        const projectIndex = this.getNextProjectIndex(fieldType, projectIndexes);
        const awardRow = awardRows.get(field.element) || null;
        const awardIndex = AWARD_FIELD_TYPES.has(fieldType)
          ? this.getAwardIndex(awardRow, fieldType, awardRowIndexes, fallbackAwardIndex)
          : undefined;
        if (AWARD_FIELD_TYPES.has(fieldType) && !awardRow && fieldType === FieldType.AWARD_NAME) {
          fallbackAwardIndex += 1;
        }
        const sourceValue = field.profileValue ?? this.getValueForField(
          fieldType,
          profile,
          educationIndex,
          experienceIndex,
          awardIndex,
          projectIndex,
        );
        if (sourceValue === null || sourceValue === undefined) {
          createEntry(element, field.fieldType, 'no-value', null, 'field');
          continue;
        }
        const value = this.adaptDateValueForElement(field.element, sourceValue);
        if (!this.shouldAttemptChoice(field.element, value)) {
          // 选项无法与资料值唯一匹配：保持空白，不尝试写入。
          createEntry(element, field.fieldType, 'no-value', null, 'field');
          continue;
        }
        // 第 2 层：写入前第二道实时检查，防止页面在异步操作后回填了内容。
        if (!isControlBlank(field.element)) {
          createEntry(element, field.fieldType, 'existing', null, 'field');
          continue;
        }
        createEntry(element, field.fieldType, 'planned', value, 'field');
      } catch (error) {
        console.error(`Failed to plan field ${field.fieldType}:`, error);
        createEntry(field.element as FillControl, field.fieldType, 'error', null, 'field');
      }
    }

    return { fields: planFields, byElement, dateRangeGroups };
  }

  /**
   * 执行填充计划。selected 缺省表示执行全部（fillForm）；
   * 面板选择性填充传入勾选元素集合，其余字段不写入、不计数。
   */
  private async executePlan(
    plan: FillPlan,
    detected: number,
    selected?: ReadonlySet<FillControl>,
  ): Promise<FillPlanExecution> {
    const result: FormFillResult = {
      detected,
      attempted: 0,
      filled: 0,
      failed: 0,
      skippedExisting: 0,
      skippedBlocked: 0,
      skippedAmbiguous: 0,
    };
    const details: FillExecutionDetail[] = [];
    const isSelected = (element: FillControl) => !selected || selected.has(element);

    // 日期范围组：保持既有写入顺序（先结束后开始 / 每组先年后月）。
    for (const group of plan.dateRangeGroups) {
      for (const entry of group) {
        if (!isSelected(entry.element)) continue;
        if (!isControlBlank(entry.element)) {
          result.skippedExisting = (result.skippedExisting || 0) + 1;
          details.push({ element: entry.element, outcome: 'skipped-existing' });
          continue;
        }
        if (!entry.value) continue;
        result.attempted += 1;
        try {
          const writeOk = await this.fillField(entry.element, entry.value);
          if (writeOk) {
            result.filled += 1;
            details.push({ element: entry.element, outcome: 'filled', plannedValue: entry.value });
          } else {
            result.failed += 1;
            details.push({ element: entry.element, outcome: 'failed', plannedValue: entry.value });
          }
        } catch (error) {
          result.failed += 1;
          details.push({ element: entry.element, outcome: 'failed', plannedValue: entry.value });
          console.error('Failed to fill date-range field:', error);
        }
      }
    }

    for (const entry of plan.fields) {
      if (entry.kind !== 'field') continue;
      if (!isSelected(entry.element)) continue;

      // 第 1 层：永久禁止。
      if (entry.status === 'blocked') {
        result.skippedBlocked = (result.skippedBlocked || 0) + 1;
        details.push({ element: entry.element, outcome: 'blocked' });
        continue;
      }
      // 多候选冲突。
      if (entry.status === 'ambiguous') {
        result.skippedAmbiguous = (result.skippedAmbiguous || 0) + 1;
        details.push({ element: entry.element, outcome: 'ambiguous' });
        continue;
      }
      // 第 2 层：已有内容保护（第一道实时检查）。
      if (!isControlBlank(entry.element)) {
        result.skippedExisting = (result.skippedExisting || 0) + 1;
        details.push({ element: entry.element, outcome: 'skipped-existing' });
        continue;
      }
      if (entry.status === 'error') {
        result.failed += 1;
        details.push({ element: entry.element, outcome: 'failed' });
        continue;
      }
      if (entry.value === null) {
        details.push({ element: entry.element, outcome: 'skipped' });
        continue;
      }

      result.attempted += 1;
      try {
        const writeOk = await this.fillField(entry.element, entry.value);
        // 页面可能在写入其它字段时重渲染了模块：写入落在已脱离的死节点上，
        // 值进了节点但页面看不到。这种一律计为失败，交给上层自动补填。
        if (writeOk && entry.element.isConnected) {
          result.filled += 1;
          details.push({ element: entry.element, outcome: 'filled', plannedValue: entry.value });
        } else {
          result.failed += 1;
          details.push({ element: entry.element, outcome: 'failed', plannedValue: entry.value });
        }
      } catch (error) {
        result.failed += 1;
        details.push({ element: entry.element, outcome: 'failed', plannedValue: entry.value });
        console.error(`Failed to fill field ${entry.fieldType}:`, error);
      }
    }

    return { result, details };
  }

  /** 面板选择性填充：只写入勾选字段，并在写入前拍撤销快照。 */
  async fillPlanSelected(
    plan: FillPlan,
    selectedElements: FillControl[],
    detected: number,
    options: { captureUndo?: boolean } = {},
  ): Promise<FillPlanSelectedExecution> {
    const unique = Array.from(new Set(selectedElements.filter(Boolean)));
    const captureUndo = options.captureUndo !== false;
    if (captureUndo) this.pendingUndo = null;
    const snapshot = captureUndo ? this.captureUndoSnapshot(unique) : [];
    const selectedSet = new Set(unique);
    const execution = await this.executePlan(plan, detected, selectedSet);

    // 与 popup 快速填充一致的“再点一次”策略：React/Vue 重渲染可能让首轮写入落在
    // 死节点上。等待页面稳定后，对仍然脱离/失败的字段补填一次（绝不覆盖已有内容）。
    if (execution.result.failed > 0) {
      await this.wait(600);
      for (const detail of execution.details) {
        if (detail.outcome !== 'failed') continue;
        const element = detail.element;
        const planned = plan.byElement.get(element);
        if (!planned?.value) continue;
        if (!element.isConnected || !isControlBlank(element)) continue;
        try {
          const writeOk = await this.fillField(element, planned.value);
          if (writeOk && element.isConnected) {
            detail.outcome = 'filled';
            detail.plannedValue = planned.value;
            execution.result.filled += 1;
            execution.result.failed = Math.max(0, execution.result.failed - 1);
          }
        } catch (error) {
          console.error('面板填充重试失败:', error);
        }
      }
    }

    if (captureUndo) {
      const detailByElement = new Map(execution.details.map(detail => [detail.element, detail]));
      const written = snapshot.filter(entry => detailByElement.get(entry.element)?.outcome === 'filled');
      for (const entry of written) this.annotateUndoWrittenState(entry);
      this.pendingUndo = written.length > 0 ? { entries: written, createdAt: Date.now() } : null;
    }

    return { ...execution, undoAvailable: Boolean(this.pendingUndo) };
  }

  hasPendingUndo(): boolean {
    return Boolean(this.pendingUndo && this.pendingUndo.entries.length > 0);
  }

  clearPendingUndo(): void {
    this.pendingUndo = null;
  }

  /**
   * 撤销本次填充：只恢复“当前值仍等于本次写入值”的字段，
   * 用户在填充后手动改过或页面已重渲染的控件跳过并报告。
   */
  async undoPendingFill(): Promise<UndoRestoreResult> {
    const pending = this.pendingUndo;
    this.pendingUndo = null;
    const result: UndoRestoreResult = { restored: 0, skipped: 0, failed: 0, entries: [] };
    if (!pending) return result;

    // 倒序恢复：后写的字段先还原，减少联动组件（结束日期/开始日期）的校验回滚。
    for (const snapshot of [...pending.entries].reverse()) {
      const entryResult = await this.restoreUndoEntry(snapshot);
      result.entries.push(entryResult);
      if (entryResult.outcome === 'restored') result.restored += 1;
      else if (entryResult.outcome === 'failed') result.failed += 1;
      else result.skipped += 1;
    }
    return result;
  }

  private captureUndoSnapshot(elements: FillControl[]): UndoSnapshotEntry[] {
    const entries: UndoSnapshotEntry[] = [];
    const seenRadioGroups = new Set<string>();
    for (const element of elements) {
      if (!element) continue;
      if (element.tagName === 'SELECT') {
        entries.push({
          element,
          kind: 'select',
          previousValue: getControlDisplayedValue(element),
          previousIndex: (element as HTMLSelectElement).selectedIndex,
        });
        continue;
      }
      const input = element instanceof HTMLInputElement ? element as HTMLInputElement : null;
      const inputType = input ? (input.type || '').toLowerCase() : '';
      if (input && inputType === 'radio') {
        const name = input.getAttribute('name') || '';
        const groupKey = name || `__single_${entries.length}`;
        if (seenRadioGroups.has(groupKey)) continue;
        seenRadioGroups.add(groupKey);
        entries.push({
          element,
          kind: 'radio-group',
          previousValue: '',
          radioStates: this.collectRadioGroupStates(input),
        });
        continue;
      }
      if (input && inputType === 'checkbox') {
        entries.push({
          element,
          kind: 'checkbox',
          previousValue: '',
          previousChecked: Boolean(input.checked),
        });
        continue;
      }
      if (input && this.isCustomSelectInput(input)) {
        entries.push({
          element,
          kind: 'custom-select',
          previousValue: getControlDisplayedValue(element),
        });
        continue;
      }
      entries.push({ element, kind: 'value', previousValue: element.value || '' });
    }
    return entries;
  }

  private collectRadioGroupStates(
    input: HTMLInputElement,
  ): Array<{ element: HTMLInputElement; checked: boolean }> {
    const name = input.getAttribute('name') || '';
    const doc = input.ownerDocument;
    if (name && doc?.querySelectorAll) {
      try {
        const escaped = name.replace(/["\\]/g, '\\$&');
        const radios = Array.from(doc.querySelectorAll<HTMLInputElement>(
          `input[type="radio"][name="${escaped}"]`,
        ));
        if (radios.length > 0) return radios.map(radio => ({ element: radio, checked: radio.checked }));
      } catch {
        // 选择器异常时退回单元素快照。
      }
    }
    const group = input.closest?.<HTMLElement>(
      '[role="radiogroup"], fieldset, [data-form-field-id], [data-form-field-name]',
    );
    if (group?.querySelectorAll) {
      const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      if (radios.length > 0) return radios.map(radio => ({ element: radio, checked: radio.checked }));
    }
    return [{ element: input, checked: input.checked }];
  }

  /** 填充完成后记录“扩展写进去的实际显示值/勾选状态”，供撤销时判断是否被用户改过。 */
  private annotateUndoWrittenState(entry: UndoSnapshotEntry): void {
    if (entry.kind === 'value') {
      entry.writtenValue = entry.element.value || '';
      return;
    }
    if (entry.kind === 'select' || entry.kind === 'custom-select') {
      entry.writtenValue = getControlDisplayedValue(entry.element);
      return;
    }
    if (entry.kind === 'checkbox') {
      entry.writtenChecked = (entry.element as HTMLInputElement).checked;
      return;
    }
    if (entry.kind === 'radio-group') {
      entry.writtenRadio = (entry.radioStates || [])
        .map(state => state.element)
        .find(radio => radio.checked);
    }
  }

  private async restoreUndoEntry(snapshot: UndoSnapshotEntry): Promise<UndoRestoreEntryResult> {
    const base = { element: snapshot.element };
    if (!snapshot.element?.isConnected) {
      return { ...base, outcome: 'skipped', message: '页面已重新渲染，节点已脱离文档，未恢复' };
    }
    try {
      switch (snapshot.kind) {
        case 'value':
          return this.restoreValueEntry(snapshot);
        case 'select':
          return this.restoreSelectEntry(snapshot);
        case 'checkbox':
          return this.restoreCheckboxEntry(snapshot);
        case 'radio-group':
          return this.restoreRadioGroupEntry(snapshot);
        case 'custom-select':
          return this.restoreCustomSelectEntry(snapshot);
        default:
          return { ...base, outcome: 'skipped', message: '未知控件类型，未恢复' };
      }
    } catch (error) {
      return {
        ...base,
        outcome: 'failed',
        message: error instanceof Error ? error.message : '恢复时出错',
      };
    }
  }

  private async restoreValueEntry(snapshot: UndoSnapshotEntry): Promise<UndoRestoreEntryResult> {
    const current = snapshot.element.value || '';
    const decision = chooseUndoRestore({
      previousValue: snapshot.previousValue,
      writtenValue: snapshot.writtenValue ?? '',
      currentValue: current,
    });
    if (decision === 'already-restored') {
      return { element: snapshot.element, outcome: 'skipped', message: '内容已是原值，无需恢复' };
    }
    if (decision === 'user-modified') {
      return { element: snapshot.element, outcome: 'skipped', message: '字段在填充后被手动修改，保留当前内容' };
    }
    this.fillInputField(
      snapshot.element as HTMLInputElement | HTMLTextAreaElement,
      snapshot.previousValue,
    );
    await this.wait(30);
    const restored = (snapshot.element.value || '') === snapshot.previousValue;
    return {
      element: snapshot.element,
      outcome: restored ? 'restored' : 'failed',
      message: restored ? undefined : '恢复后回读值不一致',
    };
  }

  private async restoreSelectEntry(snapshot: UndoSnapshotEntry): Promise<UndoRestoreEntryResult> {
    const select = snapshot.element as HTMLSelectElement;
    const current = getControlDisplayedValue(select);
    const decision = chooseUndoRestore({
      previousValue: snapshot.previousValue,
      writtenValue: snapshot.writtenValue ?? '',
      currentValue: current,
    });
    if (decision === 'already-restored') {
      return { element: select, outcome: 'skipped', message: '选项已是原值，无需恢复' };
    }
    if (decision === 'user-modified') {
      return { element: select, outcome: 'skipped', message: '下拉框在填充后被手动修改，保留当前内容' };
    }
    const previousIndex = snapshot.previousIndex ?? -1;
    if (previousIndex < 0 || previousIndex >= select.options.length) {
      return { element: select, outcome: 'skipped', message: '选项列表已变化，无法安全恢复' };
    }
    select.selectedIndex = previousIndex;
    this.triggerEvents(select);
    await this.wait(30);
    const restored = getControlDisplayedValue(select) === snapshot.previousValue;
    return {
      element: select,
      outcome: restored ? 'restored' : 'failed',
      message: restored ? undefined : '恢复后回读选项不一致',
    };
  }

  private async restoreCheckboxEntry(snapshot: UndoSnapshotEntry): Promise<UndoRestoreEntryResult> {
    const checkbox = snapshot.element as HTMLInputElement;
    const decision = chooseBooleanUndoRestore({
      previousChecked: Boolean(snapshot.previousChecked),
      writtenChecked: Boolean(snapshot.writtenChecked),
      currentChecked: Boolean(checkbox.checked),
    });
    if (decision === 'already-restored') {
      return { element: checkbox, outcome: 'skipped', message: '勾选状态已是原值，无需恢复' };
    }
    if (decision === 'user-modified') {
      return { element: checkbox, outcome: 'skipped', message: '勾选框在填充后被手动修改，保留当前内容' };
    }
    if (checkbox.checked !== Boolean(snapshot.previousChecked)) {
      checkbox.click();
      await this.wait(30);
    }
    if (checkbox.checked !== Boolean(snapshot.previousChecked)) {
      this.setCheckedState(checkbox, Boolean(snapshot.previousChecked));
      await this.wait(30);
    }
    const restored = checkbox.checked === Boolean(snapshot.previousChecked);
    return {
      element: checkbox,
      outcome: restored ? 'restored' : 'failed',
      message: restored ? undefined : '恢复后勾选状态不一致',
    };
  }

  private async restoreRadioGroupEntry(snapshot: UndoSnapshotEntry): Promise<UndoRestoreEntryResult> {
    const states = snapshot.radioStates || [];
    const previousCheckedRadio = states.find(state => state.checked && state.element.isConnected)?.element || null;
    const currentCheckedRadio = states
      .map(state => state.element)
      .find(radio => radio.isConnected && radio.checked) || null;
    const writtenRadio = snapshot.writtenRadio?.isConnected ? snapshot.writtenRadio : null;

    if (currentCheckedRadio === previousCheckedRadio) {
      return { element: snapshot.element, outcome: 'skipped', message: '选项已是原值，无需恢复' };
    }
    if (writtenRadio && currentCheckedRadio !== writtenRadio) {
      return { element: snapshot.element, outcome: 'skipped', message: '选项在填充后被手动修改，保留当前内容' };
    }

    const hadDetachedState = states.some(state => !state.element.isConnected);
    if (previousCheckedRadio) {
      previousCheckedRadio.click();
      await this.wait(30);
    } else {
      for (const radio of states.map(state => state.element)) {
        if (!radio.isConnected) continue;
        if (radio.checked) this.setCheckedState(radio, false);
      }
      await this.wait(30);
    }

    const matches = states.every(state => (
      !state.element.isConnected || state.element.checked === state.checked
    ));
    if (matches && !hadDetachedState) {
      return { element: snapshot.element, outcome: 'restored' };
    }
    if (matches) {
      return {
        element: snapshot.element,
        outcome: 'skipped',
        message: '部分选项已重新渲染，未能完整恢复',
      };
    }
    return { element: snapshot.element, outcome: 'failed', message: '恢复后选项状态不一致' };
  }

  private restoreCustomSelectEntry(snapshot: UndoSnapshotEntry): UndoRestoreEntryResult {
    const current = getControlDisplayedValue(snapshot.element);
    const decision = chooseUndoRestore({
      previousValue: snapshot.previousValue,
      writtenValue: snapshot.writtenValue ?? '',
      currentValue: current,
    });
    if (decision === 'already-restored') {
      return { element: snapshot.element, outcome: 'skipped', message: '选项已是原值，无需恢复' };
    }
    if (decision === 'user-modified') {
      return { element: snapshot.element, outcome: 'skipped', message: '下拉框在填充后被手动修改，保留当前内容' };
    }
    // 自定义下拉的显示状态由页面组件持有，直接改内部 input 会造成“看似恢复实际没变”。
    return {
      element: snapshot.element,
      outcome: 'skipped',
      message: '自定义下拉框无法安全撤销，请手动恢复',
    };
  }

  private setCheckedState(element: HTMLInputElement, checked: boolean): void {
    const view = element.ownerDocument?.defaultView || window;
    try {
      const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'checked')?.set;
      if (setter) setter.call(element, checked);
      else element.checked = checked;
    } catch {
      element.checked = checked;
    }
    this.triggerEvents(element);
  }

  private describeFieldLabel(fieldType: string, candidates?: ProfileAnswerCandidate[]): string {
    const candidate = candidates?.find(item => item.id === fieldType);
    if (candidate) return candidate.label || '';
    const coreLabel = CORE_FIELD_LABELS[fieldType];
    if (coreLabel) return coreLabel;
    if (fieldType.startsWith('custom:')) return '自定义资料';
    return '';
  }

  private isSensitiveFieldType(fieldType: string, candidates?: ProfileAnswerCandidate[]): boolean {
    const candidate = candidates?.find(item => item.id === fieldType);
    if (candidate) return Boolean(candidate.sensitive);
    if (CORE_FIELD_SENSITIVE[fieldType]) return true;
    if (PANEL_SENSITIVE_FIELD_TYPES.has(fieldType)) return true;
    const label = CORE_FIELD_LABELS[fieldType] || '';
    return Boolean(label) && SENSITIVE_LABEL_PATTERN.test(label);
  }

  /** 永久禁止字段判断：内推码、验证码、密码等绝不写入。 */
  private isBlockedControl(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  ): boolean {
    try {
      const identifiers = FieldMatcher.extractIdentifiers(element);
      return matchBlockedField(identifiers) !== null;
    } catch {
      // 提取标识符失败时按普通控件处理；空白检查仍在写入前兜底。
      return false;
    }
  }

  private findDateRangeContainer(element: Element): HTMLElement | null {
    const exact = element.closest<HTMLElement>(
      '[data-form-field-id="start_end_time"], [data-form-field-name="start_end_time"], [data-form-field-i18n-name="起止时间"]'
    );
    if (exact) return exact;

    const body = element.ownerDocument?.body;
    let current = element.parentElement;
    for (let depth = 0; current && current !== body && depth < 6; depth += 1, current = current.parentElement) {
      const text = (current.textContent || '').replace(/\s+/g, ' ').slice(0, 500);
      if (!/就读时间|起止时间|在校时间|学习时间|开始时间.*结束时间|入学.*毕业/i.test(text)) continue;
      const controls = Array.from(current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select',
      )).filter(control => control.offsetParent !== null && !control.disabled);
      if (controls.length >= 2 && controls.length <= 6) return current;
    }
    return null;
  }

  private datePart(value: string, part: 'year' | 'month' | 'day'): string {
    const match = value.match(/((?:19|20)\d{2})(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?/);
    if (!match) return '';
    if (part === 'year') return match[1];
    if (part === 'month') return match[2] ? String(Number(match[2])) : '';
    return match[3] ? String(Number(match[3])) : '';
  }

  private adaptDateValueForElement(element: Element, value: string): string {
    const body = element.ownerDocument?.body;
    let current = element.parentElement;
    for (let depth = 0; current && current !== body && depth < 6; depth += 1, current = current.parentElement) {
      const text = (current.textContent || '').replace(/\s+/g, ' ');
      const isRange = /就读时间|起止时间|在校时间|学习时间|开始时间.*结束时间|入学.*毕业/i.test(text);
      const isSingle = /出生日期|出生年月|生日|birth/i.test(text);
      if (!isRange && !isSingle) continue;
      const controls = Array.from(current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select',
      )).filter(control => control.offsetParent !== null && !control.disabled)
        .sort((left, right) => {
          const a = left.getBoundingClientRect();
          const b = right.getBoundingClientRect();
          return Math.abs(a.top - b.top) < 8 ? a.left - b.left : a.top - b.top;
        });
      const index = controls.indexOf(element as HTMLInputElement);
      if (index < 0) continue;
      if (isRange && controls.length >= 4) return this.datePart(value, index % 2 === 0 ? 'year' : 'month') || value;
      if (isSingle && controls.length >= 2) {
        return this.datePart(value, (['year', 'month', 'day'][index] || 'day') as 'year' | 'month' | 'day') || value;
      }
    }
    return value;
  }

  private isDateRangeField(fieldType: FieldType): boolean {
    return [
      FieldType.EDUCATION_START_DATE,
      FieldType.GRADUATION_DATE,
      FieldType.START_DATE,
      FieldType.END_DATE,
    ].includes(fieldType);
  }

  private getSectionForElement(element: Element): FillSection | null {
    let current: Element | null = element;
    const body = element.ownerDocument?.body;

    while (current && current !== body) {
      const text = (current.textContent || '').replace(/\s+/g, ' ');
      if (/教育经历|教育背景|学历类型|学校名称|学院|导师/.test(text)) return 'education';
      if (/实习经历|没有实习经历|公司名称|职位名称/.test(text)) return 'experience';
      if (/项目经历|项目经验|项目名称|项目角色/.test(text)) return 'projects';
      if (/基本信息|手机号码|个人证件/.test(text)) return 'personal';
      current = current.parentElement;
    }

    return null;
  }

  private async ensureEducationRows(
    targetCount: number,
  ): Promise<{ clickedAdds: number; navigationDetected: boolean }> {
    if (targetCount <= 1) return { clickedAdds: 0, navigationDetected: false };

    return this.ensureRows({
      moduleKeyword: '教育经历',
      rowFieldName: 'school',
      targetCount,
    });
  }

  private async ensureExperienceRows(targetCount: number): Promise<{
    clickedAdds: number;
    clickedNoExperience: boolean;
    navigationDetected: boolean;
  }> {
    if (targetCount === 0) {
      return { clickedAdds: 0, clickedNoExperience: false, navigationDetected: false };
    }

    const internshipModule = this.findModule('实习经历');
    const noExperienceCheckbox = internshipModule
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    let clickedNoExperience = false;
    let navigationDetected = false;

    // 只处理“已经被站点勾选成没有实习经历”的情况（取消勾选后才能添加经历行）；
    // 绝不主动勾选“没有实习经历”，避免把用户资料判成无实习。
    if (noExperienceCheckbox?.checked) {
      const hrefBefore = this.currentHref();
      this.clickSafely(noExperienceCheckbox);
      clickedNoExperience = true;
      await this.wait(500);
      navigationDetected = this.currentHref() !== hrefBefore;
    }

    if (navigationDetected) {
      return { clickedAdds: 0, clickedNoExperience, navigationDetected };
    }

    const rows = await this.ensureRows({
      moduleKeyword: '实习经历',
      rowFieldName: 'company',
      targetCount,
    });
    return {
      clickedAdds: rows.clickedAdds,
      clickedNoExperience,
      navigationDetected: rows.navigationDetected,
    };
  }

  private async ensureRows(options: {
    moduleKeyword: string;
    rowFieldName: string;
    targetCount: number;
  }): Promise<{ clickedAdds: number; navigationDetected: boolean }> {
    let clickedAdds = 0;
    let navigationDetected = false;
    for (let attempts = 0; attempts < options.targetCount + 3; attempts++) {
      const currentCount = this.countFieldsInModule(options.moduleKeyword, options.rowFieldName);
      if (currentCount >= options.targetCount) break;

      const addButton = this.findAddButton(options.moduleKeyword);
      if (!addButton) break;

      const hrefBefore = this.currentHref();
      this.clickSafely(addButton);
      clickedAdds += 1;
      await this.wait(700);
      // 站点按钮即使被 preventDefault 仍可能由自身脚本提交表单：检测到跳转立刻停止。
      if (this.currentHref() !== hrefBefore) {
        navigationDetected = true;
        console.warn('[校招表单助手] 检测到页面地址变化，已停止自动补齐经历行');
        break;
      }
    }
    return { clickedAdds, navigationDetected };
  }

  private findModule(keyword: string): HTMLElement | null {
    const doc = typeof document === 'undefined' ? null : document;
    if (!doc) return null;
    const modules = Array.from(
      doc.querySelectorAll<HTMLElement>('[class*=applyFormModuleWrapper]')
    );

    return modules
      .filter(module => (module.textContent || '').includes(keyword))
      .sort((a, b) => b.querySelectorAll('input, textarea, select, button').length - a.querySelectorAll('input, textarea, select, button').length)[0] || null;
  }

  private countFieldsInModule(moduleKeyword: string, fieldName: string): number {
    const module = this.findModule(moduleKeyword);
    if (!module) return 0;

    return Array.from(module.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="hidden"]), textarea, select'
    )).filter(element => {
      const container = element.closest<HTMLElement>(
        '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name]'
      );
      return (
        element.getAttribute('data-form-field-name') === fieldName ||
        element.getAttribute('data-form-field-id') === fieldName ||
        container?.getAttribute('data-form-field-name') === fieldName ||
        container?.getAttribute('data-form-field-id') === fieldName
      );
    }).length;
  }

  private findAddButton(moduleKeyword: string): HTMLButtonElement | null {
    const module = this.findModule(moduleKeyword);
    if (!module) return null;

    return Array.from(module.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => (button.textContent || '').trim() === '添加' && !button.disabled) || null;
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getNextEducationIndex(
    fieldType: FieldType,
    educationIndexes: Partial<Record<FieldType, number>>
  ): number | undefined {
    if (!EDUCATION_FIELD_TYPES.has(fieldType)) return undefined;

    const index = educationIndexes[fieldType] ?? 0;
    educationIndexes[fieldType] = index + 1;
    return index;
  }

  private getNextExperienceIndex(
    fieldType: FieldType,
    experienceIndexes: Partial<Record<FieldType, number>>
  ): number | undefined {
    if (!EXPERIENCE_FIELD_TYPES.has(fieldType)) return undefined;

    const index = experienceIndexes[fieldType] ?? 0;
    experienceIndexes[fieldType] = index + 1;
    return index;
  }

  private getNextProjectIndex(
    fieldType: FieldType,
    projectIndexes: Partial<Record<FieldType, number>>
  ): number | undefined {
    if (!PROJECT_FIELD_TYPES.has(fieldType)) return undefined;

    const index = projectIndexes[fieldType] ?? 0;
    projectIndexes[fieldType] = index + 1;
    return index;
  }

  private getAwardIndex(
    row: Element | null,
    fieldType: FieldType,
    rowIndexes: Map<Element, number>,
    fallbackIndex: number
  ): number {
    if (row) {
      const existing = rowIndexes.get(row);
      if (existing !== undefined) return existing;

      const index = rowIndexes.size;
      rowIndexes.set(row, index);
      return index;
    }

    return fieldType === FieldType.AWARD_NAME ? fallbackIndex + 1 : Math.max(fallbackIndex, 0);
  }

  private getAwardRowContainer(
    element: Element,
    awardElements: Element[]
  ): Element | null {
    const module = element.closest<HTMLElement>(
      '[data-form-module], [data-section], [data-module], [class*=applyFormModuleWrapper]'
    );
    if (!module || !this.isAwardModule(module)) return null;

    const markedRow = element.closest('[data-award-row], [data-repeat-item], [role="listitem"], fieldset');
    if (markedRow && module.contains(markedRow)) return markedRow;

    let current: Element | null = element.parentElement;
    while (current && current !== module) {
      const containedFields = awardElements.filter(candidate => current?.contains(candidate));
      if (containedFields.length >= 2) {
        const fieldBearingChildren = Array.from(current.children)
          .filter(child => containedFields.some(candidate => child.contains(candidate)));
        if (fieldBearingChildren.length >= 2
          && !fieldBearingChildren.every(child => this.isAwardFieldWrapper(child))) {
          return fieldBearingChildren.find(child => child.contains(element)) || null;
        }
        return current;
      }
      current = current.parentElement;
    }

    const moduleRows = Array.from(module.children)
      .filter(child => awardElements.some(candidate => child.contains(candidate)));
    return moduleRows.length >= 2
      ? moduleRows.find(child => child.contains(element)) || null
      : null;
  }

  private isAwardFieldWrapper(element: Element): boolean {
    const hasStableFieldAttribute = [
      'data-index',
      'data-form-field-id',
      'data-form-field-name',
      'data-form-field-i18n-name',
    ].some(attribute => element.hasAttribute(attribute));
    if (hasStableFieldAttribute) return true;

    const className = element.getAttribute('class') || '';
    const hasFieldContainerClass = /(?:^|\s)(?:form[-_]?group|form[-_]?item|field(?:-wrapper)?)(?:\s|$)/i
      .test(className);
    const hasDirectLabel = Boolean(element.querySelector(
      ':scope > label, :scope > [class*=label], :scope > [aria-label]'
    ));
    const controlCount = element.querySelectorAll(
      'input:not([type="hidden"]), textarea, select, [role="combobox"]'
    ).length;

    return controlCount === 1 && (hasFieldContainerClass || hasDirectLabel);
  }

  private isAwardModule(module: HTMLElement): boolean {
    const identifiers = [
      module.getAttribute('data-form-module'),
      module.getAttribute('data-section'),
      module.getAttribute('data-module'),
      module.getAttribute('aria-label'),
      module.querySelector('legend, [role="heading"], h1, h2, h3, h4, h5, h6')?.textContent,
    ].filter(Boolean).join(' ');

    return /奖项|荣誉|获奖|awards?|honou?rs?/i.test(identifiers);
  }

  resolveFieldValue(fieldType: FieldType, profile: UserProfile, awardIndex = 0): string | null {
    return this.getValueForField(fieldType, profile, 0, 0, awardIndex, 0);
  }

  // 根据字段类型获取对应的值
  private getValueForField(
    fieldType: FieldType,
    profile: UserProfile,
    educationIndex = 0,
    experienceIndex = 0,
    awardIndex = 0,
    projectIndex = 0
  ): string | null {
    const education = profile.education[educationIndex];
    const experience = profile.experience[experienceIndex];
    const award = profile.awards[awardIndex];
    const project = profile.projects[projectIndex];
    const educationDates = this.getOrderedDateRange(education?.startDate, education?.endDate);
    const experienceDates = this.getOrderedDateRange(experience?.startDate, experience?.endDate);
    const projectDates = this.getOrderedDateRange(project?.startDate, project?.endDate);

    switch (fieldType) {
      case FieldType.NAME:
        return profile.personal.name || null;

      case FieldType.GENDER:
        return this.normalizeGender(profile.personal.gender);

      case FieldType.BIRTH_DATE:
        return profile.personal.birthDate || null;

      case FieldType.PHONE:
        return profile.personal.phone || null;

      case FieldType.EMAIL:
        return profile.personal.email || null;

      case FieldType.WECHAT:
        return profile.personal.wechat || null;

      case FieldType.ID_CARD:
        return profile.personal.idCard || null;

      case FieldType.SELF_EVALUATION:
        return profile.personal.selfEvaluation || null;

      case FieldType.SCHOOL:
        return education?.school || null;

      case FieldType.COLLEGE:
        return education?.college || this.inferCollege(education?.school, education?.major) || null;

      case FieldType.EDUCATION_TYPE:
        return education?.educationType || '统招全日制';

      case FieldType.MAJOR:
        return education?.major || null;

      case FieldType.DEGREE:
        return this.normalizeDegree(education?.degree);

      case FieldType.GPA:
        return education?.gpa || null;

      case FieldType.EDUCATION_START_DATE:
        return educationDates.start || null;

      case FieldType.GRADUATION_DATE:
        return educationDates.end || null;

      case FieldType.COMPANY:
        return experience?.company || null;

      case FieldType.POSITION:
        return experience?.position || null;

      case FieldType.START_DATE:
        return experienceDates.start || null;

      case FieldType.END_DATE:
        return experienceDates.end || null;

      case FieldType.DESCRIPTION:
        return experience?.description || null;

      case FieldType.PROJECT_NAME:
        return project?.name || null;

      case FieldType.PROJECT_ROLE:
        return project?.role || null;

      case FieldType.PROJECT_START_DATE:
        return projectDates.start || null;

      case FieldType.PROJECT_END_DATE:
        return projectDates.end || null;

      case FieldType.PROJECT_DESCRIPTION:
        return project?.description || null;

      case FieldType.AWARD_NAME:
        return award?.name || null;

      case FieldType.AWARD_ROLE:
        return award?.role || null;

      case FieldType.AWARD_DATE:
        return award?.date || null;

      case FieldType.AWARD_DESCRIPTION:
        return award?.description || null;

      case FieldType.SKILLS:
        return profile.skills.join(', ') || null;

      default:
        return null;
    }
  }

  private getOrderedDateRange(
    startDate?: string,
    endDate?: string
  ): { start: string; end: string } {
    if (!startDate || !endDate) {
      return { start: startDate || '', end: endDate || '' };
    }

    const startKey = this.toComparableDate(startDate);
    const endKey = this.toComparableDate(endDate);

    if (startKey && endKey && startKey > endKey) {
      return { start: endDate, end: startDate };
    }

    return { start: startDate, end: endDate };
  }

  private toComparableDate(value: string): string {
    const match = value.match(/(\d{4})\D{0,3}(\d{1,2})?/);
    if (!match) return '';

    const year = match[1];
    const month = (match[2] || '01').padStart(2, '0');
    return `${year}-${month}`;
  }

  private inferCollege(school?: string, major?: string): string {
    if (school === '北京大学' && major === '计算机科学与技术') {
      return '信息科学技术学院';
    }
    if (school === '浙江大学' && major === '软件工程') {
      return '软件学院';
    }
    if (school === '北京市第四中学') {
      return '理科实验班';
    }
    return '';
  }

  // 标准化性别值
  private normalizeGender(gender: string): string | null {
    if (!gender) return null;

    const genderLower = gender.toLowerCase();

    // 检查男性
    if (GENDER_OPTIONS.male.some((opt) => opt.toLowerCase() === genderLower)) {
      return '男';
    }

    // 检查女性
    if (GENDER_OPTIONS.female.some((opt) => opt.toLowerCase() === genderLower)) {
      return '女';
    }

    return gender;
  }

  // 标准化学历值
  private normalizeDegree(degree?: string): string | null {
    if (!degree) return null;

    const degreeLower = degree.toLowerCase();

    for (const values of Object.values(DEGREE_OPTIONS)) {
      if (values.some((v) => v.toLowerCase() === degreeLower)) {
        return values[0]; // 返回标准化的中文值
      }
    }

    return degree;
  }

  // 填充单个字段
  private async fillField(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string
  ): Promise<boolean> {
    const inputType = element.tagName === 'INPUT'
      ? (element as HTMLInputElement).type.toLowerCase()
      : '';

    // 密码类控件属于永久禁止字段，任何路径都不允许写入。
    if (inputType === 'password') return false;

    if (inputType === 'checkbox' || inputType === 'radio') {
      return this.fillChoiceField(element as HTMLInputElement, value);
    }

    if (element instanceof HTMLInputElement && this.isCustomSelectInput(element)) {
      const selected = await this.fillCustomSelectField(element as HTMLInputElement, value);
      if (selected) return this.controlHasValue(element, value);
      // 自定义下拉框找不到候选项时，直接改内部 input.value 会造成“看似成功但界面没变”。
      return false;
    }

    // 根据元素类型进行不同的填充
    if (element.tagName === 'SELECT') {
      this.fillSelectField(element as HTMLSelectElement, value);
    } else {
      this.fillInputField(element as HTMLInputElement | HTMLTextAreaElement, value);
    }

    // 等待一小段时间，确保事件处理完成
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (this.controlHasValue(element, value)) return true;

    // 写入被受控组件回滚：Moka 的学校/专业等是"搜索式下拉框"，
    // 纯文本写入不生效，必须点开下拉并选中选项。回退到自定义下拉适配器。
    if (element instanceof HTMLInputElement && !element.readOnly) {
      const opened = await this.fillCustomSelectField(element, value);
      if (opened) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return this.controlHasValue(element, value);
      }
    }
    return this.controlHasValue(element, value);
  }

  private async fillChoiceField(element: HTMLInputElement, value: string): Promise<boolean> {
    const matches = this.choiceMatchesValue(element, value);
    const desiredBoolean = this.parseBooleanValue(value);

    if (element.type === 'radio' && !matches) return false;
    if (element.type === 'checkbox' && !matches && desiredBoolean === null) return false;

    const shouldCheck = matches || desiredBoolean === true;
    if (element.checked !== shouldCheck) {
      // click() 最接近真实用户操作，能让 React/Vue 组件自己的事件链先接管。
      element.click();
      await this.wait(30);
    }

    if (element.checked !== shouldCheck) {
      const view = element.ownerDocument.defaultView || window;
      const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'checked')?.set;
      if (setter) setter.call(element, shouldCheck);
      else element.checked = shouldCheck;
      this.triggerEvents(element);
      await this.wait(50);
    }

    return element.checked === shouldCheck;
  }

  private shouldAttemptChoice(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string
  ): boolean {
    if (element.tagName !== 'INPUT') return true;
    const input = element as HTMLInputElement;
    if (input.type !== 'checkbox' && input.type !== 'radio') return true;
    if (this.choiceMatchesValue(input, value)) return true;
    return input.type === 'checkbox' && this.parseBooleanValue(value) !== null;
  }

  private choiceMatchesValue(element: HTMLInputElement, value: string): boolean {
    const wanted = this.choiceAliases(value);
    const label = this.getChoiceLabel(element);
    const candidates = [
      element.value,
      element.getAttribute('data-value') || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      label,
    ].flatMap(candidate => this.choiceAliases(candidate));

    return wanted.some(expected => candidates.some(candidate => {
      if (candidate === expected) return true;
      // 已知选项词（男/女、是/否等）必须完整相等：
      // 否则 'male' ⊂ 'female'、'man' ⊂ 'woman' 这类包含关系会造成反向误选。
      if (this.isKnownChoiceWord(candidate) && this.isKnownChoiceWord(expected)) return false;
      return ((expected.length >= 2 || /[\u3400-\u9fff]/.test(expected)) && candidate.includes(expected))
        || (candidate.length >= 2 && expected.includes(candidate));
    }));
  }

  private isKnownChoiceWord(value: string): boolean {
    const normalized = this.normalizeChoiceText(value);
    return [
      '男', 'male', 'm', 'man', '先生',
      '女', 'female', 'f', 'woman', '女士',
      '是', 'yes', 'true', '1', '有', '同意',
      '否', 'no', 'false', '0', '无', '不同意',
    ].includes(normalized);
  }

  private getChoiceLabel(element: HTMLInputElement): string {
    const document = element.ownerDocument;
    const explicit = element.id
      ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent
      : '';
    return (
      explicit
      || element.closest('label')?.textContent
      || element.parentElement?.textContent
      || ''
    ).trim();
  }

  private choiceAliases(value: string): string[] {
    const normalized = this.normalizeChoiceText(value);
    if (!normalized || normalized === 'on') return [];
    if (['男', 'male', 'm', 'man', '先生'].includes(normalized)) {
      return ['男', 'male', 'm', 'man', '先生'];
    }
    if (['女', 'female', 'f', 'woman', '女士'].includes(normalized)) {
      return ['女', 'female', 'f', 'woman', '女士'];
    }
    if (['是', 'yes', 'true', '1', '有', '同意'].includes(normalized)) {
      return ['是', 'yes', 'true', '1', '有', '同意'];
    }
    if (['否', 'no', 'false', '0', '无', '不同意'].includes(normalized)) {
      return ['否', 'no', 'false', '0', '无', '不同意'];
    }
    return [normalized];
  }

  private normalizeChoiceText(value: string): string {
    return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  private parseBooleanValue(value: string): boolean | null {
    const normalized = this.normalizeChoiceText(value);
    if (['是', 'yes', 'true', '1', '有', '同意'].includes(normalized)) return true;
    if (['否', 'no', 'false', '0', '无', '不同意'].includes(normalized)) return false;
    return null;
  }

  private controlHasValue(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string
  ): boolean {
    if (element.tagName === 'SELECT') {
      const select = element as HTMLSelectElement;
      const selectedText = select.options[select.selectedIndex]?.text || '';
      return this.valuesEquivalent(select.value, value) || this.valuesEquivalent(selectedText, value);
    }
    if (element instanceof HTMLInputElement && this.isCustomSelectInput(element)) {
      const trigger = this.getCustomSelectTrigger(element);
      const selectedText = [
        element.value,
        trigger?.getAttribute('aria-label') || '',
        trigger?.textContent || '',
      ].join(' ');
      return this.valuesEquivalent(selectedText, value);
    }
    return element.value === value;
  }

  private valuesEquivalent(actual: string, expected: string): boolean {
    const left = this.normalizeComparableValue(actual);
    const right = this.normalizeComparableValue(expected);
    if (!left || !right) return false;
    if (left === right) return true;
    if (sameValueGroup(left, right)) return true;
    const numericLeft = left.match(/^0*(\d{1,4})$/)?.[1];
    const numericRight = right.match(/^0*(\d{1,4})$/)?.[1];
    if (numericLeft && numericRight) return Number(numericLeft) === Number(numericRight);
    return left.length >= 2 && right.length >= 2 && (left.includes(right) || right.includes(left));
  }

  private async fillCustomSelectField(element: HTMLInputElement, value: string): Promise<boolean> {
    const selector = this.getCustomSelectTrigger(element);
    if (!selector) return false;

    // 测试替身/非常规 DOM 可能缺少这些 API，统一按可缺省处理。
    const looseSelector = selector as HTMLElement & {
      scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
      click?: () => void;
    };
    looseSelector.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    await this.wait(100);
    looseSelector.click?.();
    await this.wait(350);

    const doc = element.ownerDocument;
    const looseDoc = doc as Omit<Document, 'querySelectorAll'> & { querySelectorAll?: Document['querySelectorAll'] };
    // §10.3：优先只在当前组件库对应的可见弹层里找选项，避免点到页面其它下拉框的同名选项。
    const popupSelector = this.getOpenPopupSelector(selector);
    const searchRoots: ParentNode[] = popupSelector && looseDoc.querySelectorAll
      ? Array.from(looseDoc.querySelectorAll<HTMLElement>(popupSelector))
      : [];
    const optionSelector = [
      '[role="option"]',
      '.ud__select__list__item',
      '.ant-select-item-option',
      '.el-select-dropdown__item',
      '.arco-select-option',
      '.semi-select-option',
      '[class*="select-option" i]',
      '[class*="selectOption" i]',
      '[class*="dropdown" i] [class*="option" i]',
    ].join(',');
    let options = searchRoots.flatMap(root => Array.from(root.querySelectorAll<HTMLElement>(optionSelector)))
      .filter(option => this.isVisibleOption(option));
    if (options.length === 0 && looseDoc.querySelectorAll) {
      // 弹层未识别时退回全文档搜索（旧行为），仍然要求唯一候选。
      options = Array.from(looseDoc.querySelectorAll<HTMLElement>(optionSelector))
        .filter(option => this.isVisibleOption(option));
    }
    if (options.length === 0 && looseDoc.querySelectorAll) {
      // 组件库选择器认不出的自研下拉：全文找显示文字与值完全相等的唯一可见节点。
      options = this.findExactTextOptions(doc, value);
    }

    const scored = options
      .map(option => ({ option, score: this.optionMatchScore(option.textContent || '', value) }))
      .filter(candidate => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    const bestScore = scored[0]?.score ?? 0;
    const topCandidates = scored.filter(candidate => candidate.score === bestScore);
    // §10.3：模糊包含类的多个候选无法唯一确定 → 不点击，保持空白并报告失败。
    if (bestScore === 0 || (topCandidates.length > 1 && bestScore < 95)) {
      this.clickSafely(doc.body);
      return false;
    }
    const target = topCandidates[0].option;

    if (!target) {
      this.clickSafely(element.ownerDocument.body);
      return false;
    }

    target.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    target.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    // 选项节点通常是 li/div/[role=option]；统一安全点击，避免命中 button 时触发默认提交。
    this.clickSafely(target);

    const reactKey = Object.keys(target).find(
      key => key.startsWith('__reactEventHandlers$') || key.startsWith('__reactProps$')
    );
    const handlers = reactKey ? (target as any)[reactKey] : null;
    if (typeof handlers?.onClick === 'function') {
      handlers.onClick({
        target,
        currentTarget: target,
        type: 'click',
        nativeEvent: new MouseEvent('click'),
        bubbles: true,
        cancelable: true,
        preventDefault: () => {},
        stopPropagation: () => {},
        isDefaultPrevented: () => false,
        isPropagationStopped: () => false,
        persist: () => {},
      });
    }

    await this.wait(150);
    return true;
  }

  private isCustomSelectInput(element: HTMLInputElement): boolean {
    if (element.getAttribute('role') === 'combobox') return true;
    return Boolean(element.closest(
      '.ud__select, .ant-select, .el-select, .arco-select, .semi-select, [class*="select" i], [class*="picker" i]',
    ));
  }

  private getCustomSelectTrigger(element: HTMLInputElement): HTMLElement | null {
    return element.closest<HTMLElement>(
      '.ud__select__selector, .ant-select-selector, .el-select, .arco-select-view, .semi-select, [role="combobox"], [class*="select" i], [class*="picker" i]',
    ) || element;
  }

  /**
   * 自研下拉兜底（方案 §10.3 匹配唯一候选）：
   * 只接受"全文唯一"的、显示文字与值完全相等的可见叶子节点；多个同名节点无法确定归属，宁可放弃。
   */
  private findExactTextOptions(doc: Document, value: string): HTMLElement[] {
    const expected = value.trim();
    if (!expected || expected.length > 20) return [];
    const leaves: HTMLElement[] = [];
    for (const node of Array.from(doc.querySelectorAll<HTMLElement>('*'))) {
      if ((node.textContent || '').trim() !== expected) continue;
      const hasSameTextChild = Array.from(node.children)
        .some(child => (child.textContent || '').trim() === expected);
      if (hasSameTextChild) continue;
      if (node.querySelector('input, textarea, select')) continue;
      if (!this.isVisibleOption(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.height > 80 || rect.width < 16) continue;
      leaves.push(node);
    }
    return leaves.length === 1 ? leaves : [];
  }

  /** 按触发器所属组件库确定弹层选择器；识别不出返回 null（退回全文档）。 */
  private getOpenPopupSelector(trigger: HTMLElement): string | null {
    const className = `${trigger.className || ''} ${(trigger.parentElement?.className || '')}`;
    if (/ud__select/.test(className)) return '.ud__select__list, .ud__select__dropdown';
    if (/ant-select/.test(className)) return '.ant-select-dropdown';
    if (/el-select/.test(className)) return '.el-select-dropdown';
    if (/arco-select/.test(className)) return '.arco-select-dropdown';
    if (/semi-select/.test(className)) return '.semi-select-popover, .semi-select-option-list';
    return null;
  }

  private isVisibleOption(option: HTMLElement): boolean {
    const style = (option.ownerDocument.defaultView || window).getComputedStyle(option);
    const rect = option.getBoundingClientRect();
    const text = (option.textContent || '').trim();
    return Boolean(text) && text.length <= 120 && rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  private optionMatchScore(actual: string, expected: string): number {
    const left = this.normalizeComparableValue(actual);
    const right = this.normalizeComparableValue(expected);
    if (!left || !right) return 0;
    if (left === right) return 100;
    const numericLeft = left.match(/^0*(\d{1,4})$/)?.[1];
    const numericRight = right.match(/^0*(\d{1,4})$/)?.[1];
    if (numericLeft && numericRight && Number(numericLeft) === Number(numericRight)) return 95;
    if (left.length >= 2 && right.length >= 2 && (left.includes(right) || right.includes(left))) return 70;
    return 0;
  }

  private normalizeComparableValue(value: string): string {
    return value.normalize('NFKC').toLowerCase().trim().replace(/[年月日号\s._/-]/g, '');
  }

  // 填充下拉框（§10.2）：先精确等价匹配；部分匹配必须唯一，否则不操作。
  private fillSelectField(element: HTMLSelectElement, value: string): void {
    const exactMatch = this.findSelectMatch(element, value);
    if (exactMatch >= 0) {
      element.selectedIndex = exactMatch;
      this.triggerEvents(element);
      return;
    }

    const partialMatches = this.collectPartialSelectMatches(element, value);
    // 找不到唯一选项就不操作，不能为了填写率选第一个相似项。
    if (partialMatches.length === 1) {
      element.selectedIndex = partialMatches[0];
      this.triggerEvents(element);
    }
  }

  private findSelectMatch(element: HTMLSelectElement, value: string): number {
    for (let i = 0; i < element.options.length; i++) {
      const option = element.options[i];
      if (this.valuesEquivalent(option.value, value) || this.valuesEquivalent(option.text, value)) {
        return i;
      }
    }
    return -1;
  }

  private collectPartialSelectMatches(element: HTMLSelectElement, value: string): number[] {
    const needle = this.normalizeComparableValue(value);
    if (!needle) return [];
    const matches: number[] = [];
    for (let i = 0; i < element.options.length; i++) {
      const option = element.options[i];
      const text = this.normalizeComparableValue(option.text);
      const optionValue = this.normalizeComparableValue(option.value);
      const textHit = text.length >= 2 && (text.includes(needle) || needle.includes(text));
      const valueHit = optionValue.length >= 2 && (optionValue.includes(needle) || needle.includes(optionValue));
      if (textHit || valueHit) matches.push(i);
    }
    return matches;
  }

  // 填充输入框
  private fillInputField(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ): void {
    const oldValue = element.value;

    // 使用原生 setter 设置值（兼容 React）
    const view = element.ownerDocument.defaultView || window;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      view.HTMLInputElement.prototype,
      'value'
    )?.set;

    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      view.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (element.tagName === 'INPUT' && nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else if (element.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
      nativeTextAreaValueSetter.call(element, value);
    } else {
      element.value = value;
    }

    // React 受控输入会用 _valueTracker 判断值是否变化。
    // 先把 tracker 保持为旧值，再触发事件，React 才会接受新值。
    const trackedElement = element as HTMLInputElement & {
      _valueTracker?: { setValue: (value: string) => void };
      [key: string]: any;
    };
    trackedElement._valueTracker?.setValue(oldValue);

    // 触发所有相关事件
    this.triggerEvents(element);
  }

  // 触发表单事件（兼容 React/Vue/Angular）
  private triggerEvents(element: HTMLElement): void {
    const view = element.ownerDocument.defaultView || window;
    const inputEvent = new view.Event('input', { bubbles: true, cancelable: true });
    element.dispatchEvent(inputEvent);
    this.triggerReactChange(element, inputEvent);

    const events = [
      new view.Event('change', { bubbles: true, cancelable: true }),
      new view.Event('blur', { bubbles: true, cancelable: true }),
      new view.KeyboardEvent('keydown', { bubbles: true, cancelable: true }),
      new view.KeyboardEvent('keyup', { bubbles: true, cancelable: true })
    ];

    events.forEach((event) => {
      element.dispatchEvent(event);
    });
  }

  private triggerReactChange(element: HTMLElement, nativeEvent: Event): void {
    const reactKey = Object.keys(element).find(
      key => key.startsWith('__reactEventHandlers$') || key.startsWith('__reactProps$')
    );
    const handlers = reactKey ? (element as any)[reactKey] : null;

    if (typeof handlers?.onChange !== 'function') return;

    handlers.onChange({
      target: element,
      currentTarget: element,
      type: 'change',
      nativeEvent,
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
      persist: () => {},
    });
  }

  // 上传简历文件
  async uploadResume(
    fileInput: HTMLInputElement,
    fileData: string,
    fileName: string
  ): Promise<void> {
    try {
      // 将 base64 转换为 Blob
      const blob = this.base64ToBlob(fileData);

      // 创建 File 对象
      const file = new File([blob], fileName, { type: blob.type });

      // 创建 DataTransfer 对象
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // 设置文件
      fileInput.files = dataTransfer.files;

      // 触发 change 事件
      this.triggerEvents(fileInput);

      console.log(`Resume uploaded: ${fileName}`);
    } catch (error) {
      console.error('Failed to upload resume:', error);
      throw error;
    }
  }

  // 将 base64 转换为 Blob
  private base64ToBlob(base64Data: string): Blob {
    // 提取 MIME 类型和数据
    const parts = base64Data.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const base64String = parts[1] || parts[0];

    // 解码 base64
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Blob([bytes], { type: mime });
  }
}
