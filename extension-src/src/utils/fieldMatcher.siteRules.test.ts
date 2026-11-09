// 新增字段规则回归测试：真实站点字段目录（旧工具 profile.json 结构，只含字段标签）
// 驱动出的 alias / 上下文 / 模块作用域规则。测试夹具全部是占位值，不含任何真实个人资料。
//
// 覆盖：
// - 新增别名与上下文规则命中（各站点真实标签）；
// - 模块不串：module.family / module.campus / module.languages 等不得抢基本信息字段；
// - 本人 vs 紧急联系人、教育 vs 工作/项目、记录级 vs 汇总级字段的分离；
// - 无对应资料的字段（证书、推荐人、导师、家庭成员记录字段）保持 unmatched，不误填。

import assert from 'node:assert/strict';
import test from 'node:test';

import { matchField, type FieldEvidence } from './fieldMatcher.ts';
import { FieldType } from '../shared/types.ts';
import { buildProfileAnswerCandidates } from '../shared/profileAnswerCandidates.ts';
import { createEmptyUserProfile } from '../shared/resumeProfiles.ts';
import { prepareProfilePresets } from '../shared/profilePresets.ts';
import type { ProfileCustomField, UserProfile } from '../shared/types.ts';

function evidenceOf(label: string, moduleContext = ''): FieldEvidence {
  return {
    visibleLabel: label,
    placeholder: '',
    name: '',
    id: '',
    autocomplete: '',
    moduleContext,
    rowContext: '',
    inputType: 'text',
    controlKind: 'input',
  };
}

function match(label: string, moduleContext = '') {
  return matchField(evidenceOf(label, moduleContext));
}

/** 占位资料：补齐全部预设字段并填唯一占位值（不读真实资料）。 */
function placeholderProfile(): UserProfile {
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
    currentAddress: '占位省占位市占位区',
    selfEvaluation: '占位自我评价',
  };
  profile.education = [{
    id: 'edu-1', school: '占位大学', college: '占位学院', educationType: '全日制',
    major: '占位专业', degree: '本科', startDate: '2020-09', endDate: '2024-06',
    gpa: '3.5', ranking: '1/100', customFields: [],
  }];
  profile.experience = [{
    id: 'exp-1', company: '占位公司', position: '占位岗位',
    startDate: '2023-06', endDate: '2023-09', description: '占位工作内容', customFields: [],
  }];
  profile.projects = [{
    id: 'proj-1', name: '占位项目', role: '占位角色',
    startDate: '2023-03', endDate: '2023-08', description: '占位项目描述', customFields: [],
  }];
  profile.awards = [{
    id: 'award-1', name: '占位奖项', role: '占位获奖角色',
    date: '2023-10', description: '占位奖项描述', customFields: [],
  }];
  profile.skills = ['占位技能'];
  const prepared = prepareProfilePresets(profile);
  fillUnique(prepared.personal.customFields || [], 'personal');
  for (const record of prepared.education) fillUnique(record.customFields, 'education');
  for (const record of prepared.experience) fillUnique(record.customFields, 'experience');
  for (const record of prepared.projects) fillUnique(record.customFields, 'project');
  for (const record of prepared.awards) fillUnique(record.customFields, 'award');
  for (const module of prepared.customModules || []) {
    for (const record of module.records) fillUnique(record.fields, module.presetKey || module.id);
  }
  return prepared;
}

function fillUnique(fields: ProfileCustomField[] | undefined, scope: string): void {
  for (const field of fields || []) {
    if (!field.value.trim()) field.value = `占位值:${scope}:${field.presetKey || field.id}`;
  }
}

function candidatesOf(profile: UserProfile) {
  return buildProfileAnswerCandidates(profile);
}

// —— 新增别名/上下文规则命中（真实站点的标签写法） ——

test('新增个人汇总字段：生源地/高考所在地/邮政编码/英语水平', () => {
  assert.equal(match('生源地').profileKey, 'personal.studentOrigin');
  assert.equal(match('生源所在地').profileKey, 'personal.studentOrigin');
  assert.equal(match('高考所在地').profileKey, 'personal.gaokaoLocation');
  assert.equal(match('高考所在地(市/区)').profileKey, 'personal.gaokaoLocation');
  assert.equal(match('邮政编码').profileKey, 'personal.postalCode');
  assert.equal(match('英语水平').profileKey, 'personal.englishLevel');
  assert.equal(match('英语等级').profileKey, 'personal.englishLevel');
});

test('新增教育字段：受教类型/入学性质/满分绩点/专业课程', () => {
  assert.equal(match('本科受教类型', '教育经历').profileKey, 'education.educationType');
  assert.equal(match('硕士受教类型', '教育经历').profileKey, 'education.educationType');
  assert.equal(match('本科是否为全日制', '教育经历').profileKey, 'education.educationType');
  assert.equal(match('入学性质', '教育经历').profileKey, 'education.admissionType');
  assert.equal(match('满分绩点', '教育经历').profileKey, 'education.gpaScale');
  assert.equal(match('专业课程', '教育经历').profileKey, 'education.coreCourses');
});

