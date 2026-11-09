// 旧版 profile.json → 新扩展资料模型的单元测试。
// 全部使用自造合成数据，不包含任何真实个人资料。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convertLegacyProfile,
  LegacyProfileImportError,
} from './legacyProfileImport.ts';
import {
  isValidUserProfileInput,
  normalizeUserProfileData,
} from './resumeProfiles.ts';
import { prepareProfilePresets } from './profilePresets.ts';
import { upgradeProfileCustomData } from './profileCustomFields.ts';
import type { ProfileCustomField } from './types.ts';

// ---------------------------------------------------------------------------
// 合成旧资料（虚构值；仅用于测试）
// ---------------------------------------------------------------------------

interface LegacyRecordOptions {
  identityHints?: Record<string, string>;
}

function legacyFact(value: unknown, sourceLabel?: string): Record<string, unknown> {
  return {
    id: 'fact-synthetic',
    value,
    updated_at: '2026-01-01T00:00:00+00:00',
    created_at: '2026-01-01T00:00:00+00:00',
    scope_type: 'global',
    scope_id: '',
    record_index: 0,
    source_domain: 'synthetic.example.com',
    source_label: sourceLabel || '',
    verified: true,
  };
}

function legacyRecord(
  values: Record<string, unknown>,
  options: LegacyRecordOptions = {},
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    fields[key] = {
      id: `field-${key}`,
      value,
      updated_at: '2026-01-01T00:00:00+00:00',
      created_at: '2026-01-01T00:00:00+00:00',
      scope_type: 'record',
      scope_id: 'synthetic',
      record_index: 0,
      source_domain: 'synthetic.example.com',
      source_label: '合成标签',
      verified: true,
    };
  }
  return {
    fields,
    identityHints: options.identityHints || {},
  };
}

function semanticLinkKey(
  label: string,
  section: string,
  type: string,
  options: string[] = [],
): string {
  return JSON.stringify([label, section, type, options]);
}

