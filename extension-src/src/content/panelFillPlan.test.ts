import assert from 'node:assert/strict';
import test from 'node:test';
import { FormFiller } from './formFiller.ts';
import { FieldType } from '../shared/types.ts';
import { createEmptyUserProfile } from '../shared/resumeProfiles.ts';

// —— 最小 DOM 测试替身（行为贴近真实控件，仅覆盖填充链路用到的 API） ——

class FakeEvent {
  constructor(public type?: string, public init?: unknown) {}
}

class FakeControl {
  tagName = 'INPUT';
  type = 'text';
  disabled = false;
  isConnected = true;
  checked = false;
  readOnly = false;
  id = '';
  clickCount = 0;
  attributes: Record<string, string> = {};
  parentElement: { textContent: string; parentElement?: unknown; children?: unknown[] } | null = null;
  ownerDocument: {
    defaultView: unknown;
    body: unknown;
    querySelector: () => null;
    querySelectorAll: () => FakeControl[];
  };

  constructor(type = 'text', attributes: Record<string, string> = {}) {
    this.type = type;
    this.attributes = attributes;
  }

  get value(): string {
    return this.attributes.__value ?? '';
  }

  set value(next: string) {
    this.attributes.__value = next;
  }

  getAttribute(name: string): string | null {
    if (name === 'type') return this.type;
    return this.attributes[name] ?? null;
  }

  closest(): null {
    return null;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 10, height: 10 };
  }

  dispatchEvent(): boolean {
    return true;
  }

  click(): void {
    this.clickCount += 1;
  }
}

Object.assign(globalThis, {
  HTMLInputElement: FakeControl,
  HTMLTextAreaElement: FakeControl,
  HTMLSelectElement: FakeControl,
  Event: FakeEvent,
  KeyboardEvent: FakeEvent,
});

let ownerDocumentCounter = 0;

function makeTextControl(options: {
  label?: string;
  value?: string;
  type?: string;
} = {}): FakeControl {
  const attributes: Record<string, string> = { type: options.type || 'text' };
  if (options.label) attributes['data-form-field-i18n-name'] = options.label;
  const control = new FakeControl(options.type || 'text', attributes);
  if (options.value !== undefined) control.value = options.value;
  control.parentElement = { textContent: options.label || '', children: [] };
  ownerDocumentCounter += 1;
  const fakeDocument = {
    defaultView: globalThis,
    body: {},
    querySelector: () => null,
    querySelectorAll: () => [] as FakeControl[],
  };
  control.ownerDocument = fakeDocument;
  return control;
}

function makeProfile() {
  const profile = createEmptyUserProfile();
  profile.personal.name = '张三';
  profile.personal.phone = '13800138000';
  profile.education = [
    {
      id: 'edu-1', school: '示例大学', major: '软件工程', degree: '本科',
      startDate: '2019-09', endDate: '2023-06',
    },
    {
      id: 'edu-2', school: '示例研究生院', major: '计算机技术', degree: '硕士',
      startDate: '2023-09', endDate: '2026-06',
    },
  ];
  profile.experience = [];
  return profile;
}

test('resolvePlan 预览值等于 fillForm 实际写入值（多段教育记录不串行）', async () => {
  const school1 = makeTextControl({ label: '学校名称' });
  const school2 = makeTextControl({ label: '学校名称' });
  const profile = makeProfile();
  const fields = [
    { element: school1 as unknown as HTMLInputElement, fieldType: FieldType.SCHOOL, confidence: 1 },
    { element: school2 as unknown as HTMLInputElement, fieldType: FieldType.SCHOOL, confidence: 1 },
  ];

  const filler = new FormFiller();
  const plan = filler.resolvePlan(fields, profile);
  assert.equal(plan.fields.length, 2);
  assert.equal(plan.fields[0].status, 'planned');
  assert.equal(plan.fields[0].value, '示例大学');
  assert.equal(plan.fields[0].profileLabel, '学校');
  assert.equal(plan.fields[1].value, '示例研究生院');
  // 预览不写 DOM、不点任何按钮。
  assert.equal(school1.value, '');
  assert.equal(school2.value, '');
  assert.equal(school1.clickCount, 0);
  assert.equal(school2.clickCount, 0);

  const result = await filler.fillForm(fields, profile);
  assert.equal(result.filled, 2);
  assert.equal(school1.value, plan.fields[0].value);
  assert.equal(school2.value, plan.fields[1].value);
});

