import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserProfile } from './types.ts';
import { collectCustomInformation, profileForAI, upgradeProfileCustomData } from './profileCustomFields.ts';

function profile(): UserProfile {
  return {
    personal: {
      name: '张三', gender: '男', birthDate: '2002-09-06', phone: '13800000000', email: 'a@example.com', idCard: 'secret-id',
      customFields: [
        { id: 'height', name: '身高', value: '175', unit: 'cm', type: 'number', aliases: ['身高(cm)'], allowAI: true, sensitive: false },
        { id: 'empty', name: '体重', value: '  ', unit: 'kg', type: 'number', aliases: [], allowAI: true, sensitive: false },
        { id: 'father', name: '父亲姓名', value: '张某', type: 'text', aliases: [], allowAI: false, sensitive: true },
      ],
    },
    education: [{ id: 'e1', school: '某大学', major: '软件工程', degree: '硕士', startDate: '2024-09', endDate: '2027-06', customFields: [] }],
    experience: [], projects: [], awards: [], customInformation: [], skills: [], certifications: [],
    customModules: [{
      id: 'paper', name: '科研与论文', repeatable: true,
      records: [{ id: 'p1', title: '论文一', fields: [
        { id: 'doi', name: 'DOI', value: '10.1000/test', type: 'text', aliases: ['论文DOI'], allowAI: true, sensitive: false },
      ] }],
    }],
  };
}

test('汇总现有模块和自定义模块字段并保留别名、单位', () => {
  const fields = collectCustomInformation(profile());
  assert.deepEqual(fields.map(field => [field.moduleName, field.name, field.content]), [
    ['个人基本信息', '身高', '175'],
    ['个人基本信息', '体重', '  '],
    ['个人基本信息', '父亲姓名', '张某'],
    ['科研与论文 论文一', 'DOI', '10.1000/test'],
  ]);
  assert.equal(fields[0].unit, 'cm');
  assert.deepEqual(fields[0].aliases, ['身高(cm)']);
});

test('发送给 AI 前移除身份证和禁止 AI 或敏感的字段', () => {
  const safe = profileForAI(profile());
  assert.equal(safe.personal.idCard, undefined);
  assert.deepEqual(safe.personal.customFields?.map(field => field.id), ['height']);
  assert.deepEqual(safe.customModules?.[0].records[0].fields.map(field => field.id), ['doi']);
});

test('旧版自定义信息迁移进其他信息模块且内容不丢失', () => {
  const source = profile();
  source.customModules = [];
  source.customInformation = [{ id: 'old', name: '血型', content: 'A型' }];
  const migrated = upgradeProfileCustomData(source);
  assert.equal(migrated.customInformation.length, 0);
  assert.equal(migrated.customModules?.[0].name, '其他信息');
  assert.deepEqual(migrated.customModules?.[0].records[0].fields[0], {
    id: 'old', name: '血型', value: 'A型', type: 'text', aliases: [], unit: undefined, allowAI: true, sensitive: false,
  });
});