function makeLegacyProfile(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00+00:00',
    facts: {
      'basic.name': legacyFact('测试甲', '姓名'),
      'basic.phone': legacyFact('13800000000', '手机号码'),
      'basic.email': legacyFact('test@example.com', '电子邮箱'),
      'basic.gender': legacyFact('男', '性别'),
      'basic.birth_date': legacyFact('2000-01-02', '出生日期'),
      'basic.political_status': legacyFact('群众', '政治面貌'),
      'basic.ethnicity': legacyFact('汉族', '民族'),
      'basic.hometown': legacyFact({ province: '测试省', city: '测试市' }),
      'basic.current_city': legacyFact({ province: '测试省', city: '试点市' }),
      'basic.id_number': legacyFact('110101200001020000', '证件号码'),
      'basic.id_type': legacyFact('居民身份证', '证件类型'),
      'basic.nationality': legacyFact('中国', '国籍/地区'),
      'basic.marital_status': legacyFact('未婚', '婚姻状况'),
      'basic.work_years': legacyFact('0', '工作年限'),
      'basic.household_location': legacyFact({ province: '测试省', city: '户籍市' }),
      'basic.gaokao_location': legacyFact({ province: '测试省', city: '考点市' }),
      'basic.height': legacyFact('170', '身高(厘米)'),
      'basic.weight': legacyFact('60', '体重(公斤)'),
      'basic.overseas_student': legacyFact('否', '是否海外留学生'),
      'basic.address': legacyFact('测试省测试市合成路 1 号', '通信地址'),
      'basic.postal_code': legacyFact('100000', '邮政编码'),
      'basic.student_origin': legacyFact('测试省测试市', '生源地'),
      'emergency.name': legacyFact('测试乙', '紧急联系人'),
      'emergency.phone': legacyFact('13900000000', '紧急联系人电话'),
      'language.english_level': legacyFact('熟练', '英语水平'),
      'resume.skills': legacyFact('甲技能\n乙技能、丙技能', '专业技能'),
      'resume.research': legacyFact('合成科研成果描述', '科研成果'),
      // 未知事实：必须原样保留，不得静默丢弃。
      'basic.favorite_color': legacyFact('合成蓝色', '合成颜色'),
    },
    records: {
      '教育经历': {
        '0': legacyRecord({
          'education.school': '合成大学',
          'education.major': '计算机科学与技术',
          'education.degree': '本科',
          'education.start_date': '2018-09-01',
          'education.end_date': '2022-06-30',
          'education.gpa': '3.8',
          'education.rank': '前5%',
          'education.mode': '普通（统招）',
          'education.college': '合成学院',
          'education.courses': '数据结构',
          'education.academic_degree': '学士',
          'education.major_category': '工学',
          'education.full_time': '是',
          // 记录级地址为省/市结构：应拼接为字符串保留。
          'education.city': { province: '测试省', city: '合成市' },
        }),
        // 与 '0' 身份锚点完全一致：应被去重合并，最完整的一条保留原值。
        '1': legacyRecord({
          'education.school': '合成大学',
          'education.major': '计算机科学与技术',
          'education.degree': '本科',
          'education.start_date': '2018-09',
          'education.end_date': '2022-06',
          'education.gpa': '3.9',
        }),
        // 同校但起止时间不同：不自动合并，只告警。
        '2': legacyRecord({
          'education.school': '合成大学',
          'education.degree': '本科',
          'education.start_date': '2019-09',
          'education.end_date': '2023-06',
        }),
        // 只有 identityHints：也应按锚点保留。
        '3': legacyRecord({}, { identityHints: { 'education.school': '合成大学' } }),
      },
      '项目经历': {
        '0': legacyRecord({
          'project.name': '合成项目',
          'project.start_date': '2021-01',
          'project.end_date': '2021-06',
          'project.description': '合成项目描述',
          'project.extra_note': '合成项目补充',
        }),
      },
      '证书': {
        '0': legacyRecord({
          'certificate.name': '合成证书',
          'certificate.date': '2021-05',
          'certificate.description': '合成证书说明',
        }),
      },
      '家庭信息': {
        '0': legacyRecord(
          { 'family.name': '测试丙', 'family.employer': '合成单位', 'family.position': '合成职务' },
          { identityHints: { 'family.title': '父亲' } },
        ),
      },
      '语言能力': {
        '0': legacyRecord({ 'language.type': '英语', 'language.proficiency': '良好' }),
      },
      '实习经历': {
        '0': legacyRecord({
          'experience.role': '合成实习生',
          'experience.start_date': '2021-07',
          'experience.end_date': '2021-09',
          'experience.description': '合成实习描述',
        }),
      },
      '获奖经历': {
        '0': legacyRecord({ 'award.name': '合成奖学金', 'award.date': '2021-10' }),
      },
      '论文发表': {
        '0': legacyRecord({
          'publication.name': '合成论文',
          'publication.journal': '合成期刊',
          'publication.date': '2023-01',
          'publication.author_order': '1',
        }),
      },
      '社团经历': {
        '0': legacyRecord({ 'community.name': '合成社团' }),
      },
    },
    mappings: {
      'mapping-ready-exact': {
        domain: 'synthetic.example.com',
        label: '合成学校名称',
        section: '教育经历',
        type: 'text',
        required: true,
        status: 'ready',
        options: [],
        canonicalKey: null,
      },
      'mapping-ready-direct': {
        domain: 'synthetic.example.com',
        label: '合成专业名称',
        section: '教育经历',
        type: 'text',
        required: true,
        status: 'ready',
        options: [],
        canonicalKey: 'education.major',
      },
      'mapping-ready-orphan': {
        domain: 'synthetic.example.com',
        label: '合成漏配字段',
        section: '基本信息',
        type: 'text',
        required: false,
        status: 'ready',
        options: [],
        canonicalKey: null,
      },
      'mapping-review-direct': {
        domain: 'synthetic.example.com',
        label: '合成待复核字段',
        section: '教育经历',
        type: 'text',
        required: false,
        status: 'review',
        options: [],
        canonicalKey: 'education.mode',
      },
    },
    semanticLinks: {
      [semanticLinkKey('合成学校名称', '教育经历', 'text')]: {
        canonicalKey: 'education.school',
        confidence: 0.98,
      },
      [semanticLinkKey('姓名', '基本信息', 'text')]: {
        canonicalKey: 'basic.address',
        confidence: 0.9,
      },
      [semanticLinkKey('合成未知字段', '基本信息', 'text')]: {
        canonicalKey: 'certificate.name',
        confidence: 0.9,
      },
      [semanticLinkKey('合成选项列表'.padEnd(60, '合'), '教育经历', 'combobox')]: {
        canonicalKey: 'education.school',
        confidence: 0.9,
      },
      [semanticLinkKey('合成学历层次', '教育经历', 'combobox')]: {
        canonicalKey: 'education.rank',
        confidence: 0.9,
      },
      [semanticLinkKey('合成学历层次', '教育经历', 'select')]: {
        canonicalKey: 'education.mode',
        confidence: 0.9,
      },
    },
    // 旧工具辅助段：不应迁移，但要在 warnings 里说明。
    pending: { synthetic: { fields: [] } },
    bindings: { synthetic: 1 },
  };
}

