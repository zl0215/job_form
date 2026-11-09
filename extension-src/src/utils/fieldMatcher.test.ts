import assert from 'node:assert/strict';
import test from 'node:test';
import { FieldMatcher, matchField, type FieldEvidence } from './fieldMatcher.ts';
import { FieldType } from '../shared/types.ts';
import { buildProfileAnswerCandidates } from '../shared/profileAnswerCandidates.ts';
import { createEmptyUserProfile } from '../shared/resumeProfiles.ts';

function evidenceOf(parts: Partial<FieldEvidence>): FieldEvidence {
  return {
    visibleLabel: '',
    placeholder: '',
    name: '',
    id: '',
    autocomplete: '',
    moduleContext: '',
    rowContext: parts.visibleLabel || '',
    inputType: 'text',
    controlKind: 'input',
    ...parts,
  };
}

function matchLabel(labelText: string) {
  return FieldMatcher.matchFieldType('', '', '', labelText, 'text', '');
}

// —— §13.1 必须正确匹配 ——

test('核心字段标题正确映射', () => {
  assert.equal(matchLabel('姓名').fieldType, FieldType.NAME);
  assert.equal(matchLabel('手机号').fieldType, FieldType.PHONE);
  assert.equal(matchLabel('国籍').fieldType, FieldType.UNKNOWN); // 国籍是资料预设字段，走候选层
  assert.equal(matchLabel('民族').fieldType, FieldType.UNKNOWN);
  assert.equal(matchLabel('学校名称').fieldType, FieldType.SCHOOL);
  assert.equal(matchLabel('毕业（在读）院校').fieldType, FieldType.SCHOOL);
  assert.equal(matchLabel('专业名称').fieldType, FieldType.MAJOR);
  assert.equal(matchLabel('公司名称').fieldType, FieldType.COMPANY);
  assert.equal(matchLabel('职位名称').fieldType, FieldType.POSITION);
});

test('上下文小 if：紧急联系人与本人手机号分离', () => {
  assert.equal(matchLabel('紧急联系电话').fieldType, FieldType.UNKNOWN); // 预设字段由候选层处理
  const emergency = matchField(evidenceOf({ visibleLabel: '应急联系人手机' }));
  assert.equal(emergency.status, 'matched');
  assert.equal(emergency.profileKey, 'personal.emergencyPhone');

  const own = matchField(evidenceOf({ visibleLabel: '本人联系电话' }));
  assert.equal(own.status, 'matched');
  assert.equal(own.profileKey, 'personal.phone');
  assert.equal(own.coreFieldType, FieldType.PHONE);
});

test('复合标识符：nationalityName 归国籍而不是姓名', () => {
  const result = matchField(evidenceOf({ id: 'nationalityName', visibleLabel: '国籍' }));
  assert.equal(result.status, 'matched');
  assert.equal(result.profileKey, 'personal.nationality');
  assert.notEqual(result.profileKey, 'personal.name');
});

test('英文标识符完整命中', () => {
  assert.equal(matchField(evidenceOf({ id: 'schoolName' })).profileKey, 'education.school');
  assert.equal(matchField(evidenceOf({ id: 'collegeName' })).profileKey, 'education.college');
  assert.equal(matchField(evidenceOf({ id: 'majorName' })).profileKey, 'education.major');
  assert.equal(matchField(evidenceOf({ id: 'companyName' })).profileKey, 'experience.company');
  assert.equal(matchField(evidenceOf({ id: 'positionName' })).profileKey, 'experience.position');
  assert.equal(matchField(evidenceOf({ id: 'projectName' })).profileKey, 'project.name');
  assert.equal(matchField(evidenceOf({ id: 'gpa' })).profileKey, 'education.gpa');
});

// —— §13.1 必须不匹配/进入 blocked ——

test('禁止字段全部 blocked', () => {
  for (const label of ['推荐码', '内推码', '邀请码', '验证码', '短信验证码']) {
    assert.equal(matchField(evidenceOf({ visibleLabel: label })).status, 'blocked', label);
  }
});