test('新增论文/语言/求职意向字段别名', () => {
  assert.equal(match('学术成果名称', '论文发表').profileKey, 'module.papers.title');
  assert.equal(match('论文名称', '论文发表').profileKey, 'module.papers.title');
  assert.equal(match('所属期刊', '论文发表').profileKey, 'module.papers.venue');
  assert.equal(match('作者排序', '论文发表').profileKey, 'module.papers.authorRank');
  assert.equal(match('论文索引号', '论文发表').profileKey, 'module.papers.doi');
  assert.equal(match('论文内容简述', '论文发表').profileKey, 'module.papers.abstract');
  assert.equal(match('语言类型', '语言能力').profileKey, 'module.languages.language');
  assert.equal(match('英语成绩', '语言能力').profileKey, 'module.languages.score');
  assert.equal(match('其他外语水平', '语言能力').profileKey, 'module.languages.level');
  assert.equal(match('期望职位', '求职意向').profileKey, 'module.jobIntent.positions');
  assert.equal(match('第一志愿', '求职意向').profileKey, 'module.jobIntent.positions');
  assert.equal(match('意向工作城市', '基本信息').profileKey, 'module.jobIntent.cities');
  assert.equal(match('期望月薪', '求职意向').profileKey, 'module.jobIntent.salaryExpected');
  assert.equal(match('期望薪酬').profileKey, 'module.jobIntent.salaryExpected');
  assert.equal(match('到岗时间', '求职意向').profileKey, 'module.jobIntent.arrivalDate');
  assert.equal(match('可实习时间', '求职意向').profileKey, 'module.jobIntent.internshipMonths');
  assert.equal(match('是否接受外派', '求职意向').profileKey, 'module.jobIntent.overseas');
});

test('项目中职责命中项目角色，不被项目描述/个人职责规则抢占', () => {
  const result = match('项目中职责', '项目经历');
  assert.equal(result.profileKey, 'project.role');
});

// —— 模块不串：预设模块候选不得跨模块抢字段 ——

test('家庭模块候选不得抢基本信息页的本人姓名/手机号', () => {
  const candidates = candidatesOf(placeholderProfile());

  const name = matchField(evidenceOf('姓名', '基本信息'), { candidates });
  assert.equal(name.profileKey, 'personal.name');
  assert.equal(name.coreFieldType, FieldType.NAME);

  const phone = matchField(evidenceOf('手机号码', '基本信息'), { candidates });
  assert.equal(phone.profileKey, 'personal.phone');
  assert.equal(phone.coreFieldType, FieldType.PHONE);

  // 家庭模块语境下才允许命中家庭成员候选。
  const familyPhone = matchField(evidenceOf('联系电话', '家庭信息'), { candidates });
  assert.equal(familyPhone.profileKey, 'module.family.phone');
});

test('校园/语言/技能模块的通用标签只在对应模块语境命中', () => {
  const candidates = candidatesOf(placeholderProfile());

  const startInEducation = matchField(evidenceOf('开始时间', '教育经历'), { candidates });
  assert.equal(startInEducation.coreFieldType, FieldType.EDUCATION_START_DATE);
  assert.notEqual(startInEducation.profileKey, 'module.campus.period');

  const startInCampus = matchField(evidenceOf('开始时间', '校园经历'), { candidates });
  assert.equal(startInCampus.profileKey, 'module.campus.period');

  // 实习经历的"工作职责"归工作经历描述，不被校园经历模块抢走。
  const duty = matchField(evidenceOf('工作职责', '实习经历'), { candidates });
  assert.equal(duty.profileKey, 'experience.description');

  // 语言能力模块的"熟练程度"不得串到技能模块。
  const level = matchField(evidenceOf('熟练程度', '语言能力'), { candidates });
  assert.equal(level.profileKey, 'module.languages.level');
});

test('基本信息页"关系"不命中家庭成员关系', () => {
  const candidates = candidatesOf(placeholderProfile());
  const result = matchField(evidenceOf('关系', '基本信息'), { candidates });
  assert.notEqual(result.profileKey, 'module.family.relationship');
});

// —— 记录级 vs 汇总级、本人 vs 紧急联系人 ——

test('学位：教育经历记录内归教育学位，基本信息页归最高学位', () => {
  const candidates = candidatesOf(placeholderProfile());

  const inEducation = matchField(evidenceOf('学位', '教育经历'), { candidates });
  assert.equal(inEducation.profileKey, 'education.academicDegree');

  const inBasic = matchField(evidenceOf('学位', '基本信息'), { candidates });
  assert.equal(inBasic.profileKey, 'personal.highestDegree');
});

