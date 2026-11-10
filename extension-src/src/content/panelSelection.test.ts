import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PanelField,
  PanelFieldFillResult,
  PanelFillSummary,
  PanelUndoResult,
  PanelUnmatchedField,
} from '../shared/types.ts';
import {
  PANEL_MASK_TEXT,
  applyPanelFillResults,
  chooseBooleanUndoRestore,
  chooseUndoRestore,
  countPanelFields,
  countPanelFillOutcomes,
  defaultPanelSelection,
  formatPanelFillSummary,
  formatPanelUndoSummary,
  groupPanelFields,
  groupUnmatchedFields,
  isFieldSelectable,
  maskPanelValue,
  panelOutcomeDisplay,
  panelSectionName,
  panelStatusLabel,
  panelUndoOutcomeDisplay,
  sectionSelectionState,
  selectSectionBlankFields,
  selectedFieldIdsInOrder,
  truncatePanelValue,
  updateFieldSelection,
} from './panelSelection.ts';

function makeField(overrides: Partial<PanelField> = {}): PanelField {
  return {
    id: 'frame-0:f1',
    frameId: 0,
    label: '姓名',
    section: 'personal',
    sectionName: '基本信息',
    type: 'text',
    status: 'blank',
    blank: true,
    currentValuePresent: false,
    plannedValue: '张三',
    profileLabel: '姓名',
    sensitive: false,
    writable: true,
    ...overrides,
  };
}

test('模块中文名：已知模块映射，未知模块回退到“其它表单”', () => {
  assert.equal(panelSectionName('personal'), '基本信息');
  assert.equal(panelSectionName('education'), '教育经历');
  assert.equal(panelSectionName('experience'), '实习经历');
  assert.equal(panelSectionName('projects'), '项目经历');
  assert.equal(panelSectionName('awards'), '奖项 / 荣誉');
  assert.equal(panelSectionName('other'), '其它表单');
  assert.equal(panelSectionName('unknown-section'), '其它表单');
});

test('groupPanelFields 按固定模块顺序分组，未知模块归入其它表单', () => {
  const fields = [
    makeField({ id: 'a', section: 'education', label: '学校' }),
    makeField({ id: 'b', section: 'personal', label: '姓名' }),
    makeField({ id: 'c', section: 'other', label: '备注' }),
    makeField({ id: 'd', section: 'personal', label: '手机号', sensitive: true }),
    makeField({ id: 'e', section: 'education', label: '专业', status: 'filled', blank: false, writable: false }),
  ];

  const groups = groupPanelFields(fields);
  assert.deepEqual(groups.map(group => group.section), ['personal', 'education', 'other']);
  assert.deepEqual(groups[0].fields.map(field => field.label), ['姓名', '手机号']);
  assert.equal(groups[0].selectableCount, 2);
  assert.equal(groups[1].selectableCount, 1);
  assert.equal(groups[1].fields.length, 2);
  assert.equal(groups[2].sectionName, '其它表单');
});

test('默认勾选只包含“空白 + 有计划值 + 可写”的字段', () => {
  const fields = [
    makeField({ id: 'blank-planned' }),
    makeField({ id: 'existing', status: 'filled', blank: false, writable: false }),
    makeField({ id: 'blocked', status: 'blocked', writable: false, plannedValue: '' }),
    makeField({ id: 'ambiguous', status: 'ambiguous', writable: false }),
    makeField({ id: 'blank-no-value', plannedValue: '' }),
    makeField({ id: 'blank-whitespace-value', plannedValue: '   ' }),
    makeField({ id: 'unmatched', status: 'unmatched', writable: false, plannedValue: '' }),
  ];

  assert.deepEqual(Array.from(defaultPanelSelection(fields)), ['blank-planned']);
  assert.equal(isFieldSelectable(fields[0]), true);
  assert.equal(isFieldSelectable(fields[1]), false);
  assert.equal(isFieldSelectable(fields[4]), false);
});

test('模块级全选只选中该模块的空白可填字段', () => {
  const fields = [
    makeField({ id: 'edu-1', section: 'education' }),
    makeField({ id: 'edu-2', section: 'education', status: 'filled', blank: false, writable: false }),
    makeField({ id: 'edu-3', section: 'education', plannedValue: '' }),
    makeField({ id: 'p-1', section: 'personal' }),
  ];

  assert.deepEqual(Array.from(selectSectionBlankFields(fields, 'education')), ['edu-1']);
  assert.deepEqual(Array.from(selectSectionBlankFields(fields, 'awards')), []);
});

