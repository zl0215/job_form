import assert from 'node:assert/strict';
import test from 'node:test';
import { FormFiller } from './formFiller.ts';
import { FieldType } from '../shared/types.ts';
import { createEmptyUserProfile } from '../shared/resumeProfiles.ts';

class FakeInput {
  tagName = 'INPUT';
  disabled = false;
  isConnected = true;
  checked = false;
  id = '';
  parentElement: { textContent: string };
  ownerDocument = {
    defaultView: globalThis,
    querySelector: () => null,
  };

  constructor(
    public type: 'radio' | 'checkbox',
    public value: string,
    label: string,
  ) {
    this.parentElement = { textContent: label };
  }

  getAttribute(name: string): string | null {
    if (name === 'type') return this.type;
    return null;
  }

  closest(): null {
    return null;
  }

  click(): void {
    this.checked = !this.checked;
  }

  dispatchEvent(): boolean {
    return true;
  }
}

Object.assign(globalThis, {
  HTMLInputElement: FakeInput,
  HTMLTextAreaElement: class {},
  HTMLSelectElement: class {},
});

test('性别 radio 只点击与资料值匹配的选项，并按实际状态计数', async () => {
  const male = new FakeInput('radio', '1', '性别 男');
  const female = new FakeInput('radio', '2', '性别 女');
  const profile = createEmptyUserProfile();
  profile.personal.gender = '男';

  const result = await new FormFiller().fillForm([
    { element: male as unknown as HTMLInputElement, fieldType: FieldType.GENDER, confidence: 1 },
    { element: female as unknown as HTMLInputElement, fieldType: FieldType.GENDER, confidence: 1 },
  ], profile);

  assert.equal(male.checked, true);
  assert.equal(female.checked, false);
  assert.deepEqual(result, {
    detected: 2, attempted: 1, filled: 1, failed: 0,
    skippedExisting: 0, skippedBlocked: 0, skippedAmbiguous: 0,
  });
});

test('自定义“是/否”信息可以勾选 checkbox', async () => {
  const checkbox = new FakeInput('checkbox', 'on', '是否服从调剂');
  const profile = createEmptyUserProfile();

  const result = await new FormFiller().fillForm([
    {
      element: checkbox as unknown as HTMLInputElement,
      fieldType: 'custom:adjustment',
      confidence: 1,
      profileValue: '是',
    },
  ], profile);

  assert.equal(checkbox.checked, true);
  assert.equal(result.filled, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.skippedExisting, 0);
  assert.equal(result.skippedBlocked, 0);
});

