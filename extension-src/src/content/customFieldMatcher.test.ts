import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnmatchedField } from './formDetector.ts';
import { matchCustomInformationFields } from './customFieldMatcher.ts';

function field(labelText: string, name = ''): UnmatchedField {
  return {
    element: {} as HTMLInputElement,
    identifiers: {
      name,
      id: '',
      placeholder: '',
      labelText,
      type: 'text',
      autocomplete: '',
    },
  };
}

test('普通快速填充可按自定义信息名称匹配网页字段', () => {
  const [matched] = matchCustomInformationFields(
    [field('期望薪资（税前） *')],
    [{ id: 'salary', name: '期望薪资', content: '20k-25k' }],
  );

  assert.equal(matched?.fieldType, 'custom:salary');
  assert.equal(matched?.profileValue, '20k-25k');
});

test('过短或无关的自定义名称不会误匹配', () => {
  assert.deepEqual(
    matchCustomInformationFields(
      [field('毕业学校')],
      [
        { id: 'short', name: '学', content: '错误值' },
        { id: 'salary', name: '期望薪资', content: '20k-25k' },
      ],
    ),
    [],
  );
});

