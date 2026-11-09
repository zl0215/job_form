import assert from 'node:assert/strict';
import test from 'node:test';
import { matchBlockedField } from './blockedFields.ts';

test('永久禁止：内推/推荐/邀请码', () => {
  assert.equal(matchBlockedField({ labelText: '内推码' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ labelText: '内推编码' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ labelText: '内部推荐码（必填）' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ labelText: '员工内推码' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ labelText: '推荐码' })?.category, 'recommendation-code');
  assert.equal(matchBlockedField({ labelText: '推荐编码' })?.category, 'recommendation-code');
  assert.equal(matchBlockedField({ labelText: '推荐编号' })?.category, 'recommendation-code');
  assert.equal(matchBlockedField({ labelText: '推荐人编号' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ labelText: '邀请码' })?.category, 'invitation-code');
  assert.equal(matchBlockedField({ name: 'referralCode' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ name: 'employeeReferralCode' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ name: 'recommend_code' })?.category, 'recommendation-code');
  assert.equal(matchBlockedField({ name: 'invitationCode' })?.category, 'invitation-code');
  // 标题里的英文也参与复合词判断
  assert.equal(matchBlockedField({ labelText: 'Referral Code' })?.category, 'referral-code');
  assert.equal(matchBlockedField({ labelText: 'Invitation Code' })?.category, 'invitation-code');
});

test('永久禁止：验证码/密码/系统编号', () => {
  assert.equal(matchBlockedField({ labelText: '验证码' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ labelText: '短信验证码' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ labelText: '图形验证码' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ labelText: '动态口令' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ name: 'verifyCode' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ name: 'verification-code' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ name: 'captcha' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ name: 'captchaToken' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ name: 'otp' })?.category, 'verification-code');
  assert.equal(matchBlockedField({ type: 'password' })?.category, 'password');
  assert.equal(matchBlockedField({ name: 'confirmPassword' })?.category, 'password');
  // 方案 §21.14：autocomplete 不作为禁止证据（曾导致整表误判为密码框）。
  assert.equal(matchBlockedField({ autocomplete: 'current-password', labelText: '姓名' }), null);
  assert.equal(matchBlockedField({ labelText: '申请编号' })?.category, 'system-number');
  assert.equal(matchBlockedField({ labelText: '候选人编号（只读）' })?.category, 'system-number');
  assert.equal(matchBlockedField({ name: 'applicationId' })?.category, 'system-number');
});

test('禁止名单不得误伤普通字段', () => {
  assert.equal(matchBlockedField({ labelText: '姓名' }), null);
  assert.equal(matchBlockedField({ labelText: '手机号', name: 'phone' }), null);
  assert.equal(matchBlockedField({ labelText: '邮箱' }), null);
  assert.equal(matchBlockedField({ labelText: '紧急联系电话' }), null);
  assert.equal(matchBlockedField({ labelText: '推荐人姓名' }), null);
  assert.equal(matchBlockedField({ labelText: '推荐人电话' }), null);
  assert.equal(matchBlockedField({ labelText: '学校编码（自编）', name: 'schoolCode' }), null);
  assert.equal(matchBlockedField({ labelText: '学号', name: 'studentId' }), null);
  assert.equal(matchBlockedField({ name: 'subsystemId', labelText: '学院名称' }), null);
  assert.equal(matchBlockedField({ name: 'productCode', labelText: '报考产品' }), null);
  assert.equal(matchBlockedField({ labelText: '国籍', name: 'nationalityName' }), null);
});
