// 匹配诊断专用占位资料。
// 只用固定占位串，不读取、不打印用户的任何真实资料值（AGENTS.md）。
// 每个候选值都唯一（包含字段 key），避免"多字段同值"裁决把 ambiguous 误判成 matched。

import type { ProfileCustomField, ProfileCustomModule, UserProfile } from '../../extension-src/src/shared/types.ts';
import { prepareProfilePresets } from '../../extension-src/src/shared/profilePresets.ts';
import { createEmptyUserProfile } from '../../extension-src/src/shared/resumeProfiles.ts';

const PLACEHOLDER_PREFIX = '占位值';

function fillCustomFields(fields: ProfileCustomField[] | undefined, scope: string): void {
  for (const field of fields || []) {
    if (field.value.trim()) continue;
    field.value = `${PLACEHOLDER_PREFIX}:${scope}:${field.presetKey || field.id}`;
  }
}

function fillModules(modules: ProfileCustomModule[] | undefined): void {
  for (const module of modules || []) {
    const scope = module.presetKey || module.id;
    for (const record of module.records) {
      fillCustomFields(record.fields, scope);
    }
  }
}

/** 构造覆盖全部注册表/预设语义的占位资料（值均为占位串）。 */
export function buildPlaceholderProfile(): UserProfile {
  const profile = createEmptyUserProfile();

  profile.personal = {
    ...profile.personal,
    name: '占位姓名',
    gender: '男',
    birthDate: '2000-01-01',
    phone: '13800000000',
    email: 'placeholder@example.com',
    wechat: 'placeholder-wechat',
    idCard: '000000000000000000',
    politicalStatus: '群众',
    ethnicity: '汉族',
    hometown: '占位省占位市',
    currentAddress: '占位省占位市占位区占位路1号',
    selfEvaluation: '占位自我评价',
  };

  profile.education = [{
    id: 'edu-1',
    school: '占位大学',
    college: '占位学院',
    educationType: '全日制',
    major: '占位专业',
    degree: '本科',
    startDate: '2020-09',
    endDate: '2024-06',
    gpa: '3.50',
    ranking: '1/100',
    customFields: [],
  }];

  profile.experience = [{
    id: 'exp-1',
    company: '占位公司',
    position: '占位岗位',
    startDate: '2023-06',
    endDate: '2023-09',
    description: '占位工作内容',
    customFields: [],
  }];

  profile.projects = [{
    id: 'proj-1',
    name: '占位项目',
    role: '占位角色',
    startDate: '2023-03',
    endDate: '2023-08',
    description: '占位项目描述',
    customFields: [],
  }];

  profile.awards = [{
    id: 'award-1',
    name: '占位奖项',
    role: '占位获奖角色',
    date: '2023-10',
    description: '占位奖项描述',
    customFields: [],
  }];

  profile.skills = ['占位技能'];
  profile.certifications = [{
    id: 'cert-1',
    name: '占位证书',
    issuer: '占位颁发机构',
    date: '2023-05',
    credentialId: 'placeholder-credential',
  }];

  // 补齐个人/记录/模块全部预设字段（空值），再统一填占位值。
  const prepared = prepareProfilePresets(profile);
  prepared.personal.customFields = prepared.personal.customFields || [];
  fillCustomFields(prepared.personal.customFields, 'personal');
  for (const record of prepared.education) fillCustomFields(record.customFields, 'education');
  for (const record of prepared.experience) fillCustomFields(record.customFields, 'experience');
  for (const record of prepared.projects) fillCustomFields(record.customFields, 'project');
  for (const record of prepared.awards) fillCustomFields(record.customFields, 'award');
  fillModules(prepared.customModules);
  return prepared;
}

/** 占位资料里的自定义字段总数（写进报告，便于判断诊断覆盖面）。 */
export function countPlaceholderFields(profile: UserProfile): number {
  let count = 0;
  count += profile.personal.customFields?.length || 0;
  for (const record of profile.education) count += record.customFields?.length || 0;
  for (const record of profile.experience) count += record.customFields?.length || 0;
  for (const record of profile.projects) count += record.customFields?.length || 0;
  for (const record of profile.awards) count += record.customFields?.length || 0;
  for (const module of profile.customModules || []) {
    for (const record of module.records) count += record.fields.length;
  }
  return count;
}