function convertSynthetic() {
  let counter = 0;
  return convertLegacyProfile(makeLegacyProfile(), {
    createId: () => {
      counter += 1;
      return `synthetic-id-${counter}`;
    },
  });
}

function customFieldByKey(
  fields: ProfileCustomField[] | undefined,
  presetKey: string,
): ProfileCustomField | undefined {
  return (fields || []).find(field => field.presetKey === presetKey);
}

// ---------------------------------------------------------------------------
// facts 映射
// ---------------------------------------------------------------------------

test('facts 映射到个人核心字段、预设自定义字段与敏感字段', () => {
  const { profile, stats } = convertSynthetic();
  assert.equal(profile.personal.name, '测试甲');
  assert.equal(profile.personal.phone, '13800000000');
  assert.equal(profile.personal.email, 'test@example.com');
  assert.equal(profile.personal.gender, '男');
  assert.equal(profile.personal.birthDate, '2000-01-02');
  assert.equal(profile.personal.politicalStatus, '群众');
  assert.equal(profile.personal.ethnicity, '汉族');
  // 分级地区对象应拼接为单行地址。
  assert.equal(profile.personal.hometown, '测试省测试市');
  assert.equal(profile.personal.currentAddress, '测试省试点市');
  // 敏感字段保留原值（本地存储，不参与摘要展示）。
  assert.equal(profile.personal.idCard, '110101200001020000');

  const fields = profile.personal.customFields || [];
  assert.equal(customFieldByKey(fields, 'personal.nationality')?.value, '中国');
  assert.equal(customFieldByKey(fields, 'personal.maritalStatus')?.value, '未婚');
  assert.equal(customFieldByKey(fields, 'personal.height')?.value, '170');
  assert.equal(customFieldByKey(fields, 'personal.householdRegistration')?.value, '测试省户籍市');
  assert.equal(customFieldByKey(fields, 'personal.mailingAddress')?.value, '测试省测试市合成路 1 号');
  assert.equal(customFieldByKey(fields, 'personal.gaokaoLocation')?.value, '测试省考点市');
  assert.equal(customFieldByKey(fields, 'personal.studentOrigin')?.value, '测试省测试市');
  assert.equal(customFieldByKey(fields, 'personal.postalCode')?.value, '100000');
  assert.equal(customFieldByKey(fields, 'personal.englishLevel')?.value, '熟练');
  assert.equal(customFieldByKey(fields, 'personal.emergencyName')?.value, '测试乙');
  assert.equal(customFieldByKey(fields, 'personal.emergencyPhone')?.value, '13900000000');
  // 紧急联系人 / 证件类型是敏感字段。
  assert.equal(customFieldByKey(fields, 'personal.emergencyName')?.sensitive, true);
  assert.equal(customFieldByKey(fields, 'personal.idType')?.sensitive, true);
  assert.equal(customFieldByKey(fields, 'personal.emergencyName')?.allowAI, false);

  assert.equal(stats.facts.total, 28);
  assert.equal(stats.facts.imported, 28);
  assert.equal(stats.facts.unknown, 1);
  assert.equal(stats.facts.corePersonal, 10);
  assert.equal(stats.warnings, stats.warnings);
});

test('skills 按分隔符拆分；research 保留在“其他信息”；未知 facts 不丢弃', () => {
  const { profile, stats, warnings } = convertSynthetic();
  assert.deepEqual(profile.skills, ['甲技能', '乙技能', '丙技能']);
  assert.equal(stats.facts.skills, 3);

  const research = profile.customInformation.find(item => item.name === '科研成果');
  assert.equal(research?.content, '合成科研成果描述');
  assert.equal(research?.moduleName, '论文发表');

  const unknownFact = profile.customInformation.find(item => item.name === 'basic.favorite_color');
  assert.equal(unknownFact?.content, '合成蓝色');
  assert.match(warnings.join('\n'), /未识别的 facts 字段/);
});

