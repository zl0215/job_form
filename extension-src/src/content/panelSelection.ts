// 网页内悬浮面板的纯逻辑（无 DOM、无 chrome API）：
// 勾选默认值、模块分组、敏感遮罩、计划值截断、填充/撤销结果汇总。
// 放在这里是为了能在 node:test / tsx 下直接单测，面板 UI 只负责渲染。

import type {
  PanelField,
  PanelFieldFillResult,
  PanelFieldStatus,
  PanelFillOutcome,
  PanelFillSummary,
  PanelSection,
  PanelUndoOutcome,
  PanelUndoResult,
  PanelUnmatchedField,
} from '../shared/types.ts';

export const PANEL_SECTION_ORDER: PanelSection[] = [
  'personal',
  'education',
  'experience',
  'projects',
  'awards',
  'other',
];

const PANEL_SECTION_NAMES: Record<PanelSection, string> = {
  personal: '基本信息',
  education: '教育经历',
  experience: '实习经历',
  projects: '项目经历',
  awards: '奖项 / 荣誉',
  other: '其它表单',
};

export function panelSectionName(section: PanelSection | string): string {
  return PANEL_SECTION_NAMES[section as PanelSection] || PANEL_SECTION_NAMES.other;
}

export interface PanelFieldGroup {
  section: PanelSection;
  sectionName: string;
  fields: PanelField[];
  /** 组内可勾选（空白 + 有计划值）数量。 */
  selectableCount: number;
}

/** 按模块分组；未知模块落到“其它表单”，组顺序固定。 */
export function groupPanelFields(fields: PanelField[]): PanelFieldGroup[] {
  const groups = new Map<PanelSection, PanelField[]>();
  for (const field of fields) {
    const section = PANEL_SECTION_ORDER.includes(field.section) ? field.section : 'other';
    const current = groups.get(section) || [];
    current.push(field);
    groups.set(section, current);
  }
  return PANEL_SECTION_ORDER
    .filter(section => groups.has(section))
    .map(section => {
      const grouped = groups.get(section) || [];
      return {
        section,
        sectionName: panelSectionName(section),
        fields: grouped,
        selectableCount: grouped.filter(isFieldSelectable).length,
      };
    });
}

/** 可勾选填充：空白 + 有计划值 + 可写（非禁止/非冲突/未识别）。 */
export function isFieldSelectable(field: PanelField): boolean {
  return field.writable
    && field.blank
    && field.status === 'blank'
    && Boolean((field.plannedValue || '').trim());
}

/** 默认勾选：所有“空白 + 有可填计划值 + 非禁止/非冲突”的字段。 */
export function defaultPanelSelection(fields: PanelField[]): Set<string> {
  const selected = new Set<string>();
  for (const field of fields) {
    if (isFieldSelectable(field)) selected.add(field.id);
  }
  return selected;
}

/** 全选空白可填字段（忽略当前已勾选内容）。 */
export function selectAllBlankFields(fields: PanelField[]): Set<string> {
  return defaultPanelSelection(fields);
}

/** 模块级全选：只选中该模块内空白可填字段。 */
export function selectSectionBlankFields(fields: PanelField[], section: PanelSection): Set<string> {
  const selected = new Set<string>();
  for (const field of fields) {
    if (field.section === section && isFieldSelectable(field)) selected.add(field.id);
  }
  return selected;
}

/** 取反单个字段勾选状态。 */
export function updateFieldSelection(
  selected: ReadonlySet<string>,
  fieldId: string,
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  if (checked) next.add(fieldId);
  else next.delete(fieldId);
  return next;
}

/** 按字段顺序输出已勾选 id：保证填充消息顺序稳定、可复现。 */
export function selectedFieldIdsInOrder(
  fields: PanelField[],
  selected: ReadonlySet<string>,
): string[] {
  return fields.filter(field => selected.has(field.id)).map(field => field.id);
}

/** 模块级勾选状态：全部选中 / 部分选中 / 未选。 */
export function sectionSelectionState(
  fields: PanelField[],
  section: PanelSection,
  selected: ReadonlySet<string>,
): 'all' | 'partial' | 'none' {
  const selectable = fields.filter(field => field.section === section && isFieldSelectable(field));
  if (selectable.length === 0) return 'none';
  const selectedCount = selectable.filter(field => selected.has(field.id)).length;
  if (selectedCount === 0) return 'none';
  return selectedCount === selectable.length ? 'all' : 'partial';
}

export const PANEL_MASK_TEXT = '••••';

/** 敏感值遮罩：只有“敏感字段 + 开启遮罩 + 有值”才替换为 ••••。 */
export function maskPanelValue(
  value: string,
  sensitive: boolean,
  maskSensitive: boolean,
): string {
  const raw = value || '';
  if (!raw) return '';
  return sensitive && maskSensitive ? PANEL_MASK_TEXT : raw;
}

