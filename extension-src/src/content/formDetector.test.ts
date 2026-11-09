import assert from 'node:assert/strict';
import test from 'node:test';
import { FormDetector } from './formDetector.ts';
import { buildProfileAnswerCandidates } from '../shared/profileAnswerCandidates.ts';
import { createEmptyUserProfile } from '../shared/resumeProfiles.ts';
import type { DetectedField } from '../shared/types.ts';

// Node 环境缺少的浏览器全局：补齐最小 stub。
Object.assign(globalThis, {
  HTMLInputElement: class {},
  HTMLTextAreaElement: class {},
  HTMLSelectElement: class {},
  CSS: { escape: (value: string) => value },
});

// —— 最小 DOM 替身：模拟 Moka 风格的表单结构 ——

type FakeAttrs = Record<string, string>;

function fakeControl(options: {
  tag?: string;
  attrs?: FakeAttrs;
  id?: string;
  value?: string;
  readOnly?: boolean;
  disabled?: boolean;
  containerAttrs?: FakeAttrs;
  labelText?: string;
}): HTMLInputElement {
  const attrs: FakeAttrs = { ...(options.attrs || {}) };
  // 真实页面（Moka）的可见标题走 data-form-field-i18n-name，extractIdentifiers 只认它。
  if (options.labelText && !attrs['data-form-field-i18n-name']) {
    attrs['data-form-field-i18n-name'] = options.labelText;
  }
  const container = options.containerAttrs ? {
    getAttribute: (name: string) => options.containerAttrs?.[name] ?? null,
    querySelector: () => null,
    textContent: options.labelText || '',
  } : null;

  const control = {
    tagName: (options.tag || 'INPUT').toUpperCase(),
    id: options.id || '',
    value: options.value || '',
    disabled: Boolean(options.disabled),
    readOnly: Boolean(options.readOnly),
    offsetParent: {} as Element,
    type: attrs.type || 'text',
    attributes: attrs,
    parentElement: { textContent: options.labelText || '' },
    ownerDocument: {
      defaultView: globalThis,
      querySelector: () => null,
      getElementById: () => null,
      body: {},
    },
    getAttribute(name: string) {
      if (name === 'type') return attrs.type ?? null;
      return attrs[name] ?? null;
    },
    closest(selector: string) {
      if (container && selector.includes('data-form-field')) return container;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    previousElementSibling: null,
  } as unknown as HTMLInputElement;
  return control;
}

function withFakeDocument(controls: HTMLInputElement[], run: () => void) {
  const originalDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    querySelectorAll: (selector: string) => (
      selector === 'input, textarea, select' ? controls : []
    ),
    body: {},
  };
  try {
    run();
  } finally {
    (globalThis as { document?: unknown }).document = originalDocument;
  }
}

function profileWithNationality() {
  const profile = createEmptyUserProfile();
  profile.personal.name = '张三';
  profile.personal.phone = '13800000000';
  profile.personal.customFields = [{
    id: 'nationality-1',
    presetKey: 'personal.nationality',
    name: '国籍',
    value: '中国',
    type: 'single',
    aliases: ['国家', '国家/地区'],
    allowAI: true,
    sensitive: false,
  }];
  return profile;
}

test('FormDetector：label/容器标识/Moka 风格控件统一进入候选匹配', () => {
  const nameInput = fakeControl({
    attrs: { type: 'text' },
    id: 'userName',
    labelText: '姓名',
    containerAttrs: { 'data-form-field-name': 'userName' },
  });
  // Moka 风格：内部名 nationalityName + 可见标题"国籍"
  const nationalityInput = fakeControl({
    attrs: { type: 'text' },
    value: '',
    labelText: '国籍',
    containerAttrs: { 'data-form-field-name': 'nationalityName', 'data-form-field-i18n-name': '国籍' },
  });
  // Moka 风格：无 label，仅 placeholder
  const phoneInput = fakeControl({
    attrs: { type: 'text', placeholder: '请输入手机号码' },
    value: '',
  });

  const detector = new FormDetector();
  withFakeDocument([nameInput, nationalityInput, phoneInput], () => {
    const profile = profileWithNationality();
    const fields = detector.detectFields({
      candidates: buildProfileAnswerCandidates(profile),
    });

    const byElement = new Map<Element, DetectedField>(fields.map(field => [field.element, field]));

    const nameField = byElement.get(nameInput);
    assert.equal(nameField?.fieldType, 'name');

    const nationalityField = byElement.get(nationalityInput);
    assert.equal(nationalityField?.fieldType, 'custom:nationality-1');
    assert.equal(nationalityField?.profileValue, '中国');

    const phoneField = byElement.get(phoneInput);
    assert.equal(phoneField?.fieldType, 'phone');
  });
});

test('FormDetector：内推码进入 blocked 标记，不进入 unmatched，绝不参与填写', () => {
  const referralInput = fakeControl({
    attrs: { type: 'text' },
    value: 'EXISTING-CODE',
    labelText: '内推码',
    containerAttrs: { 'data-form-field-name': 'referralCode', 'data-form-field-i18n-name': '内推码' },
  });
  const normalInput = fakeControl({ labelText: '姓名' });

  const detector = new FormDetector();
  withFakeDocument([referralInput, normalInput], () => {
    const profile = profileWithNationality();
    const fields = detector.detectFields({
      candidates: buildProfileAnswerCandidates(profile),
    });

    const referralField = fields.find(field => field.element === referralInput);
    assert.equal(referralField?.blocked, true);
    // blocked 不进入 unmatched，后续 AI/自定义匹配不可触碰
    assert.equal(detector.getUnmatchedFields().some(field => field.element === referralInput), false);
  });
});

test('FormDetector：同一别名命中两个自定义字段时标记 ambiguous', () => {
  const conflictInput = fakeControl({ labelText: '紧急联系电话' });
  const profile = createEmptyUserProfile();
  profile.personal.customFields = [
    { id: 'a', name: '字段A', value: 'A', type: 'text', aliases: ['紧急联系电话'], allowAI: true, sensitive: false },
    { id: 'b', name: '字段B', value: 'B', type: 'text', aliases: ['紧急联系电话'], allowAI: true, sensitive: false },
  ];

  const detector = new FormDetector();
  withFakeDocument([conflictInput], () => {
    const fields = detector.detectFields({
      candidates: buildProfileAnswerCandidates(profile),
    });
    assert.equal(fields[0]?.ambiguous, true);
  });
});

test('FormDetector：readonly 自定义下拉框（combobox）保留检测，普通 readonly 跳过', () => {
  const customSelect = fakeControl({
    attrs: { type: 'text', role: 'combobox' },
    readOnly: true,
    value: '',
    labelText: '学历',
  });
  const readonlyText = fakeControl({
    attrs: { type: 'text' },
    readOnly: true,
    value: '系统生成',
    labelText: '申请编号',
  });

  const detector = new FormDetector();
  withFakeDocument([customSelect, readonlyText], () => {
    const profile = profileWithNationality();
    detector.detectFields({
      candidates: buildProfileAnswerCandidates(profile),
    });
    // combobox readonly 进入检测结果（未匹配则进 unmatched，但不会被跳过）
    const seen = detector.getDetectedFields().some(field => field.element === customSelect)
      || detector.getUnmatchedFields().some(field => field.element === customSelect);
    assert.equal(seen, true);
    // 普通 readonly 完全跳过
    assert.equal(detector.getDetectedFields().some(field => field.element === readonlyText), false);
    assert.equal(detector.getUnmatchedFields().some(field => field.element === readonlyText), false);
  });
});