// ---------------------------------------------------------------------------
// records 映射与教育去重
// ---------------------------------------------------------------------------

test('教育经历按 school+degree+起止时间去重并保留最完整记录', () => {
  const { profile, stats, warnings } = convertSynthetic();
  assert.equal(stats.education.input, 4);
  assert.equal(stats.education.merged, 1);
  assert.equal(stats.education.imported, 3);

  const merged = profile.education[0];
  assert.equal(merged.school, '合成大学');
  assert.equal(merged.major, '计算机科学与技术');
  assert.equal(merged.degree, '本科');
  assert.equal(merged.gpa, '3.8');
  assert.equal(merged.ranking, '前5%');
  assert.equal(merged.college, '合成学院');
  assert.equal(customFieldByKey(merged.customFields, 'education.academicDegree')?.value, '学士');
  assert.equal(customFieldByKey(merged.customFields, 'education.coreCourses')?.value, '数据结构');
  assert.equal(customFieldByKey(merged.customFields, 'education.majorCategory')?.value, '工学');
  // 冲突值不得覆盖：保留最完整记录里的 3.8 而不是重复扫描里的 3.9。
  assert.notEqual(merged.gpa, '3.9');
  assert.match(warnings.join('\n'), /字段值冲突/);
  assert.match(warnings.join('\n'), /同校记录/);
  // 记录级省/市结构被拼接为单行文本，不丢数据。
  assert.ok(merged.customFields?.some(field =>
    (field.presetKey === 'education.schoolCity' || field.name === '所在城市') && field.value === '测试省合成市'));
  assert.match(warnings.join('\n'), /记录中有 \d+ 个地址字段保存为“省\/市”分级结构/);
});

test('项目/证书/家庭/语言/论文/实习/获奖分别落到对应模型', () => {
  const { profile, stats, warnings } = convertSynthetic();
  assert.equal(profile.projects.length, 1);
  assert.equal(profile.projects[0].name, '合成项目');
  assert.equal(profile.projects[0].description, '合成项目描述');
  assert.ok(profile.projects[0].customFields?.some(field => field.value === '合成项目补充'));

  assert.equal(profile.certifications.length, 1);
  assert.equal(profile.certifications[0].name, '合成证书');
  assert.equal(profile.certifications[0].date, '2021-05');
  assert.ok(profile.customInformation.some(item => item.name === '证书说明' && item.content === '合成证书说明'));

  assert.equal(profile.experience.length, 1);
  assert.equal(profile.experience[0].position, '合成实习生');
  assert.equal(profile.experience[0].company, '');

  assert.equal(profile.awards.length, 1);
  assert.equal(profile.awards[0].name, '合成奖学金');

  const modules = profile.customModules || [];
  const family = modules.find(module => module.presetKey === 'family');
  assert.ok(family);
  assert.equal(family.records.length, 1);
  assert.equal(customFieldByKey(family.records[0].fields, 'module.family.name')?.value, '测试丙');
  assert.equal(customFieldByKey(family.records[0].fields, 'module.family.relationship')?.value, '父亲');
  assert.equal(customFieldByKey(family.records[0].fields, 'module.family.organization')?.value, '合成单位');
  assert.equal(customFieldByKey(family.records[0].fields, 'module.family.name')?.sensitive, true);

  const papers = modules.find(module => module.presetKey === 'papers');
  assert.ok(papers);
  assert.equal(customFieldByKey(papers.records[0].fields, 'module.papers.title')?.value, '合成论文');
  assert.equal(customFieldByKey(papers.records[0].fields, 'module.papers.venue')?.value, '合成期刊');
  assert.equal(customFieldByKey(papers.records[0].fields, 'module.papers.authorRank')?.value, '1');

  const languages = modules.find(module => module.presetKey === 'languages');
  assert.ok(languages);
  const english = languages.records.find(record =>
    customFieldByKey(record.fields, 'module.languages.language')?.value === '英语');
  assert.ok(english);
  // 事实里的“英语水平”与语言记录里的“良好”不一致：不覆盖语言记录，事实值另存到个人预设字段。
  assert.equal(customFieldByKey(english.fields, 'module.languages.level')?.value, '良好');
  assert.equal(customFieldByKey(profile.personal.customFields, 'personal.englishLevel')?.value, '熟练');
  assert.match(warnings.join('\n'), /英语水平与语言记录中的水平不一致/);

  assert.equal(stats.projects.imported, 1);
  assert.equal(stats.certifications.imported, 1);
  assert.equal(stats.experience.imported, 1);
  assert.equal(stats.awards.imported, 1);
  assert.equal(stats.family.imported, 1);
  assert.equal(stats.languages.imported, 1);
  assert.equal(stats.publications.imported, 1);
});

