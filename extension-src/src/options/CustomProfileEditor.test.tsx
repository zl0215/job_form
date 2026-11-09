import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { ProfileCustomModule } from '../shared/types.ts';
import { CommonModulesEditor, CustomModulesEditor } from './CustomProfileEditor.tsx';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function module(id: string, name: string): ProfileCustomModule {
  return { id, name, repeatable: false, records: [{ id: `${id}-record`, fields: [] }] };
}

async function renderModules(initial: ProfileCustomModule[]) {
  let current = initial;
  let renderer!: TestRenderer.ReactTestRenderer;
  const render = () => <CustomModulesEditor modules={current} onChange={next => { current = next; }} />;
  await act(async () => { renderer = TestRenderer.create(render()); });
  return {
    renderer,
    current: () => current,
    refresh: async () => act(async () => { renderer.update(render()); }),
  };
}

test('添加模块模板功能保留且会加入所选模板', async () => {
  const env = await renderModules([module('first', '已有模块')]);
  const select = env.renderer.root.findByProps({ 'aria-label': '添加模块模板' });
  const event = { target: { value: 'books' } };

  await act(async () => { select.props.onChange(event); });

  assert.equal(env.current().length, 2);
  assert.equal(env.current()[1].name, '学术著作与教材');
  assert.equal(event.target.value, '');
});

test('没有自定义模块时区域保持空白并保留添加入口', async () => {
  const env = await renderModules([]);
  const text = env.renderer.root.findAllByType('div').flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ');
  assert.match(text, /还没有自定义模块/);
  assert.ok(env.renderer.root.findByProps({ 'aria-label': '添加模块模板' }));
});

test('一级常用模块可以折叠和展开且不显示排序操作', async () => {
  const common: ProfileCustomModule = {
    ...module('campus', '校园经历'),
    presetKey: 'campus',
    repeatable: true,
    records: [{ id: 'campus-record', fields: [{ id: 'org', presetKey: 'module.campus.organization', name: '组织名称', value: '', type: 'text', aliases: [], allowAI: true, sensitive: false }] }],
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<CommonModulesEditor modules={[common]} onChange={() => undefined} />); });
  assert.equal(renderer.root.findAllByType('button').some(item => ['上移', '下移'].includes(item.children.join(''))), false);
  assert.equal(renderer.root.findAllByType('input').length, 2);
  const collapse = renderer.root.findAllByType('button').find(item => item.children.join('') === '折叠');
  assert.ok(collapse);
  await act(async () => { collapse.props.onClick(); });
  assert.equal(renderer.root.findAllByType('input').length, 0);
  const expand = renderer.root.findAllByType('button').find(item => item.children.join('') === '展开');
  assert.ok(expand);
  await act(async () => { expand.props.onClick(); });
  assert.equal(renderer.root.findAllByType('input').length, 2);
});
