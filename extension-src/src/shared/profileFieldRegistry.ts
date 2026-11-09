// 统一字段注册表（方案 §5.3 / §12.2 / §21）。
// 这里是核心资料字段的唯一规则来源：标准名称、系统默认别名、英文复合标识符、
// 上下文关键词与排除语境。预设字段/自定义字段的名称与别名来自用户资料，
// 在 profileAnswerCandidates 中与注册表候选统一。
//
// 约束（§21.16）：
// - 禁止裸 name/id/contact/电话/名称/日期 作为独立充分条件；
// - 模块上下文只用于限定作用域，不能单独决定字段；
// - 具体字段（紧急联系人、国籍、民族…）必须先于普通字段判断。

import { FieldType, type ProfileFieldType } from './types.ts';

export type ModuleScope = 'education' | 'work' | 'project' | 'award' | 'any';

export interface ProfileFieldContextRule {
  /** 标题中需要命中的正向关键词（规范化后包含判断，至少 2 个字符）。 */
  anyOf: string[];
  /** 需要同时存在的关键词。 */
  required?: string[];
  /** 排除语境：命中任一关键词即放弃本规则。 */
  exclude?: string[];
  /** 需要的模块上下文；缺省表示不限模块。 */
  modules?: ModuleScope[];
  /** 页面完全无模块信号时是否允许仅凭具体标题命中（只用于标题本身足够特异的规则）。 */
  fallbackWithoutModule?: boolean;
}

export interface ProfileFieldDefinition {
  /** 稳定资料 key，例如 personal.name / education.school。 */
  key: string;
  /** 有对应 FieldType 的核心字段走既有记录索引管线；否则由候选值直接填写。 */
  fieldType?: FieldType;
  label: string;
  aliases: string[];
  /** 英文复合标识符目标：name/id 的连续词元窗口拼接命中。 */
  compounds?: string[];
  /** 允许单词元命中的目标（gpa、nationality 这类完整语义词）。 */
  singleSegmentCompounds?: string[];
  /** 字段专属上下文规则（第 5 层）。 */
  contextual?: ProfileFieldContextRule;
  sensitive?: boolean;
  valueType: ProfileFieldType;
}

const NAME_EXCLUDE = [
  '紧急联系人', '应急联系人', '紧急联络', '导师', '指导教师', '推荐人', '证明人', '背调',
  '父亲', '母亲', '监护人', '家属', '家庭成员', '项目', '公司', '学校', '学院', '国籍',
  '用户名', '账号', '宠物',
];

