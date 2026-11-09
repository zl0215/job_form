import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DatePartsInput } from './DatePartsInput.tsx';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('年月日只能通过三个下拉框选择并输出规范日期', async () => {
  let next = '';
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<DatePartsInput value="2002-09-06" precision="day" onChange={value => { next = value; }} />); });
  const selects = renderer.root.findAllByType('select');
  assert.equal(selects.length, 3);
  assert.deepEqual(selects.map(select => select.props.value), ['2002', '9', '6']);
  await act(async () => { selects[1].props.onChange({ target: { value: '6' } }); });
  assert.equal(next, '2002-06-06');
});

test('仅年份字段也是下拉框，结束日期支持至今', async () => {
  let next = '';
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<DatePartsInput value="2027" precision="year" allowPresent onChange={value => { next = value; }} />); });
  assert.equal(renderer.root.findAllByType('select').length, 1);
  const checkbox = renderer.root.findByProps({ type: 'checkbox' });
  await act(async () => { checkbox.props.onChange({ target: { checked: true } }); });
  assert.equal(next, '至今');
});
