import assert from 'node:assert/strict';
import test from 'node:test';
import { FormFiller } from './formFiller.ts';
import { FieldType } from '../shared/types.ts';
import { createEmptyUserProfile } from '../shared/resumeProfiles.ts';
import { isControlBlank, isPlaceholderDisplayText } from './controlState.ts';
import { matchBlockedField } from '../shared/blockedFields.ts';

// —— 测试替身：行为贴近真实 DOM 的最小实现 ——

class FakeControl {
  tagName = 'INPUT';
  type = 'text';
  disabled = false;
  isConnected = true;
  checked = false;
  id = '';
  readOnly = false;
  files: Array<{ name: string }> = [];
  attributes: Record<string, string> = {};
  options: Array<{ text: string; value: string }> = [];
  selectedIndex = -1;
  parentElement: { textContent: string; parentElement?: unknown } | null = null;
  groupContainer: { querySelectorAll: (selector: string) => FakeControl[] } | null = null;
  ownerDocument = {
    defaultView: globalThis,
    querySelector: () => null,
    querySelectorAll: () => [] as FakeControl[],
    body: {},
  };

  constructor(attributes: Record<string, string> = {}) {
    this.attributes = attributes;
    if (attributes.type) this.type = attributes.type;
  }

  getAttribute(name: string): string | null {
    if (name === 'type') return this.type;
    return this.attributes[name] ?? null;
  }

  closest(): null {
    return null;
  }

  dispatchEvent(): boolean {
    return true;
  }

  click(): void {
    this.checked = !this.checked;
  }

  get value(): string {
    if (this.tagName === 'SELECT') return this.options[this.selectedIndex]?.value ?? '';
    return this.attributes.__value ?? '';
  }

  set value(next: string) {
    this.attributes.__value = next;
  }
}

// 全局 HTMLInputElement 指向替身，fillField 的 instanceof / 原型 setter 才能工作。
// Node 没有 Event/KeyboardEvent 构造器，补上空实现供 triggerEvents 构造事件对象。
class FakeEvent {}
Object.assign(globalThis, {
  HTMLInputElement: FakeControl,
  HTMLTextAreaElement: FakeControl,
  HTMLSelectElement: FakeControl,
  Event: FakeEvent,
  KeyboardEvent: FakeEvent,
});

function makeTextControl(options: {
  value?: string;
  label?: string;
  name?: string;
  type?: string;
  onEvent?: () => void;
} = {}): FakeControl {
  const control = new FakeControl({
    type: options.type || 'text',
    ...(options.name ? { name: options.name } : {}),
    // extractIdentifiers 从 data-form-field-i18n-name 读取可见标题。
    ...(options.label ? { 'data-form-field-i18n-name': options.label } : {}),
  });
  if (options.value !== undefined) control.value = options.value;
  if (options.onEvent) control.dispatchEvent = options.onEvent;
  control.parentElement = { textContent: options.label || '' };
  return control;
}

function makeRadio(options: {
  name: string;
  checked?: boolean;
  value?: string;
  label?: string;
  group?: FakeControl[];
} = {}): FakeControl {
  const control = new FakeControl({ type: 'radio', name: options.name, value: options.value || '' });
  control.checked = Boolean(options.checked);
  control.parentElement = { textContent: options.label || '' };
  if (options.group) {
    control.groupContainer = { querySelectorAll: () => options.group! };
    control.closest = (() => control.groupContainer) as FakeControl['closest'];
  }
  return control;
}

function makeSelect(options: {
  optionTexts: string[];
  selectedIndex: number;
  label?: string;
}): FakeControl {
  const control = new FakeControl({ type: 'select-one' });
  control.tagName = 'SELECT';
  control.options = options.optionTexts.map(text => ({ text, value: text }));
  control.selectedIndex = options.selectedIndex;
  control.parentElement = { textContent: options.label || '' };
  return control;
}

function makeCustomSelect(options: { displayText: string; value?: string }): FakeControl {
  const control = new FakeControl({ type: 'text', role: 'combobox' });
  control.value = options.value ?? '';
  const trigger = {
    querySelectorAll: () => [{ textContent: options.displayText }],
    textContent: options.displayText,
  };
  control.closest = (() => trigger) as FakeControl['closest'];
  return control;
}

// —— matchBlockedField 纯逻辑 ——

