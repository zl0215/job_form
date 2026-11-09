import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserProfile } from './types.ts';
import {
  DEFAULT_MODULE_PRESETS,
  PERSONAL_FIELD_PRESETS,
  prepareProfilePresets,
} from './profilePresets.ts';

function emptyProfile(): UserProfile {
  return {
    personal: { name: '', gender: '', birthDate: '', phone: '', email: '' },
    education: [],
    experience: [],
    projects: [],
    awards: [],
    customInformation: [],
    customModules: [],
    skills: [],
    certifications: [],
  };
}

test('首次准备资料时补齐常用个人字段与一级常用模块', () => {
  const prepared = prepareProfilePresets(emptyProfile());

  assert.equal(prepared.personal.customFields?.length, PERSONAL_FIELD_PRESETS.length);
  assert.deepEqual(
    prepared.customModules?.map(module => module.name),
    DEFAULT_MODULE_PRESETS.map(module => module.name),
  );
  assert.ok(prepared.customModules?.every(module => module.records.length === 1));
});

test('再次准备时保留用户填写值、自建字段并恢复固定的一级模块顺序', () => {
  const first = prepareProfilePresets(emptyProfile());
  const height = first.personal.customFields?.find(field => field.name === '身高');
  assert.ok(height);
  height.value = '175';
  first.personal.customFields?.push({
    id: 'mine',
    name: '我自己的字段',
    value: '保留我',
    type: 'text',
    aliases: [],
    allowAI: true,
    sensitive: false,
  });

  const family = first.customModules?.find(module => module.presetKey === 'family');
  assert.ok(family);
  first.customModules = [
    family,
    ...(first.customModules || []).filter(module => module.id !== family.id),
    { id: 'mine-module', name: '我的模块', repeatable: false, records: [{ id: 'mine-record', fields: [] }] },
  ];

  const prepared = prepareProfilePresets(first);
  assert.equal(prepared.personal.customFields?.find(field => field.name === '身高')?.value, '175');
  assert.equal(prepared.personal.customFields?.find(field => field.id === 'mine')?.value, '保留我');
  assert.equal(prepared.customModules?.[0].presetKey, 'campus');
  assert.equal(prepared.customModules?.at(-1)?.id, 'mine-module');
});

test('旧版本中同名模块会升级而不是重复添加', () => {
  const source = emptyProfile();
  source.customModules = [{
    id: 'old-family',
    name: '家庭成员',
    repeatable: true,
    records: [{ id: 'old-record', fields: [] }],
  }];

  const prepared = prepareProfilePresets(source);
  const familyModules = prepared.customModules?.filter(module => module.name === '家庭成员') || [];
  assert.equal(familyModules.length, 1);
  assert.equal(familyModules[0].id, 'old-family');
  assert.equal(familyModules[0].presetKey, 'family');
});

test('家庭敏感字段默认不允许发送给 AI', () => {
  const prepared = prepareProfilePresets(emptyProfile());
  const familyFields = prepared.customModules
    ?.find(module => module.presetKey === 'family')
    ?.records[0].fields || [];

  assert.ok(familyFields.length > 0);
  assert.ok(familyFields.every(field => field.sensitive && !field.allowAI));
});

test('旧版内置职业资格证书模块不再保留', () => {
  const source = emptyProfile();
  source.customModules = [{
    id: 'old-certificates',
    presetKey: 'certificates',
    name: '职业资格 / 证书',
    repeatable: true,
    records: [{ id: 'old-record', fields: [] }],
  }];
  const prepared = prepareProfilePresets(source);
  assert.equal(prepared.customModules?.some(module => module.presetKey === 'certificates'), false);
});

test('旧版简易专业技能会显示在新的专业技能明细模块中', () => {
  const source = emptyProfile();
  source.skills = ['Java', 'Spring Boot'];
  const prepared = prepareProfilePresets(source);
  const skills = prepared.customModules?.find(module => module.presetKey === 'skills');
  assert.deepEqual(
    skills?.records.map(record => record.fields.find(field => field.presetKey === 'module.skills.name')?.value),
    ['Java', 'Spring Boot'],
  );
});