test('没有对应资料时导师/推荐人不得填本人信息', () => {
  assert.equal(matchField(evidenceOf({ visibleLabel: '导师姓名' })).status, 'unmatched');
  assert.equal(matchField(evidenceOf({ visibleLabel: '推荐人电话' })).status, 'unmatched');
  assert.equal(matchField(evidenceOf({ visibleLabel: '证明人联系方式' })).status, 'unmatched');
});

test('语种等级考试成绩不得映射 GPA，泛化成绩留空', () => {
  assert.notEqual(matchField(evidenceOf({ visibleLabel: '语种等级考试成绩' })).profileKey, 'education.gpa');
  assert.equal(matchField(evidenceOf({ visibleLabel: '语种等级考试成绩' })).status, 'unmatched');
  assert.equal(matchField(evidenceOf({ visibleLabel: '成绩' })).status, 'unmatched');
});

test('englishName / projectName 不得命中本人姓名', () => {
  assert.equal(matchField(evidenceOf({ id: 'englishName' })).profileKey, undefined);
  assert.notEqual(matchField(evidenceOf({ id: 'projectName' })).profileKey, 'personal.name');
  assert.notEqual(matchField(evidenceOf({ id: 'nationalityName' })).profileKey, 'personal.name');
});

// —— §13.1 内部路径不抢字段（§21.15 冲突裁决表） ——

test('§21.15 冲突裁决表', () => {
  assert.equal(matchField(evidenceOf({ id: 'education.schoolName' })).profileKey, 'education.school');
  assert.equal(matchField(evidenceOf({ id: 'education.collegeName' })).profileKey, 'education.college');
  assert.equal(matchField(evidenceOf({ id: 'education.majorName' })).profileKey, 'education.major');
  assert.equal(matchField(evidenceOf({ id: 'degree', moduleContext: '教育经历' })).profileKey, 'education.degree');
  assert.equal(matchField(evidenceOf({ id: 'experience.companyName' })).profileKey, 'experience.company');
  assert.equal(matchField(evidenceOf({ id: 'experience.positionName' })).profileKey, 'experience.position');
  assert.equal(matchField(evidenceOf({ id: 'experienceDescription', moduleContext: '实习经历' })).profileKey, 'experience.description');
});

test('毕业（在读）院校不命中毕业时间', () => {
  const result = matchField(evidenceOf({ visibleLabel: '毕业（在读）院校', moduleContext: '教育经历' }));
  assert.equal(result.profileKey, 'education.school');
  assert.notEqual(result.coreFieldType, FieldType.GRADUATION_DATE);
});

// —— §13.2 统一候选与别名优先级 ——

function profileWithEmergencyPhone(): ReturnType<typeof createEmptyUserProfile> {
  const profile = createEmptyUserProfile();
  profile.personal.name = '张三';
  profile.personal.phone = '13800000000';
  profile.personal.customFields = [{
    id: 'emergency-1',
    presetKey: 'personal.emergencyPhone',
    name: '紧急联系人电话',
    value: '13900000000',
    type: 'text',
    aliases: ['紧急联系电话', '联系人手机'],
    allowAI: false,
    sensitive: true,
  }];
  return profile;
}

test('紧急联系电话使用紧急联系人电话预设，绝不回退本人手机号（场景A）', () => {
  const profile = profileWithEmergencyPhone();
  const candidates = buildProfileAnswerCandidates(profile);

  const result = matchField(evidenceOf({ visibleLabel: '紧急联系电话' }), { candidates });
  assert.equal(result.status, 'matched');
  assert.equal(result.profileKey, 'personal.emergencyPhone');
  assert.equal(result.candidateId, 'custom:emergency-1');

  // 本人手机号仍正确
  const own = matchField(evidenceOf({ visibleLabel: '手机号码' }), { candidates });
  assert.equal(own.profileKey, 'personal.phone');
  assert.equal(own.coreFieldType, FieldType.PHONE);

  // 站点没有 label、只有 placeholder='紧急联系电话' 时，占位符完整等于系统别名，同样命中预设值。
  const placeholderOnly = matchField(evidenceOf({ visibleLabel: '', placeholder: '紧急联系电话' }), { candidates });
  assert.equal(placeholderOnly.status, 'matched');
  assert.equal(placeholderOnly.profileKey, 'personal.emergencyPhone');
  assert.equal(placeholderOnly.candidateId, 'custom:emergency-1');

  // 上下文小 if 兜底：'紧急联系电话' 不含"联系人"也要命中（已放宽到"紧急联系"）。
  const contextual = matchField(evidenceOf({ visibleLabel: '紧急联系电话' }));
  assert.equal(contextual.profileKey, 'personal.emergencyPhone');

  // 绝不回退到本人手机号：含"紧急"的标题被 phone 规则明确排除。
  const stolen = matchField(evidenceOf({ visibleLabel: '', placeholder: '紧急联系电话' }));
  assert.notEqual(stolen.profileKey, 'personal.phone');
});