test('禁止字段表命中内推码/验证码/密码，但不会误伤普通字段', () => {
  assert.equal(matchBlockedField({ labelText: '内推码' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ labelText: '员工内推码（必填）' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ name: 'referralCode' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ name: 'invite_code' })?.category, 'invitation-code');
  assert.equal(matchBlockedField({ labelText: '短信验证码' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ name: 'captchaToken' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ labelText: '登录密码', type: 'password' })?.category, 'password');
  assert.equal(matchBlockedField({ name: 'confirmPassword' })?.category, 'password');

  // 相邻字段不得误伤
  assert.equal(matchBlockedField({ labelText: '姓名' }), null);
  assert.equal(matchBlockedField({ labelText: '手机号' }), null);
  assert.equal(matchBlockedField({ labelText: '推荐人姓名' }), null);
  assert.equal(matchBlockedField({ labelText: '推荐人电话' }), null);
  assert.equal(matchBlockedField({ name: 'subsystemId', labelText: '学院名称' }), null);
  assert.equal(matchBlockedField({ name: 'schoolCode', labelText: '学校编码（自编）' }), null);
});

test('isPlaceholderDisplayText 只吞占位文字，不吞真实值', () => {
  assert.equal(isPlaceholderDisplayText('请选择省份'), true);
  assert.equal(isPlaceholderDisplayText('请选择'), true);
  assert.equal(isPlaceholderDisplayText(''), true);
  assert.equal(isPlaceholderDisplayText('年'), true);
  assert.equal(isPlaceholderDisplayText('--'), true);
  assert.equal(isPlaceholderDisplayText('汉族'), false);
  assert.equal(isPlaceholderDisplayText('中华人民共和国'), false);
  assert.equal(isPlaceholderDisplayText('选择理论'), false);
});

// —— 已有内容保护：fillForm 写入层 ——

test('已有文本输入框不覆盖，计入 skippedExisting', async () => {
  const nameInput = makeTextControl({ value: '已有姓名', label: '姓名' });
  const profile = createEmptyUserProfile();
  profile.personal.name = '张三';

  const result = await new FormFiller().fillForm(
    [{ element: nameInput as unknown as HTMLInputElement, fieldType: FieldType.NAME, confidence: 1 }],
    profile,
  );

  assert.equal(nameInput.value, '已有姓名');
  assert.equal(result.skippedExisting, 1);
  assert.equal(result.attempted, 0);
  assert.equal(result.filled, 0);
});

test('空白姓名可以填写', async () => {
  const nameInput = makeTextControl({ value: '', label: '姓名' });
  const profile = createEmptyUserProfile();
  profile.personal.name = '张三';

  const result = await new FormFiller().fillForm(
    [{ element: nameInput as unknown as HTMLInputElement, fieldType: FieldType.NAME, confidence: 1 }],
    profile,
  );

  assert.equal(nameInput.value, '张三');
  assert.equal(result.filled, 1);
  assert.equal(result.skippedExisting, 0);
});

test('空白内推码也绝不填写，计入 skippedBlocked', async () => {
  const referralInput = makeTextControl({ value: '', label: '内推码', name: 'referralCode' });
  const profile = createEmptyUserProfile();

  const result = await new FormFiller().fillForm(
    [{ element: referralInput as unknown as HTMLInputElement, fieldType: FieldType.NAME, confidence: 1 }],
    profile,
  );

  assert.equal(referralInput.value, '');
  assert.equal(result.skippedBlocked, 1);
  assert.equal(result.attempted, 0);
});

test('已有内推码不覆盖：空白检查与禁止名单同时生效', async () => {
  const referralInput = makeTextControl({ value: 'EXISTING-CODE', label: '内推码', name: 'referralCode' });
  const profile = createEmptyUserProfile();

  const result = await new FormFiller().fillForm(
    [{ element: referralInput as unknown as HTMLInputElement, fieldType: FieldType.NAME, confidence: 1 }],
    profile,
  );

  assert.equal(referralInput.value, 'EXISTING-CODE');
  assert.equal(result.skippedBlocked, 1);
});

test('自定义字段匹配到内推码控件同样被禁止', async () => {
  const referralInput = makeTextControl({ value: '', label: '内推码', name: 'referralCode' });
  const profile = createEmptyUserProfile();

  const result = await new FormFiller().fillForm(
    [{
      element: referralInput as unknown as HTMLInputElement,
      fieldType: 'custom:some-id',
      confidence: 1,
      profileValue: '不该写入的值',
    }],
    profile,
  );

  assert.equal(referralInput.value, '');
  assert.equal(result.skippedBlocked, 1);
});