test('未知记录模块保留为自定义模块，未知记录字段保留为自定义字段', () => {
  const { profile, stats, warnings } = convertSynthetic();
  const unknown = (profile.customModules || []).find(module => !module.presetKey);
  assert.ok(unknown);
  assert.equal(unknown.name, '社团经历');
  assert.equal(unknown.records.length, 1);
  assert.ok(unknown.records[0].fields.some(field => field.value === '合成社团'));
  assert.equal(stats.customModules.unknown, 1);
  assert.match(warnings.join('\n'), /没有对应的新模型预设/);
  assert.match(warnings.join('\n'), /未识别字段/);
});

// ---------------------------------------------------------------------------
// 旧别名迁移
// ---------------------------------------------------------------------------

test('ready 映射与旧语义关联迁移为 fieldAliasOverrides', () => {
  const { profile, stats } = convertSynthetic();
  const overrides = profile.fieldAliasOverrides || {};
  const schoolAliases = overrides['education.school']?.added || [];
  assert.ok(schoolAliases.includes('合成学校名称'));
  const majorAliases = overrides['education.major']?.added || [];
  assert.ok(majorAliases.includes('合成专业名称'));
  assert.ok(stats.aliases.imported >= 2);
  assert.ok(stats.aliases.keys >= 2);
  assert.equal(stats.aliases.readyMappings, 3);
  assert.equal(stats.aliases.mappings, 4);
  // review 状态不迁移。
  assert.ok(!Object.values(overrides).some(entry => entry.added.includes('合成待复核字段')));
  // 没有语义键的 ready 映射计数丢弃。
  assert.ok(stats.aliases.droppedNoCanonical >= 1);
  // 未知旧语义键、长选项标签、通用标签都计数丢弃，不进入 overrides。
  assert.ok(stats.aliases.droppedUnknownCanonical >= 1);
  assert.ok(stats.aliases.droppedUnsafeLabel >= 2);
  assert.ok(!Object.values(overrides).some(entry => entry.added.includes('姓名')));
  assert.ok(!Object.values(overrides).some(entry => entry.added.some(alias => alias.length > 40)));
  // 同一标签对应多个新字段时保留第一个。
  assert.ok(stats.aliases.droppedConflicting >= 1);
});

// ---------------------------------------------------------------------------
// 结构校验 / 错误处理
// ---------------------------------------------------------------------------

test('损坏或未知结构安全报错，不静默导入', () => {
  const errorOf = (raw: unknown): LegacyProfileImportError => {
    try {
      convertLegacyProfile(raw);
    } catch (error) {
      assert.ok(error instanceof LegacyProfileImportError);
      return error;
    }
    throw new Error('预期抛出 LegacyProfileImportError');
  };

  assert.equal(errorOf(null).code, 'INVALID_ROOT');
  assert.equal(errorOf([]).code, 'INVALID_ROOT');
  assert.equal(errorOf('not-json').code, 'INVALID_ROOT');
  assert.equal(errorOf({}).code, 'INVALID_ROOT');
  assert.equal(errorOf({ schemaVersion: 2, facts: {} }).code, 'UNSUPPORTED_SCHEMA');
  assert.equal(errorOf({ schemaVersion: 1, facts: { 'basic.name': legacyFact('合成') }, records: 'x' }).code, 'INVALID_RECORDS');
  assert.equal(errorOf({ schemaVersion: 1, facts: { 'basic.name': 'not-an-entry' }, records: {} }).code, 'INVALID_FACT_ENTRY');
  const backup = errorOf({
    schemaVersion: 1,
    exportedAt: '2026-01-01T00:00:00Z',
    data: { resumeProfileLibrary: { schemaVersion: 1, profiles: [] } },
  });
  assert.equal(backup.code, 'NEW_EXTENSION_BACKUP');
  assert.match(backup.message, /导入完整数据/);
});