test('用户别名优先于系统规则', () => {
  const profile = profileWithEmergencyPhone();
  profile.personal.customFields = [{
    id: 'custom-emergency',
    name: '紧急联系方式',
    value: '13900000000',
    type: 'text',
    aliases: ['应急联系电话'],
    allowAI: false,
    sensitive: true,
  }];
  const candidates = buildProfileAnswerCandidates(profile);

  const result = matchField(evidenceOf({ visibleLabel: '应急联系电话' }), { candidates });
  assert.equal(result.status, 'matched');
  assert.equal(result.confidence, 'exact-user-alias');
  assert.equal(result.candidateId, 'custom:custom-emergency');
});

test('相同别名配置给两个字段时返回 ambiguous', () => {
  const profile = createEmptyUserProfile();
  profile.personal.customFields = [
    { id: 'a', name: '字段A', value: 'A值', type: 'text', aliases: ['紧急联系电话'], allowAI: true, sensitive: false },
    { id: 'b', name: '字段B', value: 'B值', type: 'text', aliases: ['紧急联系电话'], allowAI: true, sensitive: false },
  ];
  const candidates = buildProfileAnswerCandidates(profile);

  const result = matchField(evidenceOf({ visibleLabel: '紧急联系电话' }), { candidates });
  assert.equal(result.status, 'ambiguous');
});

test('别名字段没有值时不参与匹配', () => {
  const profile = createEmptyUserProfile();
  profile.personal.customFields = [
    { id: 'empty', name: '紧急联系电话', value: '', type: 'text', aliases: [], allowAI: true, sensitive: false },
  ];
  const candidates = buildProfileAnswerCandidates(profile);
  const result = matchField(evidenceOf({ visibleLabel: '紧急联系电话' }), { candidates });
  // 字段语义仍正确识别为紧急联系人电话，但空值候选不会注入任何待填值（填充层跳过）。
  assert.equal(result.profileKey, 'personal.emergencyPhone');
  assert.equal(result.candidateId, undefined);
});

test('用户别名覆盖（fieldAliasOverrides）参与最高优先级精确匹配', () => {
  const profile = profileWithEmergencyPhone();
  const candidates = buildProfileAnswerCandidates(profile, {
    'personal.emergencyPhone': { added: ['应急联系电话'] },
  });

  const result = matchField(evidenceOf({ visibleLabel: '应急联系电话' }), { candidates });
  assert.equal(result.status, 'matched');
  assert.equal(result.profileKey, 'personal.emergencyPhone');
  assert.equal(result.confidence, 'exact-user-alias');
});

test('多简历资料的别名互不污染', () => {
  const profileA = profileWithEmergencyPhone();
  const profileB = profileWithEmergencyPhone();
  profileB.personal.phone = '13700000000';

  const candidatesA = buildProfileAnswerCandidates(profileA);
  const candidatesB = buildProfileAnswerCandidates(profileB);
  assert.equal(candidatesA.find(c => c.key === 'personal.phone')?.value, '13800000000');
  assert.equal(candidatesB.find(c => c.key === 'personal.phone')?.value, '13700000000');
});