test('勾选状态增删与按字段顺序输出 id', () => {
  const fields = [
    makeField({ id: 'frame-0:f1' }),
    makeField({ id: 'frame-0:f2' }),
    makeField({ id: 'frame-0:f3' }),
  ];
  let selected = new Set<string>();
  selected = updateFieldSelection(selected, 'frame-0:f3', true);
  selected = updateFieldSelection(selected, 'frame-0:f1', true);
  selected = updateFieldSelection(selected, 'frame-0:f3', false);

  assert.deepEqual(selectedFieldIdsInOrder(fields, selected), ['frame-0:f1']);
  assert.deepEqual(selectedFieldIdsInOrder(fields, new Set()), []);
});

test('模块勾选状态：全选 / 部分 / 未选；没有可填字段时视为未选', () => {
  const fields = [
    makeField({ id: 'a', section: 'education' }),
    makeField({ id: 'b', section: 'education' }),
    makeField({ id: 'c', section: 'awards', status: 'filled', blank: false, writable: false }),
  ];
  assert.equal(sectionSelectionState(fields, 'education', new Set()), 'none');
  assert.equal(sectionSelectionState(fields, 'education', new Set(['a'])), 'partial');
  assert.equal(sectionSelectionState(fields, 'education', new Set(['a', 'b'])), 'all');
  assert.equal(sectionSelectionState(fields, 'awards', new Set()), 'none');
});

test('敏感值遮罩：只有开启遮罩且有值时替换为 ••••', () => {
  assert.equal(maskPanelValue('13800138000', true, true), PANEL_MASK_TEXT);
  assert.equal(maskPanelValue('13800138000', true, false), '13800138000');
  assert.equal(maskPanelValue('张三', false, true), '张三');
  assert.equal(maskPanelValue('', true, true), '');
  assert.equal(PANEL_MASK_TEXT, '••••');
});

test('计划值截断：压平空白、超长加省略号、保留中文', () => {
  assert.equal(truncatePanelValue('  北京  大学 \n 计算机 '), '北京 大学 计算机');
  assert.equal(truncatePanelValue('短值', 10), '短值');
  assert.equal(truncatePanelValue('123456789012345', 6), '12345…');
  assert.equal(truncatePanelValue('', 6), '');
});

test('状态与结果文案映射', () => {
  assert.equal(panelStatusLabel('blank'), '空白可填');
  assert.equal(panelStatusLabel('filled'), '已有内容');
  assert.equal(panelStatusLabel('blocked'), '禁止填写');
  assert.equal(panelStatusLabel('ambiguous'), '无法确定');
  assert.equal(panelStatusLabel('unmatched'), '未识别');

  assert.deepEqual(panelOutcomeDisplay('filled'), { icon: '✓', label: '已填' });
  assert.deepEqual(panelOutcomeDisplay('failed'), { icon: '✕', label: '写入失败' });
  assert.deepEqual(panelUndoOutcomeDisplay('restored'), { icon: '↩', label: '已恢复' });
  assert.deepEqual(panelUndoOutcomeDisplay('skipped'), { icon: '·', label: '未恢复' });
});

test('countPanelFields / countPanelFillOutcomes 精确计数', () => {
  const fields = [
    makeField({ id: 'a', sensitive: true }),
    makeField({ id: 'b', status: 'filled', blank: false, writable: false }),
    makeField({ id: 'c', status: 'blocked', writable: false }),
    makeField({ id: 'd', status: 'ambiguous', writable: false }),
    makeField({ id: 'e', status: 'unmatched', writable: false, plannedValue: '' }),
  ];
  assert.deepEqual(countPanelFields(fields), {
    total: 5,
    selectable: 1,
    filled: 1,
    blocked: 1,
    ambiguous: 1,
    unmatched: 1,
    sensitive: 1,
  });

  const results: PanelFieldFillResult[] = [
    { fieldId: 'a', localId: 'a', frameId: 0, outcome: 'filled' },
    { fieldId: 'b', localId: 'b', frameId: 0, outcome: 'skipped-existing' },
    { fieldId: 'c', localId: 'c', frameId: 0, outcome: 'failed' },
    { fieldId: 'd', localId: 'd', frameId: 0, outcome: 'not-found' },
    { fieldId: 'e', localId: 'e', frameId: 0, outcome: 'filled' },
  ];
  assert.deepEqual(countPanelFillOutcomes(results), {
    filled: 2,
    'skipped-existing': 1,
    blocked: 0,
    ambiguous: 0,
    failed: 1,
    'not-found': 1,
  });
});

