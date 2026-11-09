import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormFillResult } from '../content/formFiller.ts';
import type { PageFieldReport, PageFieldReportItem, MessageResponse } from '../shared/types.ts';
import type { LearnableProfileField } from '../shared/fieldLearning.ts';
import {
  FieldLearningPanel,
  describeFillSummary,
  fieldLearningOptionText,
  mergeFillResults,
  type FieldLearningPanelProps,
} from './App';

const learnableFields: LearnableProfileField[] = [
  { key: 'personal.phone', label: '本人手机号', scope: 'personal', scopeLabel: '个人基本', sensitive: false },
  { key: 'personal.idCard', label: '身份证号', scope: 'personal', scopeLabel: '个人基本', sensitive: true },
  { key: 'custom:lang', label: '英语水平', scope: 'module.m1', scopeLabel: '语言能力', sensitive: false },
];

const unmatchedItems: PageFieldReportItem[] = [
  {
    id: '0:0',
    label: '备用联络通道',
    suggestedAlias: '备用联络通道',
    section: '基本信息',
    module: '基本信息模块',
    type: 'text',
    options: [],
    reason: '没有唯一可靠规则',
    blank: true,
    learnable: true,
  },
  {
    id: '0:1',
    label: '请选择',
    suggestedAlias: '请选择',
    section: '其它表单',
    module: '',
    type: 'select',
    options: ['选项甲', '选项乙'],
    reason: '同一别名命中多个资料字段',
    blank: true,
    learnable: true,
  },
  {
    id: '0:2',
    label: '未命名字段',
    suggestedAlias: '',
    section: '其它表单',
    module: '',
    type: 'text',
    options: [],
    reason: '没有唯一可靠规则',
    blank: true,
    learnable: false,
  },
];

function reportFixture(overrides: Partial<PageFieldReport> = {}): PageFieldReport {
  return {
    detected: 6,
    matched: 2,
    unmatched: unmatchedItems,
    matchedFields: [
      { label: '姓名', targetLabel: '姓名' },
      { label: '手机号码', targetLabel: '本人手机号' },
    ],
    blocked: [{ label: '验证码', reason: '验证码' }],
    blockedCount: 1,
    frames: [],
    ...overrides,
  };
}

function renderPanel(overrides: Partial<FieldLearningPanelProps> = {}): string {
  const props: FieldLearningPanelProps = {
    report: reportFixture(),
    learnableFields,
    selections: {},
    savingItemId: '',
    hint: '',
    error: '',
    refilling: false,
    refillSummary: '',
    disabled: false,
    open: true,
    onToggle: () => {},
    onSelect: () => {},
    onSave: () => {},
    onRefill: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(FieldLearningPanel, props));
}

test('本页字段对照：无未识别字段时整块不渲染（不出现空面板）', () => {
  const html = renderToStaticMarkup(React.createElement(FieldLearningPanel, {
    report: reportFixture({ unmatched: [] }),
    learnableFields,
    selections: {},
    savingItemId: '',
    hint: '',
    error: '',
    refilling: false,
    refillSummary: '',
    disabled: false,
    open: true,
    onToggle: () => {},
    onSelect: () => {},
    onSave: () => {},
    onRefill: () => {},
  }));
  assert.equal(html, '');
});

test('本页字段对照：展示折叠标题、未识别数量、字段标题/模块/类型/原因', () => {
  const html = renderPanel();
  assert.match(html, /本页字段对照/);
  assert.match(html, /3 个未识别/);
  assert.match(html, /备用联络通道/);
  assert.match(html, /基本信息/);
  assert.match(html, /没有唯一可靠规则/);
  assert.match(html, /页面选项：选项甲 \/ 选项乙/);
  assert.match(html, /aria-label="为“备用联络通道”选择对应的资料字段"/);
});