test('同一预设字段跨记录合并为一个候选，避免重复模块误判 ambiguous', () => {
  const profile = createEmptyUserProfile();
  profile.education = [
    { id: 'e1', school: '甲大学', major: '计算机', degree: '本科', startDate: '', endDate: '', customFields: [{ id: 'd1', presetKey: 'education.academicDegree', name: '学位', value: '学士', type: 'single', aliases: ['获得学位'], allowAI: true, sensitive: false }] },
    { id: 'e2', school: '乙大学', major: '软件', degree: '硕士', startDate: '', endDate: '', customFields: [{ id: 'd2', presetKey: 'education.academicDegree', name: '学位', value: '', type: 'single', aliases: ['获得学位'], allowAI: true, sensitive: false }] },
  ];
  const candidates = buildProfileAnswerCandidates(profile);
  const degreeCandidates = candidates.filter(c => c.key === 'education.academicDegree');
  assert.equal(degreeCandidates.length, 1);
  assert.equal(degreeCandidates[0].value, '学士');

  const result = matchField(evidenceOf({ visibleLabel: '获得学位' }), { candidates });
  assert.equal(result.status, 'matched');
});

test('包含匹配有长度下限：短中文别名不抢字段', () => {
  const profile = createEmptyUserProfile();
  profile.personal.customFields = [
    { id: 'short', name: '学', value: '错误值', type: 'text', aliases: [], allowAI: true, sensitive: false },
  ];
  const candidates = buildProfileAnswerCandidates(profile);
  // 单字名称候选保留，但匹配层不得通过包含关系命中（§6 第 3 层）。
  // '毕业学校' 本身正确命中 education.school，而不是被单字自定义字段抢走。
  const result = matchField(evidenceOf({ visibleLabel: '毕业学校' }), { candidates });
  assert.notEqual(result.candidateId, 'custom:short');
  assert.equal(result.profileKey, 'education.school');
});

// —— 真实站点回归：无标准 label 的 div 标题与纯 placeholder 识别 ——