test('空 facts/records 不报错，也不编造任何值', () => {
  const { profile, stats, warnings } = convertLegacyProfile({ schemaVersion: 1, facts: {}, records: {} });
  assert.equal(profile.personal.name, '');
  assert.deepEqual(profile.education, []);
  assert.deepEqual(profile.skills, []);
  assert.equal(stats.facts.total, 0);
  assert.equal(stats.warnings, warnings.length);
  assert.equal(isValidUserProfileInput(profile), true);
});

test('缺少 facts 或 records 时给出警告而不是崩溃', () => {
  const onlyFacts = convertLegacyProfile({
    schemaVersion: 1,
    facts: { 'basic.name': legacyFact('测试甲') },
  });
  assert.match(onlyFacts.warnings.join('\n'), /缺少 records 段/);

  const onlyRecords = convertLegacyProfile({
    schemaVersion: 1,
    records: { '教育经历': { '0': legacyRecord({ 'education.school': '合成大学' }) } },
  });
  assert.match(onlyRecords.warnings.join('\n'), /缺少 facts 段/);
});

// ---------------------------------------------------------------------------
// 输出合法性与隐私
// ---------------------------------------------------------------------------

test('转换结果通过新模型校验，并能被预设合并逻辑消费', () => {
  const { profile } = convertSynthetic();
  assert.equal(isValidUserProfileInput(profile), true);
  const normalized = normalizeUserProfileData(profile);
  assert.equal(normalized.personal.name, '测试甲');

  const prepared = prepareProfilePresets(normalized);
  const family = (prepared.customModules || []).find(module => module.presetKey === 'family');
  assert.ok(family);
  assert.equal(customFieldByKey(family.records[0].fields, 'module.family.relationship')?.value, '父亲');
  // 预设字段被补齐，但导入的值仍然保留。
  assert.equal(customFieldByKey(prepared.personal.customFields, 'personal.nationality')?.value, '中国');

  // 设置页保存的是“预设已补齐”的资料；下次打开会再次经过同样的预处理，必须幂等。
  const reloaded = prepareProfilePresets(upgradeProfileCustomData(prepared));
  assert.equal(reloaded.personal.name, '测试甲');
  assert.deepEqual(reloaded.skills, profile.skills);
  assert.deepEqual(reloaded.fieldAliasOverrides, profile.fieldAliasOverrides);
  const reloadedFamily = (reloaded.customModules || []).find(module => module.presetKey === 'family');
  assert.ok(reloadedFamily);
  assert.equal(customFieldByKey(reloadedFamily.records[0].fields, 'module.family.relationship')?.value, '父亲');
  assert.equal(reloadedFamily.records[0].fields.find(field => field.presetKey === 'module.family.name')?.sensitive, true);
});

test('warnings/stats 不泄露个人答案值', () => {
  const { stats, warnings } = convertSynthetic();
  const serialized = JSON.stringify({ stats, warnings });
  const sentinels = [
    '测试甲', '测试乙', '测试丙', '13800000000', '13900000000', 'test@example.com',
    '110101200001020000', '合成大学', '合成学院', '计算机科学与技术', '合成项目',
    '合成证书', '合成论文', '合成期刊', '合成奖学金', '合成实习描述', '合成社团',
    '测试省', '测试市', '户籍市', '考点市', '合成单位', '合成职务', '合成蓝色',
    '甲技能', '乙技能', '丙技能', '合成科研成果描述', '合成证书说明',
  ];
  for (const sentinel of sentinels) {
    assert.equal(serialized.includes(sentinel), false, `warnings/stats 不应包含个人答案值：${sentinel}`);
  }
});

test('重复转换使用独立 ID，不共享引用', () => {
  const first = convertLegacyProfile(makeLegacyProfile());
  const second = convertLegacyProfile(makeLegacyProfile());
  assert.notEqual(first.profile.education[0].id, second.profile.education[0].id);
  assert.notEqual(first.profile.personal.customFields, second.profile.personal.customFields);
  // 修改第一次结果不影响第二次。
  first.profile.education[0].school = '被修改';
  assert.equal(second.profile.education[0].school, '合成大学');
});
