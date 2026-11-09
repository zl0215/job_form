import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmptyUserProfile,
  duplicateResumeProfile,
  isValidUserProfileInput,
  isValidFieldAliasOverrides,
  normalizeUserProfileData,
  normalizeResumeProfileLibrary,
} from './resumeProfiles.ts';
import type { UserProfile } from './types.ts';

function profileWithOverrides(): UserProfile {
  const profile = createEmptyUserProfile();
  profile.personal.name = '张三';
  profile.fieldAliasOverrides = {
    'personal.emergencyPhone': { added: ['应急联系电话'] },
    'education.school': { added: ['就读大学'] },
  };
  return profile;
}

test('isValidFieldAliasOverrides 接受合法结构，拒绝非法类型', () => {
  assert.equal(isValidFieldAliasOverrides(undefined), true);
  assert.equal(isValidFieldAliasOverrides({}), true);
  assert.equal(isValidFieldAliasOverrides({ 'personal.phone': { added: ['手机'] } }), true);
  assert.equal(isValidFieldAliasOverrides({ 'personal.phone': { added: [1, 2] } }), false);
  assert.equal(isValidFieldAliasOverrides({ 'personal.phone': '手机' }), false);
  assert.equal(isValidFieldAliasOverrides('nope'), false);
});

test('isValidUserProfileInput 接受带别名覆盖的资料', () => {
  assert.equal(isValidUserProfileInput(profileWithOverrides()), true);
  const broken = profileWithOverrides();
  (broken.fieldAliasOverrides as unknown) = { 'personal.phone': { added: '手机' } };
  assert.equal(isValidUserProfileInput(broken), false);
});

test('旧资料没有 fieldAliasOverrides 仍能加载', () => {
  const legacy = createEmptyUserProfile();
  assert.equal(isValidUserProfileInput(legacy), true);
  const normalized = normalizeUserProfileData(legacy);
  assert.equal(normalized.fieldAliasOverrides, undefined);
});

test('normalizeUserProfileData 规范化别名：trim、去空、去重', () => {
  const profile = createEmptyUserProfile();
  profile.fieldAliasOverrides = {
    'personal.phone': { added: ['  手机号码 ', '', '手机号码', '联系电话'] },
  };
  const normalized = normalizeUserProfileData(profile);
  assert.deepEqual(normalized.fieldAliasOverrides?.['personal.phone']?.added, ['手机号码', '联系电话']);

  // 全部为空时整个键被移除
  const empty = createEmptyUserProfile();
  empty.fieldAliasOverrides = { 'personal.phone': { added: ['  ', ''] } };
  assert.equal(normalizeUserProfileData(empty).fieldAliasOverrides, undefined);
});

test('别名覆盖跨资料深拷贝：修改副本不影响原资料', () => {
  const original = profileWithOverrides();
  const clone = normalizeUserProfileData(original);
  const cloneEmergency = clone.fieldAliasOverrides?.['personal.emergencyPhone'];
  cloneEmergency?.added.push('另一个别名');

  assert.deepEqual(
    original.fieldAliasOverrides?.['personal.emergencyPhone']?.added,
    ['应急联系电话'],
  );
});

test('复制简历后修改别名不会影响原简历', () => {
  const now = new Date().toISOString();
  const library = normalizeResumeProfileLibrary(null);
  const updated = {
    ...library,
    profiles: library.profiles.map(profile => ({
      ...profile,
      profile: profileWithOverrides(),
    })),
  };
  const duplicated = duplicateResumeProfile(updated, updated.profiles[0].id, now);
  const copy = duplicated.profiles.find(profile => profile.id !== updated.profiles[0].id)!;
  const copySchool = copy.profile.fieldAliasOverrides?.['education.school'];
  copySchool?.added.push('母校');

  const originalProfile = updated.profiles[0].profile;
  assert.deepEqual(originalProfile.fieldAliasOverrides?.['education.school']?.added, ['就读大学']);
});