/** 面板内计划值截断：压平换行/空白，超长追加省略号。 */
export function truncatePanelValue(value: string, maxLength = 60): string {
  const flattened = (value || '').replace(/\s+/g, ' ').trim();
  if (flattened.length <= maxLength) return flattened;
  return `${flattened.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function panelStatusLabel(status: PanelFieldStatus): string {
  switch (status) {
    case 'blank': return '空白可填';
    case 'filled': return '已有内容';
    case 'blocked': return '禁止填写';
    case 'ambiguous': return '无法确定';
    default: return '未识别';
  }
}

export function panelOutcomeDisplay(outcome: PanelFillOutcome): { icon: string; label: string } {
  switch (outcome) {
    case 'filled': return { icon: '✓', label: '已填' };
    case 'skipped-existing': return { icon: '⏭', label: '跳过（已有内容）' };
    case 'blocked': return { icon: '🚫', label: '禁止字段' };
    case 'ambiguous': return { icon: '？', label: '无法确定' };
    case 'failed': return { icon: '✕', label: '写入失败' };
    default: return { icon: '⌕', label: '未找到（页面已变化）' };
  }
}

export function panelUndoOutcomeDisplay(
  outcome: PanelUndoOutcome,
): { icon: string; label: string } {
  switch (outcome) {
    case 'restored': return { icon: '↩', label: '已恢复' };
    case 'failed': return { icon: '✕', label: '恢复失败' };
    default: return { icon: '·', label: '未恢复' };
  }
}

export interface PanelFieldCounts {
  total: number;
  selectable: number;
  filled: number;
  blocked: number;
  ambiguous: number;
  unmatched: number;
  sensitive: number;
}

export function countPanelFields(fields: PanelField[]): PanelFieldCounts {
  const counts: PanelFieldCounts = {
    total: fields.length,
    selectable: 0,
    filled: 0,
    blocked: 0,
    ambiguous: 0,
    unmatched: 0,
    sensitive: 0,
  };
  for (const field of fields) {
    if (isFieldSelectable(field)) counts.selectable += 1;
    if (field.status === 'filled') counts.filled += 1;
    if (field.status === 'blocked') counts.blocked += 1;
    if (field.status === 'ambiguous') counts.ambiguous += 1;
    if (field.status === 'unmatched') counts.unmatched += 1;
    if (field.sensitive) counts.sensitive += 1;
  }
  return counts;
}

export function countPanelFillOutcomes(
  results: PanelFieldFillResult[],
): Record<PanelFillOutcome, number> {
  const counts: Record<PanelFillOutcome, number> = {
    filled: 0,
    'skipped-existing': 0,
    blocked: 0,
    ambiguous: 0,
    failed: 0,
    'not-found': 0,
  };
  for (const result of results) {
    if (result.outcome in counts) counts[result.outcome] += 1;
  }
  return counts;
}

/** 底部统计文案：只汇报真实发生的事。 */
export function formatPanelFillSummary(summary: PanelFillSummary): string {
  const parts: string[] = [];
  if (summary.filled) parts.push(`成功填写 ${summary.filled} 项`);
  if (summary.skippedExisting) parts.push(`跳过已有内容 ${summary.skippedExisting} 项`);
  if (summary.skippedBlocked) parts.push(`禁止字段 ${summary.skippedBlocked} 项`);
  if (summary.skippedAmbiguous) parts.push(`无法确定 ${summary.skippedAmbiguous} 项`);
  if (summary.failed) parts.push(`${summary.failed} 项未能写入`);
  if (summary.notFound) parts.push(`${summary.notFound} 项页面已变化`);
  if (summary.autoAddedRows) parts.push(`自动补齐经历行 ${summary.autoAddedRows} 行`);
  return parts.length ? parts.join('；') : '所选字段没有可写入的空白内容';
}

export function formatPanelUndoSummary(result: PanelUndoResult): string {
  const parts: string[] = [];
  if (result.restored) parts.push(`已恢复 ${result.restored} 项`);
  if (result.failed) parts.push(`${result.failed} 项恢复失败`);
  if (result.skipped) parts.push(`${result.skipped} 项未恢复`);
  return parts.length ? parts.join('；') : '没有可撤销的字段';
}

export type PanelUndoDecision = 'restore' | 'already-restored' | 'user-modified';

/**
 * 撤销前的安全判断：只有“当前值仍然等于本次填充写入的值”才恢复，
 * 用户填充后手动改过的字段绝不覆盖。
 */
export function chooseUndoRestore(args: {
  previousValue: string;
  writtenValue: string;
  currentValue: string;
}): PanelUndoDecision {
  const previous = args.previousValue || '';
  const written = args.writtenValue || '';
  const current = args.currentValue || '';
  if (current === previous) return 'already-restored';
  if (current === written) return 'restore';
  return 'user-modified';
}

export function chooseBooleanUndoRestore(args: {
  previousChecked: boolean;
  writtenChecked: boolean;
  currentChecked: boolean;
}): PanelUndoDecision {
  if (args.previousChecked === args.currentChecked) return 'already-restored';
  if (args.writtenChecked === args.currentChecked) return 'restore';
  return 'user-modified';
}

/** 填充结果回写到面板字段：已填/已有内容的状态刷新为 filled，并从可勾选中移除。 */
export function applyPanelFillResults(
  fields: PanelField[],
  results: Array<{ fieldId: string; outcome: PanelFillOutcome }>,
): PanelField[] {
  const outcomeById = new Map(results.map(result => [result.fieldId, result.outcome]));
  return fields.map(field => {
    const outcome = outcomeById.get(field.id);
    if (!outcome) return field;
    if (outcome === 'filled' || outcome === 'skipped-existing') {
      return {
        ...field,
        status: 'filled',
        blank: false,
        writable: false,
      };
    }
    return field;
  });
}

/** 未识别字段按模块分组（面板折叠区展示用）。 */
export function groupUnmatchedFields(
  fields: PanelUnmatchedField[],
): Array<{ section: PanelSection; sectionName: string; fields: PanelUnmatchedField[] }> {
  const groups = new Map<PanelSection, PanelUnmatchedField[]>();
  for (const field of fields) {
    const section = PANEL_SECTION_ORDER.includes(field.section) ? field.section : 'other';
    const current = groups.get(section) || [];
    current.push(field);
    groups.set(section, current);
  }
  return PANEL_SECTION_ORDER
    .filter(section => groups.has(section))
    .map(section => ({
      section,
      sectionName: panelSectionName(section),
      fields: groups.get(section) || [],
    }));
}