test('选择性填充只写勾选字段，但计划值按全部字段索引解析（与预览一致）', async () => {
  const school1 = makeTextControl({ label: '学校名称' });
  const school2 = makeTextControl({ label: '学校名称' });
  const profile = makeProfile();
  const fields = [
    { element: school1 as unknown as HTMLInputElement, fieldType: FieldType.SCHOOL, confidence: 1 },
    { element: school2 as unknown as HTMLInputElement, fieldType: FieldType.SCHOOL, confidence: 1 },
  ];

  const filler = new FormFiller();
  const plan = filler.resolvePlan(fields, profile);
  // 只勾选第二段学校：仍应写入第二条记录（预览值 示例研究生院），不能错位成第一条。
  const execution = await filler.fillPlanSelected(plan, [school2 as unknown as HTMLInputElement], 2);

  assert.equal(school1.value, '');
  assert.equal(school2.value, '示例研究生院');
  assert.equal(execution.result.attempted, 1);
  assert.equal(execution.result.filled, 1);
  assert.equal(execution.undoAvailable, true);
  assert.equal(execution.details[0].outcome, 'filled');
  assert.equal(execution.details[0].plannedValue, '示例研究生院');
});

test('面板填充后撤销恢复原空白；用户手改过的字段撤销时跳过', async () => {
  const nameInput = makeTextControl({ label: '姓名' });
  const phoneInput = makeTextControl({ label: '手机号' });
  const profile = makeProfile();
  const fields = [
    { element: nameInput as unknown as HTMLInputElement, fieldType: FieldType.NAME, confidence: 1 },
    { element: phoneInput as unknown as HTMLInputElement, fieldType: FieldType.PHONE, confidence: 1 },
  ];

  const filler = new FormFiller();
  const plan = filler.resolvePlan(fields, profile);
  const execution = await filler.fillPlanSelected(
    plan,
    [nameInput as unknown as HTMLInputElement, phoneInput as unknown as HTMLInputElement],
    2,
  );
  assert.equal(execution.result.filled, 2);
  assert.equal(nameInput.value, '张三');
  assert.equal(phoneInput.value, '13800138000');

  // 用户在填充后手动改了手机号：撤销必须保留用户改后的值。
  phoneInput.value = '13900000000';
  const restore = await filler.undoPendingFill();

  assert.equal(nameInput.value, '');
  assert.equal(phoneInput.value, '13900000000');
  assert.equal(restore.restored, 1);
  assert.equal(restore.skipped, 1);
  assert.match(restore.entries.find(entry => entry.element === phoneInput)?.message || '', /手动修改/);
  assert.equal(filler.hasPendingUndo(), false);
});

test('撤销时节点脱离文档：跳过并报告，不误判成功', async () => {
  const nameInput = makeTextControl({ label: '姓名' });
  const profile = makeProfile();
  const fields = [
    { element: nameInput as unknown as HTMLInputElement, fieldType: FieldType.NAME, confidence: 1 },
  ];
  const filler = new FormFiller();
  const plan = filler.resolvePlan(fields, profile);
  await filler.fillPlanSelected(plan, [nameInput as unknown as HTMLInputElement], 1);
  assert.equal(nameInput.value, '张三');

  Object.defineProperty(nameInput, 'isConnected', { value: false, configurable: true });
  const restore = await filler.undoPendingFill();
  assert.equal(restore.skipped, 1);
  assert.equal(restore.restored, 0);
  assert.match(restore.entries[0].message || '', /脱离文档/);
});

test('已有内容/禁止字段的计划状态与预览值，不覆盖、不写入', async () => {
  const existingName = makeTextControl({ label: '姓名', value: '已有姓名' });
  const referral = makeTextControl({ label: '内推码' });
  const blankPhone = makeTextControl({ label: '手机号' });
  const profile = makeProfile();
  const fields = [
    { element: existingName as unknown as HTMLInputElement, fieldType: FieldType.NAME, confidence: 1 },
    { element: referral as unknown as HTMLInputElement, fieldType: FieldType.NAME, confidence: 1 },
    { element: blankPhone as unknown as HTMLInputElement, fieldType: FieldType.PHONE, confidence: 1 },
  ];

  const filler = new FormFiller();
  const plan = filler.resolvePlan(fields, profile);
  assert.equal(plan.fields[0].status, 'existing');
  assert.equal(plan.fields[0].value, null);
  assert.equal(plan.fields[1].status, 'blocked');
  assert.equal(plan.fields[2].status, 'planned');
  assert.equal(plan.fields[2].sensitive, true);

  const result = await filler.fillForm(fields, profile);
  assert.equal(existingName.value, '已有姓名');
  assert.equal(referral.value, '');
  assert.equal(blankPhone.value, '13800138000');
  assert.equal(result.skippedExisting, 1);
  assert.equal(result.skippedBlocked, 1);
  assert.equal(result.filled, 1);
});