test('本页字段对照：下拉候选按 label/scope/key 展示，敏感字段带标注', () => {
  const html = renderPanel();
  assert.match(html, /本人手机号（个人基本 · personal\.phone）/);
  assert.match(html, /身份证号（个人基本 · personal\.idCard） 🔒敏感/);
  assert.match(html, /英语水平（语言能力 · custom:lang）/);
  // 下拉候选只展示字段身份，不包含任何资料值
  assert.doesNotMatch(html, /13800138000/);
  assert.doesNotMatch(html, /tester@example\.com/);

  assert.equal(
    fieldLearningOptionText(learnableFields[1]),
    '身份证号（个人基本 · personal.idCard） 🔒敏感',
  );
});

test('本页字段对照：选中敏感字段时给出本地匹配提示', () => {
  const html = renderPanel({ selections: { '0:0': 'personal.idCard' } });
  assert.match(html, /属于敏感资料，匹配只在本机完成，不会上传/);
});

test('本页字段对照：没有可用名称的字段不可学习', () => {
  const html = renderPanel();
  assert.match(html, /该字段没有可用的名称，无法记住/);
});

test('本页字段对照：已自动识别字段与禁止字段数量可见，但禁止字段不提供学习入口', () => {
  const html = renderPanel();
  assert.match(html, /已自动识别 2 个字段/);
  assert.match(html, /已自动识别：本人手机号/);
  assert.match(html, /另有 1 个禁止字段/);
  assert.doesNotMatch(html, /验证码（个人基本/);
});

test('本页字段对照：提供“重新填充空白字段”，折叠关闭时不渲染列表', () => {
  const open = renderPanel();
  assert.match(open, /重新填充空白字段/);
  const closed = renderPanel({ open: false });
  assert.doesNotMatch(closed, /重新填充空白字段/);
  assert.match(closed, /本页字段对照/);
  const refilling = renderPanel({ refilling: true });
  assert.match(refilling, /正在重新填充/);
  assert.match(refilling, /disabled=""/);
});

test('本页字段对照：保存反馈与错误反馈都会展示', () => {
  const saved = renderPanel({ hint: '已记住：备用联络通道 → “本人手机号”，下次自动填写' });
  assert.match(saved, /已记住/);
  const failed = renderPanel({ error: '“验证码”属于禁止自动填写的字段，不能记住' });
  assert.match(failed, /禁止自动填写/);
});

test('mergeFillResults 汇总多 frame 结果，全部失败时返回 null', () => {
  const frame = (data: FormFillResult): MessageResponse<FormFillResult> => ({ success: true, data });
  const merged = mergeFillResults([
    frame({ detected: 3, attempted: 2, filled: 2, failed: 0, skippedExisting: 1, skippedBlocked: 0, skippedAmbiguous: 0, skippedChoices: 1 }),
    frame({ detected: 2, attempted: 2, filled: 0, failed: 1, skippedExisting: 0, skippedBlocked: 2, skippedAmbiguous: 1, skippedChoices: 0 }),
    { success: false, error: 'no receiver' },
  ]);
  assert.ok(merged);
  assert.equal(merged!.detected, 5);
  assert.equal(merged!.filled, 2);
  assert.equal(merged!.failed, 1);
  assert.equal(merged!.skippedExisting, 1);
  assert.equal(merged!.skippedBlocked, 2);
  assert.equal(merged!.skippedAmbiguous, 1);
  assert.equal(merged!.skippedChoices, 1);
  assert.equal(mergeFillResults([{ success: false, error: 'no receiver' }]), null);
});

test('describeFillSummary 如实描述填充结果', () => {
  assert.equal(
    describeFillSummary({ detected: 2, attempted: 1, filled: 1, failed: 0 }),
    '已填 1 项空白字段',
  );
  assert.equal(
    describeFillSummary({
      detected: 2,
      attempted: 2,
      filled: 1,
      failed: 0,
      skippedExisting: 1,
      skippedBlocked: 2,
    }),
    '已填 1 项空白字段；跳过已有内容 1 项；禁止字段 2 项',
  );
  assert.equal(
    describeFillSummary({ detected: 1, attempted: 0, filled: 0, failed: 0 }),
    '没有需要重新填充的空白字段',
  );
});
