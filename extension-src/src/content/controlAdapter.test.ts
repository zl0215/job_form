import assert from 'node:assert/strict';
import test from 'node:test';
import { FormFiller } from './formFiller.ts';
import { FieldType } from '../shared/types.ts';
import { createEmptyUserProfile } from '../shared/resumeProfiles.ts';

// —— 最小 DOM 替身（原生 select 与可见性探测） ——

class FakeOption {
  constructor(public text: string, public value: string = text) {}
}

class FakeSelect {
  tagName = 'SELECT';
  disabled = false;
  isConnected = true;
  options: FakeOption[];
  selectedIndex = -1;
  attributes: Record<string, string> = {};
  parentElement = { textContent: '' };
  ownerDocument = { defaultView: globalThis, querySelector: () => null, body: {} };

  constructor(optionTexts: string[], selectedIndex = -1) {
    this.options = optionTexts.map(text => new FakeOption(text));
    this.selectedIndex = selectedIndex;
  }

  getAttribute(name: string): string | null {
    if (name === 'type') return 'select-one';
    return this.attributes[name] ?? null;
  }

  closest(): null {
    return null;
  }

  dispatchEvent(): boolean {
    return true;
  }

  get value(): string {
    return this.options[this.selectedIndex]?.value ?? '';
  }
}

// 全局可见性探测与事件构造（Node 环境缺省）
class FakeEvent {}
Object.assign(globalThis, {
  HTMLInputElement: class FakeInputBase {},
  HTMLTextAreaElement: class {},
  HTMLSelectElement: FakeSelect,
  Event: FakeEvent,
  KeyboardEvent: FakeEvent,
  MouseEvent: class {},
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
});

function makeSelectForProfile(optionTexts: string[], selectedIndex = -1): FakeSelect {
  const select = new FakeSelect(optionTexts, selectedIndex);
  // fillForm 的字段标识符需要可见标题
  select.attributes['data-form-field-i18n-name'] = '学历';
  return select;
}

test('§13.5 文本"汉族"可以选中网页下拉项"汉族"（场景D·原生select）', async () => {
  const select = makeSelectForProfile(['请选择民族', '汉族', '回族', '满族']);
  const profile = createEmptyUserProfile();
  profile.personal.customFields = [{
    id: 'ethnicity-1',
    presetKey: 'personal.ethnicity',
    name: '民族',
    value: '汉族',
    type: 'single',
    aliases: ['所属民族'],
    allowAI: true,
    sensitive: false,
  }];

  const result = await new FormFiller().fillForm(
    [{ element: select as unknown as HTMLSelectElement, fieldType: 'custom:ethnicity-1', confidence: 1, profileValue: '汉族' }],
    profile,
  );

  assert.equal(select.selectedIndex, 1);
  assert.equal(result.filled, 1);
});

test('§13.5 日期选项等价：6 / 06 / 6月 等价选择', async () => {
  const juneText = makeSelectForProfile(['请选择月份', '1月', '2月', '6月', '12月']);
  const juneZero = makeSelectForProfile(['请选择月份', '1', '06', '12']);
  const profile = createEmptyUserProfile();

  const filler = new FormFiller();
  // 资料里的月份值在不同站点写成 6 / 06 / 6月，选项等价后都应命中"6月"。
  await filler.fillForm(
    [{ element: juneText as unknown as HTMLSelectElement, fieldType: 'custom:month-a', confidence: 1, profileValue: '6' }],
    profile,
  );
  await filler.fillForm(
    [{ element: juneZero as unknown as HTMLSelectElement, fieldType: 'custom:month-b', confidence: 1, profileValue: '6月' }],
    profile,
  );

  assert.equal(juneText.selectedIndex, 3);   // '6' ↔ '6月'
  assert.equal(juneZero.selectedIndex, 2);   // '6月' ↔ '06'
});

