import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserProfile } from './types.ts';
import { createEmptyUserProfile } from './resumeProfiles.ts';
import { buildProfileAnswerCandidates } from './profileAnswerCandidates.ts';
import { matchField, type FieldEvidence } from '../utils/fieldMatcher.ts';
import {
  LEARNED_ALIAS_MAX_LENGTH,
  addLearnedAlias,
  countLearnedAliases,
  describeFieldAliasError,
  isKnownProfileField,
  learnedAliasesForKey,
  normalizeLearnedAlias,
  suggestLearnedAlias,
  toLearnableProfileFields,
  truncateLearnedAlias,
  validateLearnedAlias,
} from './fieldLearning.ts';

function evidence(visibleLabel: string): FieldEvidence {
  return {
    visibleLabel,
    placeholder: '',
    name: '',
    id: '',
    autocomplete: '',
    moduleContext: '',
    rowContext: visibleLabel,
    inputType: 'text',
    controlKind: 'input',
  };
}

function profileWithPhone(): UserProfile {
  const profile = createEmptyUserProfile();
  profile.personal.name = '测试用户';
  profile.personal.phone = '13800138000';
  profile.personal.email = 'tester@example.com';
  return profile;
}

test('normalizeLearnedAlias 压缩空白并去首尾空格，保留原始大小写', () => {
  assert.equal(normalizeLearnedAlias('  备用  联络\u3000通道  '), '备用 联络 通道');
  assert.equal(normalizeLearnedAlias(''), '');
});

test('truncateLearnedAlias 按字符截断且默认上限 40', () => {
  assert.equal(LEARNED_ALIAS_MAX_LENGTH, 40);
  const long = '标'.repeat(50);
  assert.equal(Array.from(truncateLearnedAlias(long)).length, 40);
  assert.equal(truncateLearnedAlias('短标题'), '短标题');
});

test('suggestLearnedAlias 依次回退 label → placeholder → name，全部为空时返回空字符串', () => {
  assert.equal(suggestLearnedAlias({ label: ' 备用联络通道 ', placeholder: '请输入' }), '备用联络通道');
  assert.equal(suggestLearnedAlias({ label: '  ', placeholder: '请输入备用联络方式' }), '请输入备用联络方式');
  assert.equal(suggestLearnedAlias({ label: '', placeholder: '', name: 'backup_channel' }), 'backup_channel');
  assert.equal(suggestLearnedAlias({}), '');
});

test('validateLearnedAlias 接受普通标题并规范化空白', () => {
  const result = validateLearnedAlias('  备用  联络通道 ');
  assert.equal(result.ok, true);
  assert.equal(result.alias, '备用 联络通道');
});

test('validateLearnedAlias 拒绝空标题、超长标题与禁止字段', () => {
  assert.equal(validateLearnedAlias('   ').error, 'EMPTY_ALIAS');
  assert.equal(validateLearnedAlias('长'.repeat(41)).error, 'ALIAS_TOO_LONG');
  assert.equal(validateLearnedAlias('长'.repeat(40)).ok, true);

  const blockedLabels = ['验证码', '短信校验码', '确认密码', '登录密码', '内推码', '邀请码', '推荐码', '申请编号'];
  for (const label of blockedLabels) {
    const result = validateLearnedAlias(label);
    assert.equal(result.ok, false, label);
    assert.equal(result.error, 'BLOCKED_FIELD', label);
    assert.ok(result.blockedLabel, label);
  }
});

test('addLearnedAlias 新增别名并返回更新后的 key / 总数量，且不修改入参', () => {
  const overrides = { 'personal.phone': { added: ['手机号码'] } };
  const result = addLearnedAlias(overrides, 'education.school', '就读大学名称');

  assert.equal(result.ok, true);
  assert.equal(result.added, true);
  assert.equal(result.alreadyExists, false);
  assert.equal(result.keyAliasCount, 1);
  assert.equal(result.totalAliasCount, 2);
  assert.deepEqual(result.overrides['education.school']?.added, ['就读大学名称']);
  // 入参保持原样
  assert.deepEqual(overrides, { 'personal.phone': { added: ['手机号码'] } });
  assert.equal((overrides as Record<string, unknown>)['education.school'], undefined);
});

test('addLearnedAlias 去重：完全重复与空白/标点差异都视为已记住，不重复写入', () => {
  const first = addLearnedAlias(undefined, 'personal.phone', '备用联络通道');
  const second = addLearnedAlias(first.overrides, 'personal.phone', '备用联络通道');
  assert.equal(second.ok, true);
  assert.equal(second.added, false);
  assert.equal(second.alreadyExists, true);
  assert.deepEqual(second.overrides['personal.phone']?.added, ['备用联络通道']);

  const spaced = addLearnedAlias(second.overrides, 'personal.phone', ' 备用 联络通道 ');
  assert.equal(spaced.alreadyExists, true);
  assert.deepEqual(spaced.overrides['personal.phone']?.added, ['备用联络通道']);
});