test('安全模式默认不点击“添加/没有实习经历”', async () => {
  const filler = new FormFiller();
  const profile = makeProfile();
  const result = await filler.prepareDynamicSections(profile, 'all');
  assert.equal(result.allowAutoAddRows, false);
  assert.equal(result.clickedAdds, 0);
  assert.equal(result.clickedNoExperience, false);
  assert.equal(result.navigationDetected, false);
  // 显式开启但页面没有可识别的“添加”按钮时也不应报错/跳转。
  const enabled = await filler.prepareDynamicSections(profile, 'all', { allowAutoAddRows: true });
  assert.equal(enabled.clickedAdds, 0);
  assert.equal(enabled.navigationDetected, false);
});

test('日期范围组：预览按“先结束后开始”取同一记录，与实际写入值一致', async () => {
  // 构造两个 4 段日期范围组（教育经历两段），验证记录索引与年/月拆分。
  class FakeContainer {
    textContent = '教育经历 就读时间';
    parentElement: null = null;
    constructor(public inputs: FakeControl[], public order: number) {}
    compareDocumentPosition(other: FakeContainer): number {
      if (other === this) return 0;
      return this.order < other.order ? 4 : 2;
    }
    querySelectorAll(selector: string): FakeControl[] {
      assert.match(selector, /input/);
      return this.inputs;
    }
    getBoundingClientRect() {
      return { left: this.order * 500, top: 0, width: 500, height: 20 };
    }
  }

  function makeDateInput(container: FakeContainer, left: number): FakeControl {
    const control = makeTextControl({ label: `日期${left}` });
    control.parentElement = { textContent: '就读时间', children: [] };
    control.getBoundingClientRect = () => ({ left, top: 0, width: 20, height: 10 });
    (control as unknown as { closest: (selector: string) => FakeContainer | null }).closest = (
      selector: string,
    ) => (/start_end_time|起止时间/.test(selector) ? container : null);
    return control;
  }

  const groupAInputs = [0, 1, 2, 3].map(left => makeDateInput(null as unknown as FakeContainer, left));
  const groupA = new FakeContainer(groupAInputs, 0);
  for (const input of groupAInputs) {
    (input as unknown as { closest: (selector: string) => FakeContainer | null }).closest = (selector) => (
      /start_end_time|起止时间/.test(selector) ? groupA : null
    );
  }
  const groupBInputs = [0, 1, 2, 3].map(left => makeDateInput(groupA, left));
  const groupB = new FakeContainer(groupBInputs, 1);
  for (const input of groupBInputs) {
    (input as unknown as { closest: (selector: string) => FakeContainer | null }).closest = (selector) => (
      /start_end_time|起止时间/.test(selector) ? groupB : null
    );
  }

  // 替身里 ownerDocument.body 为 {}，容器父链到不了 body；给容器链补上终止哨兵。
  const profile = makeProfile();
  const fields = [
    ...groupAInputs.map(element => ({ element: element as unknown as HTMLInputElement, fieldType: FieldType.EDUCATION_START_DATE, confidence: 1 })),
    ...groupBInputs.map(element => ({ element: element as unknown as HTMLInputElement, fieldType: FieldType.GRADUATION_DATE, confidence: 1 })),
  ];

  // 需要让 Node.DOCUMENT_POSITION_FOLLOWING 可用。
  Object.assign(globalThis, { Node: { DOCUMENT_POSITION_FOLLOWING: 4 } });

  const filler = new FormFiller();
  const plan = filler.resolvePlan(fields, profile);
  const plannedValues = plan.fields.map(field => field.value);
  assert.deepEqual(plannedValues, ['2023', '6', '2019', '9', '2026', '6', '2023', '9']);
  // 预览不写 DOM。
  assert.equal([...groupAInputs, ...groupBInputs].every(input => input.value === ''), true);

  const result = await filler.fillForm(fields, profile);
  assert.equal(result.filled, 8);
  // 与预览一致：第二组（第二段教育）取 2023-09 ~ 2026-06。
  assert.deepEqual(groupAInputs.map(input => input.value), ['2019', '9', '2023', '6']);
  assert.deepEqual(groupBInputs.map(input => input.value), ['2023', '9', '2026', '6']);
});