export const PROFILE_FIELD_REGISTRY: ProfileFieldDefinition[] = [
  // —— 个人核心字段（§21.4）。判断顺序由 fieldMatcher 的小 if 顺序保证：具体在前。 ——
  {
    key: 'personal.emergencyPhone',
    label: '紧急联系人电话',
    aliases: ['紧急联系电话', '联系人手机', '应急联系人电话', '应急联系人手机', '紧急联系人手机号', '紧急联络电话'],
    compounds: ['emergencyphone', 'emergencycontactphone', 'emergencymobile'],
    contextual: {
      // '紧急联系电话' 不含"联系人"，关键词放宽到"紧急联系/应急联系"。
      anyOf: ['紧急联系人', '应急联系人', '紧急联络人', '紧急联系', '应急联系'],
      required: ['电话|手机|联系方式'],
      exclude: [],
    },
    sensitive: true,
    valueType: 'text',
  },
  {
    key: 'personal.emergencyName',
    label: '紧急联系人姓名',
    aliases: ['紧急联系人', '联系人姓名', '应急联系人姓名', '紧急联络人'],
    compounds: ['emergencycontactname', 'emergencyname', 'emergencycontact'],
    contextual: {
      anyOf: ['紧急联系人', '应急联系人', '紧急联络人'],
      required: ['姓名|名字|联系人'],
      exclude: ['电话', '手机'],
    },
    sensitive: true,
    valueType: 'text',
  },
  {
    key: 'personal.emergencyRelationship',
    label: '紧急联系人关系',
    aliases: ['与紧急联系人关系', '联系人关系', '应急联系人关系', '与本人关系'],
    compounds: ['emergencyrelationship', 'emergencycontactrelationship'],
    contextual: {
      anyOf: ['紧急联系人', '应急联系人', '紧急联络人'],
      required: ['关系'],
      exclude: [],
    },
    sensitive: true,
    valueType: 'single',
  },
  {
    key: 'personal.nationality',
    label: '国籍',
    aliases: ['国家', '国家/地区', '国家地区', 'nationality', 'citizenship', 'countryOfCitizenship'],
    singleSegmentCompounds: ['nationality', 'citizenship'],
    contextual: {
      anyOf: ['国籍', '国家/地区'],
      exclude: ['出生国家', '签发国家', '学校所在国家', '项目国家'],
    },
    valueType: 'single',
  },
  {
    key: 'personal.ethnicity',
    label: '民族',
    aliases: ['所属民族', '民族类别', 'ethnicity', 'ethnicGroup'],
    singleSegmentCompounds: ['ethnicity', 'ethnicgroup'],
    contextual: {
      anyOf: ['民族'],
      exclude: ['国籍', '国家', '民族服装'],
    },
    valueType: 'single',
  },
  {
    key: 'personal.politicalStatus',
    label: '政治面貌',
    aliases: ['政治身份', '政治情况', '政治状态', 'politicalStatus'],
    compounds: ['politicalstatus', 'politicalaffiliation'],
    contextual: {
      anyOf: ['政治面貌', '政治身份', '政治情况', '政治状态', '政治面目'],
      exclude: [],
    },
    valueType: 'single',
  },
  {
    key: 'personal.hometown',
    label: '籍贯',
    aliases: ['原籍', '祖籍', '籍贯所在地', 'nativePlace', 'hometown'],
    compounds: ['nativeplace', 'hometown'],
    contextual: {
      anyOf: ['籍贯', '祖籍', '原籍'],
      exclude: ['户籍', '现居'],
    },
    valueType: 'address',
  },
  {
    key: 'personal.currentAddress',
    label: '现居住地',
    aliases: ['现居地', '目前居住地', '当前所在地', '居住地址', 'currentAddress', '目前所在地', '现居住城市', '当前居住地', '现居城市'],
    contextual: {
      anyOf: ['现居住地', '现居地', '目前居住地', '居住地址', '居住城市', '目前所在地', '现居住城市'],
      exclude: ['户籍', '通讯地址', '通信地址', '家庭地址', '邮寄地址'],
    },
    valueType: 'address',
  },
  {
    key: 'personal.name',
    fieldType: FieldType.NAME,
    label: '姓名',
    aliases: ['本人姓名', '真实姓名', '申请人姓名', '候选人姓名', 'fullName', 'realName', 'applicantName'],
    compounds: ['fullname', 'realname', 'applicantname', 'candidatename', 'personname', 'xingming'],
    contextual: {
      anyOf: ['姓名', '名字'],
      exclude: NAME_EXCLUDE,
    },
    valueType: 'text',
  },
  {
    key: 'personal.gender',
    fieldType: FieldType.GENDER,
    label: '性别',
    aliases: ['本人性别', 'gender', 'sex'],
    contextual: {
      anyOf: ['性别'],
      exclude: ['紧急联系人', '家庭成员'],
    },
    valueType: 'single',
  },
  {
    key: 'personal.birthDate',
    fieldType: FieldType.BIRTH_DATE,
    label: '出生日期',
    aliases: ['出生年月日', '生日', '出生年月', 'birthDate', 'dateOfBirth', 'DOB'],
    compounds: ['birthdate', 'birthday', 'dateofbirth', 'borndate'],
    contextual: {
      anyOf: ['出生日期', '出生年月', '生日'],
      exclude: ['子女', '家属'],
    },
    valueType: 'date',
  },
  {
    key: 'personal.phone',
    fieldType: FieldType.PHONE,
    label: '本人手机号',
    aliases: ['手机号', '手机号码', '本人联系电话', '本人手机', '个人电话', 'mobilePhone', 'phoneNumber', '移动电话', '联系电话'],
    compounds: ['mobilephone', 'phonenumber', 'cellphone', 'telephone', 'shouji'],
    contextual: {
      anyOf: ['手机', '电话', '联系方式'],
      exclude: ['紧急', '应急', '推荐人', '内推人', '证明人', '导师', '父亲', '母亲', '监护人', '家属', '单位', '公司', '传真', '座机', '固定电话', '家庭电话', '家庭住址'],
    },
    valueType: 'text',
  },
  {
    key: 'personal.email',
    fieldType: FieldType.EMAIL,
    label: '邮箱',
    aliases: ['电子邮箱', '个人邮箱', '邮箱地址', 'email', 'emailAddress'],
    compounds: ['emailaddress', 'email', 'mailbox'],
    contextual: {
      anyOf: ['邮箱', '电子邮件'],
      exclude: ['紧急联系人', '推荐人', '单位邮箱', '公司邮箱'],
    },
    valueType: 'text',
  },
  {
    key: 'personal.wechat',
    fieldType: FieldType.WECHAT,
    label: '微信号',
    aliases: ['微信', '个人微信', 'WeChat', 'WeChat ID'],
    compounds: ['wechat', 'wechatid', 'weixin', 'weixinhao'],
    contextual: {
      anyOf: ['微信'],
      exclude: ['紧急联系人', '推荐人'],
    },
    valueType: 'text',
  },
  {
    key: 'personal.idCard',
    fieldType: FieldType.ID_CARD,
    label: '身份证号',
    aliases: ['身份证号码', '公民身份号码', '证件号码', 'idCard', 'identityNumber'],
    compounds: ['idcard', 'idnumber', 'identitycard', 'identitynumber', 'cardnumber'],
    contextual: {
      anyOf: ['身份证', '身份号码'],
      exclude: ['证件类型', '推荐人', '家属', '签发'],
    },
    sensitive: true,
    valueType: 'text',
  },
  {
    key: 'personal.selfEvaluation',
    fieldType: FieldType.SELF_EVALUATION,
    label: '自我评价',
    aliases: ['个人评价', '自我描述', '个人总结', '个人优势', 'selfEvaluation', 'personalSummary'],
    compounds: ['selfevaluation', 'selfassessment', 'personalsummary'],
    contextual: {
      anyOf: ['自我评价', '个人评价', '个人总结', '个人优势', '自我描述'],
      exclude: ['项目描述', '工作描述', '奖项描述'],
    },
    valueType: 'textarea',
  },

  // —— 教育经历核心字段（§21.6） ——
  {
    key: 'education.school',
    fieldType: FieldType.SCHOOL,
    label: '学校',
    aliases: [
      '学校名称', '院校', '院校名称', '就读学校', '就读院校', '毕业院校', '毕业（在读）院校',
      '毕业/在读院校', '在校学校', 'schoolName', 'universityName', 'almaMater',
    ],
    compounds: ['schoolname', 'universityname', 'almamater', 'graduationschool', 'school'],
    singleSegmentCompounds: ['university'],
    contextual: {
      anyOf: ['学校', '院校', '大学'],
      exclude: ['学院', '学校类型', '院校类型', '交换', '所在城市', '学校代码'],
      modules: ['education'],
      fallbackWithoutModule: true,
    },
    valueType: 'text',
  },
  {
    key: 'education.college',
    fieldType: FieldType.COLLEGE,
    label: '学院',
    aliases: ['学院名称', '院系', '所在学院', '所属学院', '系别', '院系名称', 'collegeName', 'departmentName', 'facultyName'],
    compounds: ['collegename', 'departmentname', 'facultyname'],
    contextual: {
      anyOf: ['学院', '院系', '系别'],
      exclude: ['学校名称', '院校名称'],
      modules: ['education'],
      fallbackWithoutModule: true,
    },
    valueType: 'text',
  },
  {
    key: 'education.educationType',
    fieldType: FieldType.EDUCATION_TYPE,
    label: '学历类型/培养方式',
    aliases: ['学习形式', '培养方式', '教育类型', '全日制类型', 'educationType', 'studyType', '受教类型', '培养类型', '是否为全日制'],
    compounds: ['educationtype', 'studytype', 'educationalform'],
    contextual: {
      anyOf: ['学历类型', '学习形式', '培养方式', '教育类型', '受教类型', '全日制', '非全日制'],
      exclude: ['最高学历', '第一学历'],
      modules: ['education'],
      fallbackWithoutModule: true,
    },
    valueType: 'single',
  },
  {
    key: 'education.major',
    fieldType: FieldType.MAJOR,
    label: '专业',
    aliases: ['专业名称', '所学专业', '主修专业', 'majorName', 'fieldOfStudy', 'specialty'],
    compounds: ['majorname', 'fieldofstudy', 'specialty', 'major'],
    contextual: {
      anyOf: ['专业'],
      exclude: ['专业方向', '专业类别', '专业门类', '辅修', '专业排名', '专业课程', '报考专业研究方向'],
      modules: ['education'],
      fallbackWithoutModule: true,
    },
    valueType: 'text',
  },
  {
    key: 'education.degree',
    fieldType: FieldType.DEGREE,
    label: '学历',
    aliases: ['学历层次', '教育程度', 'degree', 'educationLevel', 'qualification'],
    compounds: ['educationlevel', 'qualification', 'degree'],
    singleSegmentCompounds: ['degree'],
    contextual: {
      anyOf: ['学历', '教育程度'],
      exclude: ['最高学历', '学历类型', '学位', '第一学历'],
      modules: ['education'],
      fallbackWithoutModule: true,
    },
    valueType: 'single',
  },
  {
    key: 'education.gpa',
    fieldType: FieldType.GPA,
    label: 'GPA/绩点',
    aliases: ['绩点', '学分绩点', '平均绩点', 'GPA', 'gradePoint', '平均学分绩点', '成绩（GPA）'],
    singleSegmentCompounds: ['gpa'],
    compounds: ['gradepoint', 'averagegpa'],
    contextual: {
      anyOf: ['绩点', 'GPA'],
      exclude: ['满分', '总分', '语言', '考试成绩'],
      modules: ['education'],
      fallbackWithoutModule: true,
    },
    valueType: 'text',
  },
  {
    key: 'education.ranking',
    label: '排名',
    aliases: ['专业排名', '综合排名', '年级排名', '班级排名', '成绩排名', '学习成绩排名', '排名情况'],
    compounds: ['ranking'],
    singleSegmentCompounds: ['ranking'],
    contextual: {
      anyOf: ['排名', '名次'],
      exclude: ['奖项', '获奖', '作者', '论文'],
      modules: ['education'],
    },
    valueType: 'text',
  },
  {
    key: 'education.startDate',
    fieldType: FieldType.EDUCATION_START_DATE,
    label: '入学时间',
    aliases: ['入学日期', '入学年月', '就读开始时间', '教育开始时间', 'enrollmentDate', 'educationStartDate'],
    compounds: ['enrollmentdate', 'educationstartdate', 'admissiondate', 'entrancetime'],
    contextual: {
      anyOf: ['入学时间', '入学日期', '入学年月', '就读开始', '教育开始'],
      modules: ['education'],
    },
    valueType: 'month',
  },
  {
    key: 'education.endDate',
    fieldType: FieldType.GRADUATION_DATE,
    label: '毕业时间',
    aliases: ['毕业日期', '毕业年月', '就读结束时间', 'educationEndDate', 'graduationDate'],
    compounds: ['graduationdate', 'educationenddate', 'graduationtime'],
    contextual: {
      anyOf: ['毕业时间', '毕业日期', '毕业年月', '就读结束', '教育结束', '毕业'],
      exclude: ['院校', '学校'],
      modules: ['education'],
    },
    valueType: 'month',
  },

  // —— 实习/工作经历核心字段（§21.8） ——
  {
    key: 'experience.company',
    fieldType: FieldType.COMPANY,
    label: '公司/单位',
    aliases: ['公司名称', '单位名称', '工作单位', '实习单位', 'employer', 'companyName', 'organizationName'],
    compounds: ['companyname', 'employer', 'organizationname', 'workplace', 'company'],
    singleSegmentCompounds: ['company', 'employer'],
    contextual: {
      anyOf: ['公司', '单位', '雇主'],
      exclude: ['学校', '颁奖', '性质', '规模', '行业'],
      modules: ['work'],
      fallbackWithoutModule: true,
    },
    valueType: 'text',
  },
  {
    key: 'experience.position',
    fieldType: FieldType.POSITION,
    label: '职位/岗位',
    aliases: ['职位名称', '岗位名称', '职务', 'jobTitle', 'positionName'],
    compounds: ['positionname', 'jobtitle', 'jobname'],
    contextual: {
      anyOf: ['职位', '岗位', '职务'],
      exclude: ['证明人', '家庭成员', '类别', '期望', '意向', '调剂'],
      modules: ['work'],
      fallbackWithoutModule: true,
    },
    valueType: 'text',
  },
  {
    key: 'experience.startDate',
    fieldType: FieldType.START_DATE,
    label: '工作开始时间',
    aliases: ['入职时间', '实习开始时间', '任职开始', 'workStartDate'],
    compounds: ['workstartdate', 'entrancejobtime'],
    contextual: {
      anyOf: ['开始时间', '开始日期', '入职时间', '实习开始', '任职开始'],
      modules: ['work'],
    },
    valueType: 'month',
  },
  {
    key: 'experience.endDate',
    fieldType: FieldType.END_DATE,
    label: '工作结束时间',
    aliases: ['离职时间', '实习结束时间', '任职结束', 'workEndDate'],
    compounds: ['workenddate', 'leavingtime'],
    contextual: {
      anyOf: ['结束时间', '结束日期', '离职时间', '实习结束', '任职结束'],
      modules: ['work'],
    },
    valueType: 'month',
  },
  {
    key: 'experience.description',
    fieldType: FieldType.DESCRIPTION,
    label: '工作内容/经历描述',
    aliases: ['岗位职责', '工作职责', '主要工作', '实习内容', 'responsibilities'],
    compounds: ['responsibilities', 'workcontent', 'jobcontent', 'workdescription', 'experiencedescription'],
    contextual: {
      anyOf: ['工作内容', '岗位职责', '工作职责', '实习内容', '工作描述', '经历描述', '主要工作'],
      exclude: ['项目描述', '奖项描述'],
      modules: ['work'],
    },
    valueType: 'textarea',
  },

  // —— 项目经历核心字段（§21.9） ——
  {
    key: 'project.name',
    fieldType: FieldType.PROJECT_NAME,
    label: '项目名称',
    aliases: ['项目名', '课题名称', 'projectName'],
    compounds: ['projectname', 'projecttitle'],
    contextual: {
      anyOf: ['项目名称', '项目名', '课题名称'],
      exclude: ['类别', '类型', '级别', '等级'],
      modules: ['project'],
    },
    valueType: 'text',
  },
  {
    key: 'project.role',
    fieldType: FieldType.PROJECT_ROLE,
    label: '项目角色',
    aliases: ['担任角色', '本人角色', 'projectRole', '项目中职责', '项目职责', '项目中的职责'],
    compounds: ['projectrole'],
    contextual: {
      anyOf: ['项目角色', '担任角色', '本人角色', '承担角色', '项目中职责', '项目职责'],
      exclude: [],
      modules: ['project'],
    },
    valueType: 'text',
  },
  {
    key: 'project.startDate',
    fieldType: FieldType.PROJECT_START_DATE,
    label: '项目开始时间',
    aliases: ['项目起始时间', 'projectStartDate'],
    compounds: ['projectstartdate'],
    contextual: {
      anyOf: ['项目开始', '项目起始', '开始时间'],
      modules: ['project'],
    },
    valueType: 'month',
  },
  {
    key: 'project.endDate',
    fieldType: FieldType.PROJECT_END_DATE,
    label: '项目结束时间',
    aliases: ['项目完成时间', 'projectEndDate'],
    compounds: ['projectenddate'],
    contextual: {
      anyOf: ['项目结束', '项目完成', '结束时间'],
      modules: ['project'],
    },
    valueType: 'month',
  },
  {
    key: 'project.description',
    fieldType: FieldType.PROJECT_DESCRIPTION,
    label: '项目描述',
    aliases: ['项目简介', '项目内容', 'projectDescription'],
    compounds: ['projectdescription'],
    contextual: {
      anyOf: ['项目描述', '项目简介', '项目内容'],
      exclude: [],
      modules: ['project'],
    },
    valueType: 'textarea',
  },

  {
    // 求职意向预设字段的专属规则：'是否接受调剂岗位' 这类标题精确落到
    // module.jobIntent.relocation 候选，不再被职位规则误沾。
    key: 'module.jobIntent.relocation',
    label: '是否接受城市调剂',
    aliases: ['接受调剂城市', '是否服从调剂'],
    contextual: {
      anyOf: ['调剂'],
      exclude: [],
    },
    valueType: 'boolean',
  },

  // —— 奖项/荣誉核心字段（§21.10） ——
  {
    key: 'award.name',
    fieldType: FieldType.AWARD_NAME,
    label: '奖项名称',
    aliases: ['荣誉名称', '获奖名称', 'awardName'],
    compounds: ['awardname', 'honorname', 'prizename'],
    contextual: {
      anyOf: ['名称', '名字'],
      exclude: [],
      modules: ['award'],
    },
    valueType: 'text',
  },
  {
    key: 'award.role',
    fieldType: FieldType.AWARD_ROLE,
    label: '获奖角色',
    aliases: ['奖项角色', '团队角色', 'awardRole'],
    compounds: ['awardrole'],
    contextual: {
      anyOf: ['角色', '担任'],
      exclude: [],
      modules: ['award'],
    },
    valueType: 'text',
  },
  {
    key: 'award.date',
    fieldType: FieldType.AWARD_DATE,
    label: '获奖时间',
    aliases: ['获奖日期', '奖项时间', 'awardDate'],
    compounds: ['awarddate', 'prizetime', 'awardtime'],
    contextual: {
      anyOf: ['时间', '日期'],
      exclude: [],
      modules: ['award'],
    },
    valueType: 'date',
  },
  {
    key: 'award.description',
    fieldType: FieldType.AWARD_DESCRIPTION,
    label: '奖项描述',
    aliases: ['获奖描述', '荣誉描述', 'awardDescription'],
    compounds: ['awarddescription'],
    contextual: {
      anyOf: ['描述', '详情'],
      exclude: [],
      modules: ['award'],
    },
    valueType: 'textarea',
  },

  // —— 扩展语义：旧工具真实字段目录中高频、新模型以预设/自定义字段承接的字段 ——
  // 这些定义没有 FieldType（值由候选层按 key 取），上下文规则只用于"标签不是完整别名"时兜底。
  {
    key: 'personal.studentOrigin',
    label: '生源地',
    aliases: ['生源所在地', '入学前户籍所在地', '入学前户口所在地', '生源地区', '生源'],
    contextual: {
      anyOf: ['生源地', '生源所在地', '生源地区'],
      exclude: ['高考', '毕业'],
    },
    valueType: 'single',
  },
  {
    key: 'personal.gaokaoLocation',
    label: '高考所在地',
    aliases: ['高考地点', '高考报名地', '高考生源地', '高考所在地（省/地区）', '高考所在地（市/区）'],
    contextual: {
      anyOf: ['高考所在地', '高考地点', '高考报名地', '高考生源地'],
      exclude: ['高考成绩', '高考分数'],
    },
    valueType: 'single',
  },
  {
    key: 'personal.postalCode',
    label: '邮政编码',
    aliases: ['邮编', '邮政编号', '邮政编码（6位）'],
    contextual: {
      anyOf: ['邮政编码', '邮编'],
      exclude: ['邮箱', '邮件'],
    },
    valueType: 'text',
  },
  {
    key: 'personal.englishLevel',
    label: '英语水平',
    aliases: ['英语等级', '英语程度', '英语能力水平', '英语水平测试'],
    contextual: {
      anyOf: ['英语水平', '英语等级', '英语程度'],
      exclude: ['成绩', '分数', '考试', '证书'],
    },
    valueType: 'single',
  },
  {
    key: 'personal.highestEducation',
    label: '最高学历',
    aliases: ['学历层次', '最高教育程度', '文化程度'],
    contextual: {
      // 基本信息页汇总字段：教育经历记录内的"学历"由 education.degree 先命中。
      anyOf: ['最高学历', '学历'],
      exclude: ['第一学历', '学历类型', '学历层次', '学位', '学校', '专业', '学历证书', '证书编号', '学信网'],
    },
    valueType: 'single',
  },
  {
    key: 'personal.highestDegree',
    label: '最高学位',
    aliases: ['最高学位层次'],
    contextual: {
      anyOf: ['最高学位', '学位'],
      exclude: ['学历', '辅修', '第二学位', '学位论文', '学位证书', '证书编号'],
    },
    valueType: 'single',
  },
  {
    key: 'education.admissionType',
    label: '入学性质',
    aliases: ['入学方式', '招生类型', '录取方式', '培养性质'],
    contextual: {
      anyOf: ['入学性质', '入学方式', '招生类型', '录取方式'],
      exclude: [],
      modules: ['education'],
      fallbackWithoutModule: true,
    },
    valueType: 'single',
  },
  {
    key: 'education.gpaScale',
    label: 'GPA满分',
    aliases: ['绩点满分', 'GPA总分', '满分绩点', 'GPA满分制'],
    contextual: {
      anyOf: ['绩点满分', '满分绩点', 'GPA满分', 'GPA总分'],
      exclude: ['成绩'],
      modules: ['education'],
      fallbackWithoutModule: true,
    },
    valueType: 'number',
  },
  {
    key: 'education.coreCourses',
    label: '主修 / 核心课程',
    aliases: ['主修课程', '核心课程', '主要课程', '专业课程'],
    contextual: {
      anyOf: ['专业课程', '主修课程', '核心课程', '主要课程'],
      exclude: ['课程成绩', '课程分数'],
      modules: ['education'],
      fallbackWithoutModule: true,
    },
    valueType: 'textarea',
  },
  {
    key: 'module.languages.score',
    label: '语言证书分数',
    aliases: ['英语成绩', '英语分数', '英语等级成绩', '等级成绩'],
    contextual: {
      anyOf: ['英语成绩', '英语分数', '英语等级成绩', '等级成绩'],
      exclude: ['总成绩', '平均成绩'],
    },
    valueType: 'text',
  },
  {
    key: 'module.languages.level',
    label: '语言综合水平',
    aliases: ['熟练掌握程度', '外语水平', '外语能力'],
    contextual: {
      anyOf: ['外语水平', '其他外语水平', '外语能力', '其他外语能力', '熟练程度', '掌握程度'],
      exclude: ['工作语言', '母语'],
    },
    valueType: 'single',
  },
  {
    key: 'module.languages.language',
    label: '语言类型',
    aliases: ['语言类型', '外语类型', '其他外语', '语种类型'],
    contextual: {
      anyOf: ['语言类型', '外语类型', '其他外语', '语种类型'],
      exclude: ['水平', '等级', '成绩'],
    },
    valueType: 'single',
  },
  {
    key: 'module.papers.title',
    label: '论文标题',
    aliases: ['论文名称', '学术成果名称', '论文题目', '成果名称'],
    contextual: {
      anyOf: ['论文标题', '论文名称', '学术成果名称', '论文题目'],
      exclude: ['期刊', '作者', '摘要', '索引'],
    },
    valueType: 'text',
  },
  {
    key: 'module.papers.venue',
    label: '期刊 / 会议名称',
    aliases: ['所属期刊', '期刊名称', '发表期刊', '收录期刊', '期刊收录机构名'],
    contextual: {
      anyOf: ['所属期刊', '期刊名称', '发表期刊', '收录期刊', '期刊收录机构名', '发表刊物'],
      exclude: ['分区', '影响因子'],
    },
    valueType: 'text',
  },
  {
    key: 'module.papers.authorRank',
    label: '作者排名',
    aliases: ['作者排序', '作者顺序', '作者位次', '第几作者'],
    contextual: {
      anyOf: ['作者排序', '作者顺序', '作者位次', '第几作者'],
      exclude: ['通讯作者', '共同一作'],
    },
    valueType: 'number',
  },
  {
    key: 'module.papers.publishedAt',
    label: '发表时间',
    aliases: ['发布时间', '出版时间'],
    contextual: {
      anyOf: ['发布时间', '出版时间'],
      exclude: ['更新'],
    },
    valueType: 'month',
  },
  {
    key: 'module.papers.doi',
    label: 'DOI',
    aliases: ['论文索引号', '检索号', '收录号'],
    contextual: {
      anyOf: ['论文索引号', '检索号', '收录号'],
      exclude: ['页码'],
    },
    valueType: 'text',
  },
  {
    key: 'module.papers.abstract',
    label: '论文摘要',
    aliases: ['论文内容简述', '内容简述', '论文简介', '摘要'],
    contextual: {
      anyOf: ['论文摘要', '论文内容简述', '论文简介', '内容简述'],
      exclude: ['关键词'],
    },
    valueType: 'textarea',
  },
  {
    key: 'module.jobIntent.positions',
    label: '期望岗位',
    aliases: ['期望职位', '意向职位', '申请职位', '第一志愿', '第二志愿', '报考岗位'],
    contextual: {
      anyOf: ['期望职位', '意向职位', '申请职位', '第一志愿', '第二志愿', '报考岗位'],
      exclude: ['城市', '地点', '调剂'],
    },
    valueType: 'multi',
  },
  {
    key: 'module.jobIntent.cities',
    label: '期望工作城市',
    aliases: ['意向工作城市', '意向工作地点', '期望工作地点', '期望工作地', '工作城市', '意向工作地'],
    contextual: {
      anyOf: ['意向工作城市', '期望工作城市', '意向工作地点', '期望工作地点', '期望工作地', '工作城市'],
      exclude: ['调剂'],
    },
    valueType: 'multi',
  },
  {
    key: 'module.jobIntent.arrivalDate',
    label: '最快到岗时间',
    aliases: ['到岗时间', '可到岗时间', '预计到岗时间', '到岗日期'],
    contextual: {
      anyOf: ['到岗时间', '可到岗时间', '最快到岗', '预计到岗'],
      exclude: [],
    },
    valueType: 'date',
  },
  {
    key: 'module.jobIntent.internshipMonths',
    label: '可实习时长',
    aliases: ['可实习时间', '实习时长', '可实习月数', '实习周期'],
    contextual: {
      anyOf: ['可实习时间', '实习时长', '可实习月数', '实习周期'],
      exclude: ['到岗'],
    },
    valueType: 'number',
  },
  {
    key: 'module.jobIntent.salaryExpected',
    label: '期望薪酬（原文）',
    aliases: ['期望年薪', '期望月薪', '期望月薪（税前）', '期望薪资', '期望工资', '期望薪酬'],
    contextual: {
      anyOf: ['期望年薪', '期望月薪', '期望薪资', '期望工资', '期望薪酬'],
      exclude: ['类型', '币种', '下限', '上限', '面议'],
    },
    valueType: 'text',
  },
  {
    key: 'module.jobIntent.overseas',
    label: '是否接受海外派遣',
    aliases: ['是否接受外派', '接受外派', '外派', '海外派遣'],
    contextual: {
      anyOf: ['是否接受外派', '接受外派', '海外派遣'],
      exclude: ['外派地点'],
    },
    valueType: 'boolean',
  },
  {
    key: 'module.family.relationship',
    label: '与本人关系',
    aliases: ['亲属关系', '家庭关系'],
    contextual: {
      anyOf: ['与本人关系', '亲属关系'],
      exclude: ['紧急联系人', '证明人', '推荐人'],
    },
    valueType: 'single',
  },
  {
    key: 'module.campus.position',
    label: '担任职务',
    aliases: ['在校职务', '在校职务名称', '学生干部职务', '校园职务'],
    contextual: {
      anyOf: ['在校职务', '学生干部职务', '校园职务'],
      exclude: ['期望', '意向'],
    },
    valueType: 'text',
  },
];

export const REGISTRY_BY_KEY = new Map(PROFILE_FIELD_REGISTRY.map(def => [def.key, def]));

/** 个人基本字段（personal.*）在资料页直接编辑，别名覆盖也挂在这些 key 上。 */
export function isPersonalCoreKey(key: string): boolean {
  return key.startsWith('personal.');
}

/** 英文裸词黑名单：这些单词元永远不能单独决定一个字段。 */
export const FORBIDDEN_SINGLE_TOKENS = new Set([
  'name', 'id', 'code', 'contact', 'phone', 'tel', 'date', 'time', 'title', 'role',
  'education', 'experience', 'description', 'content', 'score', 'grade',
]);