test('addLearnedAlias 拒绝禁止字段：不写入任何 key，并给出可读原因', () => {
  const base = { 'personal.phone': { added: ['手机号码'] } };
  for (const label of ['验证码', '确认密码', '内推码']) {
    const result = addLearnedAlias(base, 'personal.phone', label);
    assert.equal(result.ok, false, label);
    assert.equal(result.added, false);
    assert.equal(result.error, 'BLOCKED_FIELD');
    assert.deepEqual(result.overrides, base);
    assert.match(describeFieldAliasError(result.error, result.blockedLabel), /禁止自动填写/);
  }
});

test('addLearnedAlias 拒绝缺少资料 key 的请求', () => {
  const result = addLearnedAlias(undefined, '   ', '备用联络通道');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'MISSING_PROFILE_KEY');
  assert.match(describeFieldAliasError(result.error), /请选择/);
});

test('跨 key 隔离：保存教育字段别名不会改动其它模块的已有别名', () => {
  const base = {
    'personal.phone': { added: ['手机号码'] },
    'project.name': { added: ['课题题目'] },
  };
  const result = addLearnedAlias(base, 'education.school', '就读大学名称');

  assert.deepEqual(result.overrides['personal.phone']?.added, ['手机号码']);
  assert.deepEqual(result.overrides['project.name']?.added, ['课题题目']);
  assert.deepEqual(result.overrides['education.school']?.added, ['就读大学名称']);
  assert.equal(learnedAliasesForKey(result.overrides, 'personal.phone').length, 1);
  assert.equal(countLearnedAliases(result.overrides), 3);
});

test('敏感字段允许学习：候选带 sensitive 标注，保存本身不受影响', () => {
  const profile = profileWithPhone();
  profile.personal.idCard = '110101199001010000';
  const fields = toLearnableProfileFields(profile);
  const idCard = fields.find(field => field.key === 'personal.idCard');
  assert.ok(idCard);
  assert.equal(idCard.sensitive, true);
  assert.equal(isKnownProfileField(profile, 'personal.idCard'), true);

  const result = addLearnedAlias(profile.fieldAliasOverrides, 'personal.idCard', '备用证件信息栏');
  assert.equal(result.ok, true);
  assert.equal(result.added, true);
});

test('下拉候选来自 buildProfileAnswerCandidates，按 key/label/scope 展示且不泄漏资料值', () => {
  const profile = profileWithPhone();
  profile.customInformation = [
    { id: 'ci1', name: '期望薪资', content: '面议-机密内容' },
  ];
  profile.customModules = [{
    id: 'm1',
    name: '语言能力',
    repeatable: false,
    records: [{
      id: 'r1',
      fields: [{
        id: 'f1',
        name: '英语水平',
        value: '流利-机密内容',
        type: 'text',
        aliases: [],
        allowAI: true,
        sensitive: false,
      }],
    }],
  }];

  const fields = toLearnableProfileFields(profile);
  const serialized = JSON.stringify(fields);
  assert.equal(serialized.includes('13800138000'), false);
  assert.equal(serialized.includes('tester@example.com'), false);
  assert.equal(serialized.includes('面议-机密内容'), false);
  assert.equal(serialized.includes('流利-机密内容'), false);

  const phone = fields.find(field => field.key === 'personal.phone');
  assert.ok(phone);
  assert.equal(phone.label, '本人手机号');
  assert.equal(phone.scope, 'personal');
  assert.equal(phone.scopeLabel, '个人基本');
  assert.equal(phone.sensitive, false);

  const legacy = fields.find(field => field.key === 'custom:ci1');
  assert.ok(legacy);
  assert.equal(legacy.label, '期望薪资');
  assert.equal(legacy.scope, 'custom');

  const moduleField = fields.find(field => field.key === 'custom:f1');
  assert.ok(moduleField);
  assert.equal(moduleField.scope, 'module.m1');
  assert.equal(moduleField.scopeLabel, '语言能力');
});

test('isKnownProfileField 拒绝不存在的资料 key', () => {
  const profile = profileWithPhone();
  assert.equal(isKnownProfileField(profile, 'personal.phone'), true);
  // 核心注册表字段即使当前资料没有值也仍是合法学习目标（等待资料补齐后生效）。
  assert.equal(isKnownProfileField(profile, 'education.school'), true);
  assert.equal(isKnownProfileField(profile, 'no.such.key'), false);
  assert.equal(isKnownProfileField(profile, ''), false);
});

test('保存后的别名进入候选别名列表，并能真正命中同名字段', () => {
  const profile = profileWithPhone();

  const beforeCandidates = buildProfileAnswerCandidates(profile, profile.fieldAliasOverrides);
  const before = matchField(evidence('备用联络通道'), { candidates: beforeCandidates });
  assert.notEqual(before.status, 'matched');

  const saved = addLearnedAlias(profile.fieldAliasOverrides, 'personal.phone', '备用联络通道');
  assert.equal(saved.ok, true);
  profile.fieldAliasOverrides = saved.overrides;

  const candidates = buildProfileAnswerCandidates(profile, profile.fieldAliasOverrides);
  const phone = candidates.find(candidate => candidate.key === 'personal.phone');
  assert.ok(phone);
  assert.ok(phone.aliases.includes('备用联络通道'));

  const after = matchField(evidence('备用联络通道'), {
    candidates,
    aliasOverrides: profile.fieldAliasOverrides,
  });
  assert.equal(after.status, 'matched');
  assert.equal(after.profileKey, 'personal.phone');
});