test('§13.5 部分匹配唯一时才选择', async () => {
  const unique = makeSelectForProfile(['请选择', '软件工程', '计算机科学']);
  const ambiguous = makeSelectForProfile(['请选择', '计算机科学', '计算机科学与技术']);
  const profile = createEmptyUserProfile();
  profile.education = [{
    id: 'edu-1', school: '示例大学', major: '软件', degree: '本科',
    startDate: '2019-09', endDate: '2023-06',
  }];

  const filler = new FormFiller();
  await filler.fillForm(
    [{ element: unique as unknown as HTMLSelectElement, fieldType: FieldType.MAJOR, confidence: 1 }],
    profile,
  );
  await filler.fillForm(
    [{ element: ambiguous as unknown as HTMLSelectElement, fieldType: FieldType.MAJOR, confidence: 1 }],
    profile,
  );

  assert.equal(unique.selectedIndex, 1);     // '软件' 唯一命中 '软件工程'
  assert.equal(ambiguous.selectedIndex, -1); // '计算机科学' 命中两个选项 → 不选择
});

test('§10.4 国籍明确映射：资料"中国"可以选中"中华人民共和国"', async () => {
  const select = makeSelectForProfile(['请选择国籍', '美国', '中华人民共和国', '日本']);
  const profile = createEmptyUserProfile();
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

  const result = await new FormFiller().fillForm(
    [{ element: select as unknown as HTMLSelectElement, fieldType: 'custom:nationality-1', confidence: 1, profileValue: '中国' }],
    profile,
  );

  assert.equal(select.selectedIndex, 2);
  assert.equal(result.filled, 1);
});

test('§13.5 点击后回读不一致时计为失败（自定义下拉框）', async () => {
  // 自定义下拉框：点击选项后组件回滚显示文字，controlHasValue 校验失败 → failed。
  class FakeCustomSelect {
    tagName = 'INPUT';
    type = 'text';
    disabled = false;
    isConnected = true;
    value = '';
    attributes: Record<string, string> = { role: 'combobox' };
    options: Array<Record<string, unknown>> = [];
    selectedIndex = -1;
    parentElement = { textContent: '' };
    ownerDocument = {
      defaultView: globalThis,
      querySelector: () => null,
      querySelectorAll: (selector: string) => (
        selector.includes('ant-select-dropdown')
          ? [{
              textContent: '汉族',
              getBoundingClientRect: () => ({ width: 80, height: 30, left: 0, top: 0 }),
              querySelectorAll: () => [{
                textContent: '汉族',
                getBoundingClientRect: () => ({ width: 80, height: 30, left: 0, top: 0 }),
                dispatchEvent: () => true,
                click: () => {},
              }],
              dispatchEvent: () => true,
              click: () => {},
            } as unknown]
          : []
      ),
      getElementById: () => null,
      body: { click: () => {} },
    };

    getAttribute(name: string): string | null {
      if (name === 'type') return this.type;
      return this.attributes[name] ?? null;
    }

    closest(selector: string): HTMLElement | null {
      // 触发器是 ant-select 容器， className 命中 ant-select → 弹层限定 .ant-select-dropdown
      return (selector.includes('ant-select')
        ? { className: 'ant-select ant-select-single', parentElement: { className: '' }, textContent: '', click: () => {} }
        : null) as unknown as HTMLElement;
    }

    scrollIntoView(): void {}
    dispatchEvent(): boolean {
      return true;
    }
  }

  Object.assign(globalThis, { HTMLInputElement: FakeCustomSelect });
  const control = new FakeCustomSelect();
  control.options = control.ownerDocument.querySelectorAll('.ant-select-dropdown') as never;

  const profile = createEmptyUserProfile();
  profile.personal.customFields = [{
    id: 'ethnicity-1',
    presetKey: 'personal.ethnicity',
    name: '民族',
    value: '汉族',
    type: 'single',
    aliases: [],
    allowAI: true,
    sensitive: false,
  }];

  const result = await new FormFiller().fillForm(
    [{
      element: control as unknown as HTMLInputElement,
      fieldType: 'custom:ethnicity-1',
      confidence: 1,
      profileValue: '汉族',
    }],
    profile,
  );

  // 点击返回 true 但回读显示文字仍是空 → 组件没有接受 → 计为 failed
  assert.equal(result.filled, 0);
  assert.equal(result.failed, 1);
});