test('密码输入框不写入', async () => {
  const passwordInput = makeTextControl({ value: '', label: '登录密码', type: 'password' });
  const profile = createEmptyUserProfile();

  const result = await new FormFiller().fillForm(
    [{ element: passwordInput as unknown as HTMLInputElement, fieldType: FieldType.NAME, confidence: 1 }],
    profile,
  );

  assert.equal(result.skippedBlocked, 1);
  assert.equal(result.attempted, 0);
});

test('已选择的原生 select 不覆盖，空白 select 可以选择', async () => {
  const filledSelect = makeSelect({ optionTexts: ['请选择', '本科', '硕士'], selectedIndex: 1, label: '学历' });
  const blankSelect = makeSelect({ optionTexts: ['请选择', '本科', '硕士'], selectedIndex: 0, label: '学历' });
  const profile = createEmptyUserProfile();
  profile.education = [{
    id: 'edu-1', school: '示例大学', major: '软件工程', degree: '本科',
    startDate: '2019-09', endDate: '2023-06',
  }];

  const result = await new FormFiller().fillForm([
    { element: filledSelect as unknown as HTMLSelectElement, fieldType: FieldType.DEGREE, confidence: 1 },
    { element: blankSelect as unknown as HTMLSelectElement, fieldType: FieldType.DEGREE, confidence: 1 },
  ], profile);

  assert.equal(filledSelect.selectedIndex, 1);
  assert.equal(blankSelect.selectedIndex, 1);
  assert.equal(result.skippedExisting, 1);
  assert.equal(result.filled, 1);
});

test('radio 同组已有选中项时不覆盖整组', async () => {
  const male = makeRadio({ name: 'gender', value: '1', label: '男' });
  const female = makeRadio({ name: 'gender', value: '2', label: '女' });
  const group = [male, female];
  male.groupContainer = { querySelectorAll: () => group };
  male.closest = (() => male.groupContainer) as FakeControl['closest'];
  female.groupContainer = { querySelectorAll: () => group };
  female.closest = (() => female.groupContainer) as FakeControl['closest'];
  // 页面默认勾选了“女”，资料是“男”：不能翻转变成了男。
  female.checked = true;

  const profile = createEmptyUserProfile();
  profile.personal.gender = '男';

  const result = await new FormFiller().fillForm([
    { element: male as unknown as HTMLInputElement, fieldType: FieldType.GENDER, confidence: 1 },
    { element: female as unknown as HTMLInputElement, fieldType: FieldType.GENDER, confidence: 1 },
  ], profile);

  assert.equal(female.checked, true);
  assert.equal(male.checked, false);
  assert.equal(result.skippedExisting, 2);
  assert.equal(result.filled, 0);
});

test('空白 radio 组可以按资料勾选', async () => {
  const male = makeRadio({ name: 'gender', value: '1', label: '男' });
  const female = makeRadio({ name: 'gender', value: '2', label: '女' });
  const profile = createEmptyUserProfile();
  profile.personal.gender = '男';

  const result = await new FormFiller().fillForm([
    { element: male as unknown as HTMLInputElement, fieldType: FieldType.GENDER, confidence: 1 },
    { element: female as unknown as HTMLInputElement, fieldType: FieldType.GENDER, confidence: 1 },
  ], profile);

  assert.equal(male.checked, true);
  assert.equal(female.checked, false);
  assert.equal(result.filled, 1);
});

test('已有内容的自定义下拉框不覆盖', async () => {
  const schoolInput = makeCustomSelect({ displayText: '已选学校名称' });
  const profile = createEmptyUserProfile();
  profile.education = [{
    id: 'edu-1', school: '示例大学', major: '软件工程', degree: '本科',
    startDate: '2019-09', endDate: '2023-06',
  }];

  const result = await new FormFiller().fillForm(
    [{ element: schoolInput as unknown as HTMLInputElement, fieldType: FieldType.SCHOOL, confidence: 1 }],
    profile,
  );

  assert.equal(result.skippedExisting, 1);
  assert.equal(result.filled, 0);
});