test('学历：教育经历记录内归教育学历，基本信息页归最高学历', () => {
  const candidates = candidatesOf(placeholderProfile());

  const inEducation = matchField(evidenceOf('学历', '教育经历'), { candidates });
  assert.equal(inEducation.coreFieldType, FieldType.DEGREE);
  assert.equal(inEducation.profileKey, 'education.degree');

  const inBasic = matchField(evidenceOf('学历', '基本信息'), { candidates });
  assert.equal(inBasic.profileKey, 'personal.highestEducation');
});

test('本人手机号 vs 紧急联系人电话 vs 家庭联系电话互不串', () => {
  const candidates = candidatesOf(placeholderProfile());

  const own = matchField(evidenceOf('手机号码', '基本信息'), { candidates });
  assert.equal(own.profileKey, 'personal.phone');

  const emergency = matchField(evidenceOf('紧急联系人手机号', '基本信息'), { candidates });
  assert.equal(emergency.profileKey, 'personal.emergencyPhone');

  const emergencyName = matchField(evidenceOf('紧急联系人', '基本信息'), { candidates });
  assert.equal(emergencyName.profileKey, 'personal.emergencyName');

  const family = matchField(evidenceOf('手机号码', '家庭信息'), { candidates });
  assert.equal(family.profileKey, 'module.family.phone');
  assert.notEqual(family.profileKey, 'personal.phone');
});

test('通讯地址/现居住地命中通讯地址，不再 ambiguous', () => {
  const candidates = candidatesOf(placeholderProfile());
  const result = matchField(evidenceOf('通讯地址/现居住地', '基本信息'), { candidates });
  assert.equal(result.status, 'matched');
  assert.equal(result.profileKey, 'personal.mailingAddress');
});

// —— 冲突/包含匹配不再抢精确语义 ——

test('短标题不被长别名沾成冲突：专业/毕业时间/学校', () => {
  const candidates = candidatesOf(placeholderProfile());

  const major = matchField(evidenceOf('专业', '教育经历'), { candidates });
  assert.equal(major.profileKey, 'education.major');

  const graduation = matchField(evidenceOf('毕业时间', '教育经历'), { candidates });
  assert.equal(graduation.coreFieldType, FieldType.GRADUATION_DATE);

  const school = matchField(evidenceOf('学校', '教育经历'), { candidates });
  assert.equal(school.coreFieldType, FieldType.SCHOOL);
});

test('用户自定义的"专业方向"字段不得把"专业"挤成 ambiguous', () => {
  const profile = createEmptyUserProfile();
  profile.personal.customFields = [{
    id: 'direction',
    name: '专业方向',
    value: '占位方向',
    type: 'text',
    aliases: ['研究方向'],
    allowAI: true,
    sensitive: false,
  }];
  const result = matchField(evidenceOf('专业', '教育经历'), {
    candidates: buildProfileAnswerCandidates(profile),
  });
  assert.equal(result.profileKey, 'education.major');
});

// —— 无对应资料时保持 unmatched（宁缺勿错） ——

test('证书/推荐人/家庭成员记录字段没有可靠数据源时不得误填', () => {
  const candidates = candidatesOf(placeholderProfile());
  for (const [label, context] of [
    ['证书名称', '证书'],
    ['证书编号', '证书'],
    ['其他证书', '证书'],
    ['推荐人姓名', ''],
    ['推荐人电话', ''],
    ['父亲姓名', '家庭信息'],
    ['家庭成员姓名', '家庭信息'],
    ['出生地', ''],
  ] as const) {
    const result = matchField(evidenceOf(label, context), { candidates });
    assert.notEqual(result.status, 'matched', `${label} 不应被自动识别为可填字段`);
  }
});

test('导师姓名有对应预设资料时才允许填写（没有候选时必须留空）', () => {
  assert.equal(matchField(evidenceOf('导师姓名', '教育经历')).status, 'unmatched');
  const candidates = candidatesOf(placeholderProfile());
  const withProfile = matchField(evidenceOf('导师姓名', '教育经历'), { candidates });
  assert.equal(withProfile.profileKey, 'education.thesisAdvisor');
});

test('禁止字段仍然 blocked：内推码/推荐码/验证码', () => {
  for (const label of ['内推码', '推荐码', '验证码', '邀请码']) {
    assert.equal(matchField(evidenceOf(label, '基本信息')).status, 'blocked', label);
  }
});

test('英文标识符回归：schoolName / companyName / englishName 不误伤姓名', () => {
  const school = matchField({ ...evidenceOf('', ''), name: 'schoolName' });
  assert.equal(school.profileKey, 'education.school');
  const company = matchField({ ...evidenceOf('', ''), name: 'companyName' });
  assert.equal(company.profileKey, 'experience.company');
  const englishName = matchField({ ...evidenceOf('', ''), name: 'englishName' });
  assert.notEqual(englishName.profileKey, 'personal.name');
});