test('div 短文本标题：兄弟节点与父级 label 子节点都能提取', () => {
  // 结构1：标题是前一个兄弟 div（自我描述 + textarea）
  const textareaLike = {
    tagName: 'TEXTAREA',
    id: '',
    getAttribute: () => null,
    closest: () => null,
    previousElementSibling: { tagName: 'DIV', textContent: '自我描述', querySelector: () => null, previousElementSibling: null },
    parentElement: null,
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLTextAreaElement;
  const ids = FieldMatcher.extractIdentifiers(textareaLike);
  assert.ok(ids.labelText.includes('自我描述'), ids.labelText);
  const match = matchField(FieldMatcher.buildEvidence(ids));
  assert.equal(match.profileKey, 'personal.selfEvaluation');

  // 结构2：表单项容器 <div><div>民族</div><div><input/></div></div>
  const input = {
    tagName: 'INPUT',
    id: '',
    getAttribute: () => null,
    closest: () => null,
    previousElementSibling: null,
    parentElement: {
      children: [
        { textContent: '民族', querySelector: () => null, contains: () => false },
        { textContent: '', querySelector: () => null, contains: (n: unknown) => n === null },
      ],
    },
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLInputElement;
  const ids2 = FieldMatcher.extractIdentifiers(input);
  assert.ok(ids2.labelText.includes('民族'), ids2.labelText);
});

test('纯 placeholder 证据：请输入民族 / 请输入籍贯 走上下文小 if', () => {
  const ethnicity = matchField(evidenceOf({ placeholder: '请输入民族' }));
  assert.equal(ethnicity.profileKey, 'personal.ethnicity');

  const hometown = matchField(evidenceOf({ placeholder: '请输入籍贯' }));
  assert.equal(hometown.profileKey, 'personal.hometown');

  // 排除语境在 placeholder 上同样生效
  const wrong = matchField(evidenceOf({ placeholder: '请输入推荐人电话' }));
  assert.notEqual(wrong.profileKey, 'personal.phone');
});

test('aria-label 作为最后的标题来源', () => {
  const control = {
    tagName: 'INPUT',
    id: '',
    getAttribute: (name: string) => (name === 'aria-label' ? '紧急联系电话' : null),
    closest: () => null,
    previousElementSibling: null,
    parentElement: null,
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLInputElement;
  const ids = FieldMatcher.extractIdentifiers(control);
  assert.ok(ids.labelText.includes('紧急联系电话'), ids.labelText);
  const result = matchField(FieldMatcher.buildEvidence(ids));
  assert.equal(result.profileKey, 'personal.emergencyPhone');
});

test('Moka 真实结构：字段标题在祖父级容器下（壳层>表单项[标题,控件壳]）', () => {
  // input > 控件壳层 > 表单项容器 [标题div, 控件壳层]
  const labelDiv = { textContent: '紧急联系电话', querySelector: () => null, contains: () => false };
  const shell = { contains: (n: unknown) => n === 'EL', querySelector: () => null, children: [] };
  const input = {
    tagName: 'INPUT',
    id: '',
    getAttribute: () => null,
    closest: () => null,
    previousElementSibling: null,
    parentElement: {
      // 控件壳层：只有一个 input 子节点，没有标题
      children: [Object.assign({ contains: () => true }, { textContent: '' })],
      parentElement: {
        children: [labelDiv, shell],
      },
    },
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLInputElement;
  void shell;
  const ids = FieldMatcher.extractIdentifiers(input);
  assert.ok(ids.labelText.includes('紧急联系电话'), ids.labelText);
});

test('校验错误与占位提示不会被当成字段标题', () => {
  const input = {
    tagName: 'INPUT',
    id: '',
    getAttribute: () => null,
    closest: () => null,
    previousElementSibling: { tagName: 'DIV', textContent: '必填项未填写', querySelector: () => null, previousElementSibling: null },
    parentElement: null,
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLInputElement;
  const ids = FieldMatcher.extractIdentifiers(input);
  assert.equal(ids.labelText.includes('必填项未填写'), false);
});

test('深层包装链：Moka 下拉框壳层有多层嵌套时仍能取到标题', () => {
  const labelDiv = { textContent: '出生国家', querySelector: () => null, contains: () => false };
  const input = {
    tagName: 'INPUT',
    id: '',
    getAttribute: () => null,
    closest: () => null,
    previousElementSibling: null,
    parentElement: {
      children: [{ contains: () => true, querySelector: () => null, textContent: '' }],
      parentElement: {
        children: [{ contains: () => true, querySelector: () => null, textContent: '' }],
        parentElement: {
          children: [{ contains: () => true, querySelector: () => null, textContent: '' }],
          parentElement: {
            children: [labelDiv, { contains: (n: unknown) => n === 'EL', querySelector: () => ({}) }],
          },
        },
      },
    },
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLInputElement;
  const ids = FieldMatcher.extractIdentifiers(input);
  assert.ok(ids.labelText.includes('出生国家'), ids.labelText);

  // 深层标题 + 占位符"请选择"也应能命中候选
  const profile = createEmptyUserProfile();
  profile.personal.customFields = [
    { id: 'birth-country', name: '出生国家', value: '中国', type: 'single', aliases: [], allowAI: true, sensitive: false },
  ];
  const result = matchField(evidenceOf({ visibleLabel: '出生国家', placeholder: '请选择' }), {
    candidates: buildProfileAnswerCandidates(profile),
  });
  assert.equal(result.status, 'matched');
  assert.equal(result.profileKey, 'custom:birth-country');
});

test('同值冲突自动裁决：多字段同别名且值一致 → 命中；值不同 → 仍跳过', () => {
  const profile = createEmptyUserProfile();
  profile.personal.customFields = [
    { id: 'a', name: '出生国家', value: '中国', type: 'single', aliases: ['证件国家'], allowAI: true, sensitive: false },
    { id: 'b', name: '国籍', value: '中国', type: 'single', aliases: ['出生国家', '证件国家'], allowAI: true, sensitive: false },
  ];
  const candidates = buildProfileAnswerCandidates(profile);

  const same = matchField(evidenceOf({ visibleLabel: '出生国家' }), { candidates });
  assert.equal(same.status, 'matched');
  assert.ok(same.reason.includes('值一致'));

  const diff = createEmptyUserProfile();
  diff.personal.customFields = [
    { id: 'a', name: '出生国家', value: '中国', type: 'single', aliases: ['证件国家'], allowAI: true, sensitive: false },
    { id: 'b', name: '国籍', value: '美国', type: 'single', aliases: ['出生国家', '证件国家'], allowAI: true, sensitive: false },
  ];
  const conflict = matchField(evidenceOf({ visibleLabel: '出生国家' }), {
    candidates: buildProfileAnswerCandidates(diff),
  });
  assert.equal(conflict.status, 'ambiguous');
});

test('Moka 年/月四格起止时间：无标识属性也能标注为教育日期', () => {
  // 结构：input > 壳层 > 行容器[标题"起止时间", 壳层×4] > 模块"教育背景"
  const makeInput = (placeholder: string, prev: unknown = null) => ({
    tagName: 'INPUT',
    id: '',
    getAttribute: (name: string) => (name === 'placeholder' ? placeholder : null),
    closest: () => null,
    previousElementSibling: prev,
    ownerDocument: { querySelector: () => null, body: null },
  });

  const yearInputs = ['年', '月', '年', '月'].map(text => makeInput(text));
  const wrap = (input: unknown) => ({
    textContent: '',
    children: [input],
    querySelector: () => null,
    querySelectorAll: () => [input],
    contains: (n: unknown) => n === input,
    parentElement: null as unknown,
  });
  const wraps = yearInputs.map(input => {
    const w = wrap(input);
    (input as { parentElement: unknown }).parentElement = w;
    return w;
  });
  const row = {
    textContent: '起止时间',
    children: [{ textContent: '起止时间', querySelector: () => null, contains: () => false }, ...wraps],
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector.includes('input') ? yearInputs : []),
    contains: (n: unknown) => yearInputs.includes(n),
    parentElement: null as unknown,
  };
  wraps.forEach(w => { w.parentElement = row; });
  const moduleNode = {
    textContent: '教育背景 起止时间 学校名称',
    children: [row],
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => true,
    parentElement: null,
  };
  row.parentElement = moduleNode;
  (yearInputs[0] as { parentElement: unknown }).parentElement = wraps[0];

  const ids = FieldMatcher.extractIdentifiers(yearInputs[0] as unknown as HTMLInputElement);
  assert.ok(ids.labelText.includes('入学时间'), ids.labelText);
  assert.ok(ids.labelText.includes('datepart-year'), ids.labelText);

  const start = FieldMatcher.matchFieldType('', '', '年', ids.labelText, 'text', '');
  assert.equal(start.fieldType, FieldType.EDUCATION_START_DATE);

  const idsEnd = FieldMatcher.extractIdentifiers(yearInputs[3] as unknown as HTMLInputElement);
  assert.ok(idsEnd.labelText.includes('毕业时间'), idsEnd.labelText);
  const end = FieldMatcher.matchFieldType('', '', '月', idsEnd.labelText, 'text', '');
  assert.equal(end.fieldType, FieldType.GRADUATION_DATE);
});

test('调剂字段命中求职意向候选，职位规则让位', () => {
  const profile = createEmptyUserProfile();
  profile.personal.customFields = [];
  profile.customModules = [{
    id: 'm-jobintent', presetKey: 'jobIntent', name: '求职意向与期望薪酬', repeatable: false,
    records: [{
      id: 'r1', fields: [
        { id: 'f1', presetKey: 'module.jobIntent.relocation', name: '是否接受城市调剂', value: '是', type: 'boolean', aliases: ['接受调剂城市'], allowAI: true, sensitive: false },
      ],
    }],
  }];
  const candidates = buildProfileAnswerCandidates(profile);
  const result = matchField(evidenceOf({ visibleLabel: '是否接受调剂岗位', placeholder: '请选择' }), { candidates });
  assert.equal(result.status, 'matched');
  assert.equal(result.profileKey, 'module.jobIntent.relocation');
  assert.notEqual(result.profileKey, 'experience.position');
});