function makeSummary(overrides: Partial<PanelFillSummary> = {}): PanelFillSummary {
  return {
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
    ...overrides,
  };
}

test('填充/撤销统计文案只汇报真实发生的事', () => {
  assert.equal(
    formatPanelFillSummary(makeSummary({
      filled: 3,
      skippedExisting: 1,
      failed: 2,
      notFound: 1,
    })),
    '成功填写 3 项；跳过已有内容 1 项；2 项未能写入；1 项页面已变化',
  );
  assert.equal(formatPanelFillSummary(makeSummary()), '所选字段没有可写入的空白内容');
  assert.match(
    formatPanelFillSummary(makeSummary({ filled: 1, urlChanged: true, autoAddedRows: 2 })),
    /自动补齐经历行 2 行/,
  );

  const undoSkipped: PanelUndoResult = {
    restored: 2,
    skipped: 1,
    failed: 0,
    entries: [],
    frames: [],
  };
  assert.equal(formatPanelUndoSummary(undoSkipped), '已恢复 2 项；1 项未恢复');
  assert.equal(formatPanelUndoSummary({ restored: 0, skipped: 0, failed: 0, entries: [], frames: [] }), '没有可撤销的字段');
});

test('撤销决策：当前值仍是写入值才恢复，用户改过则跳过', () => {
  assert.equal(
    chooseUndoRestore({ previousValue: '', writtenValue: '张三', currentValue: '张三' }),
    'restore',
  );
  assert.equal(
    chooseUndoRestore({ previousValue: '原值', writtenValue: '新值', currentValue: '原值' }),
    'already-restored',
  );
  assert.equal(
    chooseUndoRestore({ previousValue: '', writtenValue: '张三', currentValue: '李四' }),
    'user-modified',
  );
  assert.equal(
    chooseBooleanUndoRestore({ previousChecked: false, writtenChecked: true, currentChecked: true }),
    'restore',
  );
  assert.equal(
    chooseBooleanUndoRestore({ previousChecked: false, writtenChecked: true, currentChecked: false }),
    'already-restored',
  );
  assert.equal(
    chooseBooleanUndoRestore({ previousChecked: false, writtenChecked: true, currentChecked: false })
      === 'already-restored',
    true,
  );
});

test('填充结果回写：已填/已有内容变 filled 且不可再勾选，其余保持原状态', () => {
  const fields = [
    makeField({ id: 'a' }),
    makeField({ id: 'b' }),
    makeField({ id: 'c', status: 'blocked', writable: false, plannedValue: '' }),
  ];
  const updated = applyPanelFillResults(fields, [
    { fieldId: 'a', outcome: 'filled' },
    { fieldId: 'b', outcome: 'skipped-existing' },
    { fieldId: 'c', outcome: 'blocked' },
  ]);

  assert.equal(updated[0].status, 'filled');
  assert.equal(updated[0].blank, false);
  assert.equal(updated[0].writable, false);
  assert.equal(updated[1].status, 'filled');
  assert.equal(updated[2].status, 'blocked');
  assert.equal(updated[2].writable, false);
});

test('未识别字段按模块分组，保持固定的模块顺序', () => {
  const unmatched: PanelUnmatchedField[] = [
    { id: '1', frameId: 0, label: '备注', section: 'other', sectionName: '其它表单', type: 'textarea', reason: '未识别', blank: true },
    { id: '2', frameId: 0, label: '班级', section: 'education', sectionName: '教育经历', type: 'text', reason: '资料中无对应值', blank: true },
    { id: '3', frameId: 0, label: '未知', section: 'awards', sectionName: '奖项 / 荣誉', type: 'text', reason: '未识别', blank: false },
  ];
  const groups = groupUnmatchedFields(unmatched);
  assert.deepEqual(groups.map(group => group.section), ['education', 'awards', 'other']);
  assert.equal(groups[0].fields[0].label, '班级');
});