test('检测时为空、写入前被页面回填的字段仍然跳过', async () => {
  let blankReads = 0;
  const control = makeTextControl({
    value: '',
    label: '手机号',
    onEvent: () => {},
  });
  // 第一次 isControlBlank（写入前第一道检查）读到空白；第二道检查前页面回填了值。
  Object.defineProperty(control, 'value', {
    get() {
      blankReads += 1;
      return blankReads >= 2 ? '13800000000' : '';
    },
    set(next: string) {
      control.attributes.__value = next;
    },
    configurable: true,
  });

  const profile = createEmptyUserProfile();
  profile.personal.phone = '13900000000';

  const result = await new FormFiller().fillForm(
    [{ element: control as unknown as HTMLInputElement, fieldType: FieldType.PHONE, confidence: 1 }],
    profile,
  );

  assert.equal(result.skippedExisting, 1);
  assert.equal(result.attempted, 0);
});

test('写入后被页面回滚必须计为 failed，不能计成功', async () => {
  const control = makeTextControl({
    value: '',
    label: '邮箱',
    onEvent: () => {
      // 模拟 React 受控组件拒绝写入：值被立即回滚。
      control.value = '';
    },
  });

  const profile = createEmptyUserProfile();
  profile.personal.email = 'me@example.com';

  const result = await new FormFiller().fillForm(
    [{ element: control as unknown as HTMLInputElement, fieldType: FieldType.EMAIL, confidence: 1 }],
    profile,
  );

  assert.equal(control.value, '');
  assert.equal(result.failed, 1);
  assert.equal(result.filled, 0);
});

test('已有内容的日期字段不覆盖', async () => {
  const endInput = makeTextControl({ value: '2023-06', label: '毕业时间' });
  const profile = createEmptyUserProfile();
  profile.education = [{
    id: 'edu-1', school: '示例大学', major: '软件工程', degree: '本科',
    startDate: '2019-09', endDate: '2023-06',
  }];

  const result = await new FormFiller().fillForm(
    [{ element: endInput as unknown as HTMLInputElement, fieldType: FieldType.GRADUATION_DATE, confidence: 1 }],
    profile,
  );

  assert.equal(endInput.value, '2023-06');
  assert.equal(result.skippedExisting, 1);
  assert.equal(result.filled, 0);
});

test('isControlBlank 对占位选项的原生 select 视为空白', () => {
  const blankSelect = makeSelect({ optionTexts: ['请选择省份', '北京', '上海'], selectedIndex: 0 });
  const chosenSelect = makeSelect({ optionTexts: ['请选择省份', '北京', '上海'], selectedIndex: 1 });
  assert.equal(isControlBlank(blankSelect as unknown as HTMLSelectElement), true);
  assert.equal(isControlBlank(chosenSelect as unknown as HTMLSelectElement), false);
});

// —— fillElementValues：AI/视觉链路也必须经过同样防线 ——

test('fillElementValues 跳过已有内容与禁止字段', async () => {
  const blankInput = makeTextControl({ value: '', label: '姓名' });
  const filledInput = makeTextControl({ value: '已有值', label: '手机号' });
  const referralInput = makeTextControl({ value: '', label: '内推码' });

  const filledCount = await new FormFiller().fillElementValues([
    { element: blankInput as unknown as HTMLInputElement, value: '张三' },
    { element: filledInput as unknown as HTMLInputElement, value: '13900000000' },
    { element: referralInput as unknown as HTMLInputElement, value: '不该写入' },
  ]);

  assert.equal(filledCount, 1);
  assert.equal(blankInput.value, '张三');
  assert.equal(filledInput.value, '已有值');
  assert.equal(referralInput.value, '');
});

test('写入目标已脱离文档时计为 failed（重渲染竞态），供自动补填兜底', async () => {
  const control = makeTextControl({ value: '', label: '主修课程' });
  // 模拟：页面在我们写入其它字段时重渲染，此节点已脱离文档。
  Object.defineProperty(control, 'isConnected', { value: false, configurable: true });

  const profile = createEmptyUserProfile();
  profile.education = [{
    id: 'edu-1', school: '示例大学', major: '软件工程', degree: '本科',
    startDate: '2019-09', endDate: '2023-06', customFields: [{
      id: 'core-1', presetKey: 'education.coreCourses', name: '主修课程', value: '光通信',
      type: 'textarea', aliases: [], allowAI: true, sensitive: false,
    }],
  }];

  const result = await new FormFiller().fillForm(
    [{ element: control as unknown as HTMLInputElement, fieldType: 'custom:core-1', confidence: 1, profileValue: '光通信' }],
    profile,
  );

  // 值写进了死节点，但页面不可见：必须计为 failed，不能计成功。
  assert.equal(result.filled, 0);
  assert.equal(result.failed, 1);
});
