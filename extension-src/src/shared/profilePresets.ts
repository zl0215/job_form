import type { ProfileCustomField, ProfileCustomModule, ProfileFieldType, UserProfile } from './types.ts';

export interface ProfileFieldPreset {
  key: string;
  name: string;
  type?: ProfileFieldType;
  aliases?: string[];
  options?: string[];
  unit?: string;
  sensitive?: boolean;
}

export interface ProfileModulePreset {
  key: string;
  name: string;
  repeatable: boolean;
  fields: ProfileFieldPreset[];
}

const yesNo = ['是', '否'];
const level = ['国家级', '省部级', '市级', '校级', '院级', '其他'];
const field = (
  key: string,
  name: string,
  type: ProfileFieldType = 'text',
  aliases: string[] = [],
  options?: string[],
  unit?: string,
  sensitive = false,
): ProfileFieldPreset => ({ key, name, type, aliases, options, unit, sensitive });

export const PERSONAL_FIELD_PRESETS: ProfileFieldPreset[] = [
  field('englishName', '英文姓名 / 姓名拼音', 'text', ['英文名', '姓名拼音', '拼音姓名', 'name in English']),
  field('formerName', '曾用名', 'text', ['原姓名']),
  field('nationality', '国籍', 'single', ['国家', '国家/地区'], ['中国', '其他']),
  field('maritalStatus', '婚姻状况', 'single', ['婚姻情况'], ['未婚', '已婚', '不愿透露']),
  field('height', '身高', 'number', ['身高(cm)', '身高（厘米）'], undefined, 'cm'),
  field('weight', '体重', 'number', ['体重(kg)', '体重（公斤）'], undefined, 'kg'),
  field('bloodType', '血型', 'single', ['血液类型'], ['A型', 'B型', 'O型', 'AB型', '未知']),
  field('health', '健康状况', 'single', ['身体状况', '健康情况'], ['良好', '一般', '其他']),
  field('leftVision', '左眼视力', 'text', ['左眼', '左视力']),
  field('rightVision', '右眼视力', 'text', ['右眼', '右视力']),
  field('colorVision', '色觉', 'single', ['辨色能力', '色盲色弱'], ['正常', '色弱', '色盲']),
  field('highestEducation', '最高学历', 'single', ['学历层次', '最高教育程度', '文化程度'], ['高中', '大专', '本科', '硕士研究生', '博士研究生', '博士后', '其他']),
  field('highestDegree', '最高学位', 'single', ['最高学位层次'], ['无', '学士', '硕士', '博士', '其他']),
  field('studentOrigin', '生源地', 'single', ['生源所在地', '入学前户籍所在地', '入学前户口所在地', '生源地区', '生源']),
  field('gaokaoLocation', '高考所在地', 'single', ['高考地点', '高考报名地', '高考所在地（省/地区）', '高考所在地（市/区）', '高考生源地']),
  field('postalCode', '邮政编码', 'text', ['邮编', '邮政编号']),
  field('englishLevel', '英语水平', 'single', ['英语等级', '英语程度', '英语能力水平', '英语水平测试']),
  field('graduationClass', '毕业届别', 'text', ['毕业年份', '毕业年度', '应届年份'], undefined, '届'),
  field('freshGraduate', '是否应届生', 'boolean', ['应届生', '是否为应届毕业生'], yesNo),
  field('hasWorkExperience', '是否有工作 / 实习经验', 'boolean', ['有无工作经验', '是否有实习经历', '是否有工作经历'], yesNo),
  field('workYears', '工作经验年限', 'number', ['工作年限', '累计工作年限', '工作经验'], undefined, '年'),
  field('overseasExperience', '是否有海外留学 / 交换经历', 'boolean', ['海外留学经历', '海外学习经历', '留学经历', '是否海外留学生', '海外留学生', '海外留学'], yesNo),
  field('householdRegistration', '户籍所在地', 'address', ['户口所在地', '户口地址', '户籍地址']),
  field('mailingAddress', '通讯地址', 'address', ['通信地址', '联系地址', '邮寄地址', '通讯地址/现居住地', '通讯地址或现居住地', '家庭住址', '家庭地址']),
  field('idType', '证件类型', 'single', ['身份证件类型', '证件类别'], ['居民身份证', '护照', '港澳居民来往内地通行证', '台湾居民来往大陆通行证', '其他'], undefined, true),
  field('emergencyName', '紧急联系人姓名', 'text', ['紧急联系人', '联系人姓名'], undefined, undefined, true),
  field('emergencyRelationship', '紧急联系人关系', 'single', ['与紧急联系人关系', '联系人关系'], ['父亲', '母亲', '配偶', '亲属', '朋友', '其他'], undefined, true),
  field('emergencyPhone', '紧急联系人电话', 'text', ['紧急联系电话', '联系人手机'], undefined, undefined, true),
  field('github', 'GitHub / 个人主页', 'url', ['Github', '个人主页', '代码仓库', '技术主页']),
  field('portfolio', '博客 / 作品集', 'url', ['个人博客', '作品集链接', 'Portfolio']),
  field('linkedin', 'LinkedIn', 'url', ['领英']),
  field('hobbies', '兴趣爱好', 'textarea', ['爱好']),
  field('strengths', '特长', 'textarea', ['个人特长', '擅长领域']),
];

export const EDUCATION_FIELD_PRESETS: ProfileFieldPreset[] = [
  field('academicDegree', '学位', 'single', ['获得学位', '学位层次'], ['无', '学士', '硕士', '博士', '其他']),
  field('schoolType', '学校类型', 'multi', ['院校类型', '学校层次'], ['985', '211', '双一流', '普通本科', '海外院校', '其他']),
  field('admissionType', '入学性质', 'single', ['入学方式', '招生类型', '录取方式'], ['统招', '保送', '自主招生', '定向', '委培', '其他']),
  field('majorDirection', '专业方向', 'text', ['研究方向', '专业研究方向']),
  field('schoolCity', '学校所在城市', 'text', ['学校所在地', '院校所在地', '学校所在城市', '院校所在城市', '城市']),
  field('majorCategory', '专业类别', 'single', ['学科门类', '专业门类'], ['工学', '理学', '管理学', '经济学', '文学', '法学', '医学', '艺术学', '其他']),
  field('expectedGraduation', '预计毕业时间', 'month', ['预毕业时间', '预计毕业日期']),
  field('actualGraduation', '实际毕业时间', 'month', ['正式毕业时间']),
  field('programLength', '学制', 'number', ['培养年限', '学制年限', '学制（年）'], undefined, '年'),
  field('gpaScale', 'GPA满分', 'number', ['绩点满分', 'GPA总分', '满分绩点']),
  field('failedCourses', '是否有挂科', 'boolean', ['有无挂科', '是否存在不及格科目', '是否挂科', '挂科'], yesNo),
  field('failedCourseCount', '挂科科目数', 'number', ['不及格科目数'], undefined, '门'),
  field('coreCourses', '主修 / 核心课程', 'textarea', ['主修课程', '核心课程', '主要课程', '专业课程']),
  field('thesisTitle', '毕业论文题目', 'text', ['学位论文题目', '论文名称', '论文题目']),
  field('thesisAdvisor', '毕业论文导师', 'text', ['导师姓名', '研究生导师']),
  field('thesisStatus', '毕业论文状态', 'single', ['论文进度'], ['未开始', '进行中', '已完成', '优秀']),
  field('hasMinor', '是否辅修', 'boolean', ['有无辅修'], yesNo),
  field('minorMajor', '辅修专业', 'text', ['第二专业']),
  field('minorDegree', '辅修学位', 'text', ['第二学位']),
  field('hasExchange', '是否有交换经历', 'boolean', ['海外交换经历', '交换生经历'], yesNo),
  field('exchangeSchool', '交换学校', 'text', ['交换院校']),
  field('exchangePeriod', '交换时间', 'date-range', ['交换起止时间']),
];

export const EXPERIENCE_FIELD_PRESETS: ProfileFieldPreset[] = [
  field('organizationNature', '单位性质', 'single', ['公司性质', '企业性质'], ['国企', '央企', '民企', '外企', '合资', '政府', '事业单位', '其他']),
  field('industry', '单位行业', 'text', ['所属行业', '公司行业']),
  field('organizationSize', '单位规模', 'single', ['公司规模', '企业规模'], ['1-50人', '51-200人', '201-500人', '501-1000人', '1000人以上']),
  field('fortune500', '是否世界500强', 'boolean', ['世界五百强', '是否500强'], yesNo),
  field('department', '部门', 'text', ['所在部门', '所属部门']),
  field('positionCategory', '职位类别', 'single', ['岗位类别', '职能类别'], ['技术', '产品', '运营', '设计', '市场', '职能', '其他']),
  field('workLocation', '工作地点', 'address', ['实习地点', '任职地点']),
  field('fullTimeInternship', '是否全职实习', 'boolean', ['全职实习'], yesNo),
  field('internshipSalary', '实习薪资', 'text', ['实习工资', '薪资标准']),
  field('workResults', '工作成果', 'textarea', ['主要成果', '工作业绩', '实习成果']),
  field('technologies', '使用工具 / 技术', 'multi', ['技术栈', '使用技术', '使用工具']),
  field('leavingReason', '离职原因', 'textarea', ['离职理由']),
  field('referenceName', '证明人姓名', 'text', ['联系人姓名', '背调联系人'], undefined, undefined, true),
  field('referencePosition', '证明人职位', 'text', ['证明人职务'], undefined, undefined, true),
  field('referencePhone', '证明人联系方式', 'text', ['证明人电话'], undefined, undefined, true),
  field('proofAvailable', '是否可提供证明', 'boolean', ['能否提供实习证明'], yesNo),
];

export const PROJECT_FIELD_PRESETS: ProfileFieldPreset[] = [
  field('projectType', '项目类型', 'single', ['项目类别'], ['课程项目', '科研项目', '创业项目', '竞赛项目', '开源项目', '企业项目', '其他']),
  field('projectLevel', '项目级别', 'single', ['项目等级'], level),
  field('personalDuty', '个人职责', 'textarea', ['本人职责', '主要职责', '个人贡献', '项目中职责', '项目职责', '负责内容']),
  field('difficulties', '项目难点', 'textarea', ['技术难点', '关键难点']),
  field('results', '项目成果', 'textarea', ['项目成效', '量化成果']),
  field('technologies', '使用技术 / 工具', 'multi', ['技术栈', '项目技术']),
  field('projectUrl', '项目链接', 'url', ['项目地址', '演示地址']),
  field('launched', '项目是否上线', 'boolean', ['是否已上线', '项目已落地'], yesNo),
  field('userScale', '用户规模', 'text', ['用户量', '使用人数']),
  field('openSource', '是否开源', 'boolean', ['开源项目'], yesNo),
  field('stars', '开源仓库 Star 数', 'number', ['GitHub Stars', 'Star数']),
];

export const AWARD_FIELD_PRESETS: ProfileFieldPreset[] = [
  field('awardCategory', '奖项类别', 'single', ['获奖类别'], ['奖学金', '竞赛获奖', '荣誉称号', '科研成果奖', '其他']),
  field('awardLevel', '奖项级别', 'single', ['获奖级别'], ['国际级', ...level]),
  field('awardGrade', '奖项等级', 'single', ['获奖等级'], ['特等奖', '一等奖', '二等奖', '三等奖', '优秀奖', '入围奖', '其他']),
  field('issuer', '颁奖单位', 'text', ['授奖单位', '颁发机构']),
  field('ranking', '获奖排名', 'number', ['团队排名', '个人排名']),
  field('teamSize', '团队人数', 'number', ['获奖团队人数'], undefined, '人'),
  field('personalAward', '是否个人奖', 'boolean', ['个人奖项'], yesNo),
  field('verifiable', '是否可核验', 'boolean', ['能否核验'], yesNo),
];

export const DEFAULT_MODULE_PRESETS: ProfileModulePreset[] = [
  { key: 'campus', name: '校园经历', repeatable: true, fields: [
    field('organization', '组织名称', 'text', ['社团名称', '学生组织']), field('position', '担任职务', 'text', ['校园职务', '在校职务', '学生干部职务']),
    field('level', '职务级别', 'single', ['组织级别'], ['校级', '院级', '班级', '社团', '其他']),
    field('period', '任职时间', 'date-range', ['开始时间', '结束时间', '任职起止时间']), field('organizationSize', '组织规模', 'number', ['管理人数'], undefined, '人'),
    field('responsibilities', '主要职责', 'textarea', ['工作职责']), field('results', '量化成果', 'textarea', ['主要成果']),
    field('largeEvent', '是否组织过大型活动', 'boolean', ['组织大型活动'], yesNo), field('eventScale', '活动规模', 'number', ['活动人数'], undefined, '人'),
  ] },
  { key: 'languages', name: '语言能力', repeatable: true, fields: [
    field('language', '语言', 'single', ['语种', '语言类型', '外语类型', '其他外语', '外语', '语种类别'],
      ['英语', '日语', '韩语', '法语', '德语', '西班牙语', '俄语', '其他']),
    field('certificate', '证书类型', 'single', ['语言证书', '考试类型'], ['CET-4', 'CET-6', '专四', '专八', '雅思', '托福', '托业', 'GRE', 'JLPT', 'TOPIK', '其他']),
    field('score', '证书分数', 'text', ['考试分数', '成绩', '英语成绩', '英语分数', '等级成绩', '英语等级成绩']),
    field('level', '综合水平', 'single', ['熟练程度', '掌握程度', '外语水平', '其他外语水平', '外语能力', '其他外语能力'], ['精通', '熟练', '良好', '基础']),
    field('workLanguage', '是否可作为工作语言', 'boolean', ['工作语言'], yesNo), field('obtainedAt', '证书获得时间', 'month', ['通过时间', '获得时间']),
  ] },
  { key: 'skills', name: '专业技能明细', repeatable: true, fields: [
    field('name', '技能名称', 'text', ['专业技能']), field('category', '技能类别', 'single', ['技能分类'], ['编程语言', '框架', '数据库', '设计工具', '办公软件', '数据分析', '实验技术', '其他']),
    field('level', '熟练程度', 'single', ['掌握程度'], ['精通', '熟练', '掌握', '了解']), field('duration', '使用时长', 'number', ['使用年限'], undefined, '月'),
    field('projectVerified', '是否有项目验证', 'boolean', ['是否用于项目'], yesNo), field('relatedProject', '关联项目', 'text', ['应用项目']),
  ] },
  { key: 'papers', name: '学术论文', repeatable: true, fields: [
    field('title', '论文标题', 'text', ['论文题目', '论文名称', '学术成果名称', '成果题目']), field('type', '论文类型', 'single', ['论文类别'], ['期刊论文', '会议论文', '综述', '其他']),
    field('status', '发表状态', 'single', ['论文状态'], ['已发表', '已录用', '在投', '在审', '修改中']), field('authorRank', '作者排名', 'number', ['第几作者', '作者排序', '作者顺序', '作者位次']),
    field('coFirst', '是否共同一作', 'boolean', ['共同第一作者'], yesNo), field('corresponding', '是否通讯作者', 'boolean', ['通讯作者'], yesNo),
    field('venue', '期刊 / 会议名称', 'text', ['发表刊物', '会议名称', '所属期刊', '期刊名称', '发表期刊', '收录期刊', '期刊收录机构名']), field('indexing', '收录类型', 'multi', ['检索类型'], ['SCI', 'SCIE', 'SSCI', 'EI', 'CSSCI', '北大核心', 'CSCD', '其他']),
    field('partition', '分区 / CCF等级', 'text', ['JCR分区', '中科院分区', 'CCF等级']), field('publishedAt', '发表时间', 'month', ['出版时间', '发布时间']),
    field('doi', 'DOI', 'text', ['论文DOI', '论文索引号', '检索号', '收录号']), field('url', '论文链接', 'url', ['论文地址']), field('abstract', '论文摘要', 'textarea', ['摘要', '论文内容简述', '内容简述', '论文简介']), field('keywords', '关键词', 'multi', ['关键字']),
  ] },
  { key: 'research', name: '科研项目', repeatable: true, fields: [
    field('name', '项目名称', 'text', ['课题名称']), field('level', '项目级别', 'single', ['课题级别'], level), field('source', '项目来源', 'text', ['课题来源']),
    field('number', '项目编号', 'text', ['课题编号']), field('role', '项目角色', 'single', ['本人角色'], ['主持人', '核心成员', '参与者']),
    field('period', '项目时间', 'date-range', ['项目起止时间']), field('funding', '项目经费', 'number', ['课题经费'], undefined, '万元'),
    field('status', '项目状态', 'single', ['课题状态'], ['进行中', '已结题', '已验收']), field('description', '项目描述', 'textarea', ['课题描述']),
    field('contribution', '个人贡献', 'textarea', ['本人贡献']), field('results', '项目成果', 'textarea', ['科研成果']),
  ] },
  { key: 'patents', name: '专利 / 软件著作权', repeatable: true, fields: [
    field('type', '类型', 'single', ['成果类型'], ['发明专利', '实用新型', '外观设计', '软件著作权']), field('name', '名称', 'text', ['专利名称', '软著名称']),
    field('applicationNumber', '申请号 / 登记号', 'text', ['登记号', '申请号']), field('authorizationNumber', '公开号 / 授权号', 'text', ['授权号', '公开号']),
    field('status', '状态', 'single', ['申请状态'], ['申请中', '已受理', '已公开', '已授权', '已驳回']), field('rank', '申请人排名', 'number', ['发明人排名']),
    field('firstInventor', '是否第一发明人', 'boolean', ['第一发明人'], yesNo), field('appliedAt', '申请时间', 'date', ['提交时间']),
    field('authorizedAt', '授权时间', 'date', ['获批时间']), field('owner', '专利权人', 'text', ['著作权人']), field('abstract', '摘要', 'textarea', ['专利摘要']),
  ] },
  { key: 'jobIntent', name: '求职意向与期望薪酬', repeatable: false, fields: [
    field('positions', '期望岗位', 'multi', ['意向岗位', '求职岗位', '期望职位', '意向职位', '申请职位', '第一志愿', '第二志愿', '第1志愿', '第2志愿', '报考岗位']),
    field('category', '期望岗位类别', 'single', ['意向职位类别'], ['技术', '产品', '运营', '设计', '市场', '职能', '其他']),
    field('industries', '期望行业', 'multi', ['意向行业']), field('employmentType', '期望工作性质', 'single', ['工作类型'], ['全职', '兼职', '实习', '均可']),
    field('cities', '期望工作城市', 'multi', ['意向城市', '期望地点', '意向工作城市', '意向工作地点', '期望工作地点', '工作城市', '意向工作地', '期望工作地']),
    field('arrivalDate', '最快到岗时间', 'date', ['可到岗时间', '到岗时间', '预计到岗时间', '到岗日期']),
    field('internshipMonths', '可实习时长', 'number', ['实习周期', '可实习时间', '实习时长', '可实习月数', '实习时间'], undefined, '月'),
    field('jobStatus', '求职状态', 'single', ['当前状态'], ['尚未毕业', '即将毕业', '已毕业', '在职看机会']),
    field('relocation', '是否接受城市调剂', 'boolean', ['接受调剂城市'], yesNo), field('travel', '是否接受出差', 'boolean', ['能否出差'], yesNo),
    field('shift', '是否接受轮班', 'boolean', ['能否倒班'], yesNo), field('overseas', '是否接受海外派遣', 'boolean', ['海外工作'], yesNo),
    field('salaryType', '薪酬类型', 'single', ['期望薪资类型'], ['月薪', '年薪', '日薪']), field('salaryMin', '期望薪酬下限', 'number', ['最低期望薪资']),
    field('salaryMax', '期望薪酬上限', 'number', ['最高期望薪资']), field('salaryCurrency', '薪酬币种', 'single', ['工资币种'], ['人民币', '美元', '其他']),
    field('salaryExpected', '期望薪酬（原文）', 'text', ['期望年薪', '期望月薪', '期望月薪（税前）', '期望薪资', '期望工资', '期望年薪（税前）']),
    field('negotiable', '薪酬是否可谈', 'boolean', ['薪资面议'], yesNo), field('benefits', '其他福利要求', 'textarea', ['福利期望']),
  ] },
  { key: 'family', name: '家庭成员', repeatable: true, fields: [
    field('name', '姓名', 'text', ['家属姓名'], undefined, undefined, true), field('relationship', '与本人关系', 'single', ['关系', '亲属关系'], ['父亲', '母亲', '配偶', '兄弟姐妹', '其他'], undefined, true),
    field('organization', '工作单位', 'text', ['所在单位'], undefined, undefined, true), field('position', '职务', 'text', ['职位'], undefined, undefined, true),
    field('phone', '联系电话', 'text', ['手机号码'], undefined, undefined, true),
  ] },
];

export const EXTRA_TEMPLATE_PRESETS: ProfileModulePreset[] = [
  { key: 'books', name: '学术著作与教材', repeatable: true, fields: [
    field('name', '著作名称'), field('type', '类型', 'single', [], ['专著', '编著', '译著', '教材']), field('publisher', '出版社'),
    field('isbn', 'ISBN'), field('publishedAt', '出版时间', 'month'), field('authorRank', '作者排名', 'number'), field('writtenWords', '本人撰写字数', 'number', [], undefined, '万字'),
  ] },
  { key: 'conferences', name: '学术会议与活动', repeatable: true, fields: [
    field('name', '会议名称'), field('level', '会议级别', 'single', [], ['国际顶会', '国际普通', '国内一级', '国内普通']), field('location', '会议地点', 'address'),
    field('date', '会议时间', 'month'), field('role', '参与角色', 'single', [], ['口头报告', '海报展示', '参会', '组织者']), field('reportTitle', '报告题目'), field('invited', '是否受邀', 'boolean', [], yesNo),
  ] },
];

export const ALL_TEMPLATE_PRESETS = [...DEFAULT_MODULE_PRESETS, ...EXTRA_TEMPLATE_PRESETS];

function fieldKey(scope: string, key: string): string {
  return `${scope}.${key}`;
}

function createField(scope: string, preset: ProfileFieldPreset): ProfileCustomField {
  return {
    id: crypto.randomUUID(),
    presetKey: fieldKey(scope, preset.key),
    name: preset.name,
    value: '',
    type: preset.type || 'text',
    aliases: preset.aliases || [],
    ...(preset.options ? { options: preset.options } : {}),
    ...(preset.unit ? { unit: preset.unit } : {}),
    allowAI: !preset.sensitive,
    sensitive: Boolean(preset.sensitive),
  };
}

export function mergePresetFields(
  existing: ProfileCustomField[] = [],
  scope: string,
  presets: ProfileFieldPreset[],
): ProfileCustomField[] {
  const remaining = [...existing];
  const seeded = presets.map(preset => {
    const key = fieldKey(scope, preset.key);
    const index = remaining.findIndex(item => item.presetKey === key || (!item.presetKey && item.name === preset.name));
    if (index < 0) return createField(scope, preset);
    const current = remaining.splice(index, 1)[0];
    return {
      ...createField(scope, preset),
      ...current,
      presetKey: key,
      aliases: Array.from(new Set([...(preset.aliases || []), ...(current.aliases || [])])),
      ...(current.options?.length ? { options: current.options } : preset.options ? { options: preset.options } : {}),
    };
  });
  return [...seeded, ...remaining];
}

export function createPresetModule(preset: ProfileModulePreset, builtIn = false): ProfileCustomModule {
  return {
    id: builtIn ? `preset-module-${preset.key}` : crypto.randomUUID(),
    ...(builtIn ? { presetKey: preset.key } : {}),
    name: preset.name,
    repeatable: preset.repeatable,
    records: [{ id: crypto.randomUUID(), fields: mergePresetFields([], `module.${preset.key}`, preset.fields) }],
  };
}

function mergeDefaultModules(existing: ProfileCustomModule[]): ProfileCustomModule[] {
  // certificates 曾短暂作为内置模块出现；用户确认不再需要，旧内置项也一并移除。
  const result = existing.filter(module => module.presetKey !== 'certificates');
  for (const preset of DEFAULT_MODULE_PRESETS) {
    const index = result.findIndex(module => module.presetKey === preset.key || (!module.presetKey && module.name === preset.name));
    if (index < 0) {
      result.push(createPresetModule(preset, true));
      continue;
    }
    const current = result[index];
    const records = current.records.length > 0 ? current.records : [{ id: crypto.randomUUID(), fields: [] }];
    result[index] = {
      ...current,
      presetKey: preset.key,
      records: records.map(record => ({
        ...record,
        fields: mergePresetFields(record.fields, `module.${preset.key}`, preset.fields),
      })),
    };
  }
  const common = DEFAULT_MODULE_PRESETS
    .map(preset => result.find(module => module.presetKey === preset.key))
    .filter((module): module is ProfileCustomModule => Boolean(module));
  const custom = result.filter(module => !module.presetKey);
  return [...common, ...custom];
}

function mergeLegacySkills(modules: ProfileCustomModule[], legacySkills: string[]): ProfileCustomModule[] {
  const values = Array.from(new Set(legacySkills.map(value => value.trim()).filter(Boolean)));
  if (values.length === 0) return modules;
  const moduleIndex = modules.findIndex(module => module.presetKey === 'skills');
  if (moduleIndex < 0) return modules;
  const skillModule = modules[moduleIndex];
  if (skillModule.records.some(record => record.fields.some(field => field.value.trim()))) return modules;
  const templateFields = skillModule.records[0]?.fields || [];
  const records = values.map((value, index) => ({
    id: index === 0 && skillModule.records[0] ? skillModule.records[0].id : crypto.randomUUID(),
    title: value,
    fields: templateFields.map(field => ({
      ...field,
      id: index === 0 ? field.id : crypto.randomUUID(),
      value: field.presetKey === 'module.skills.name' ? value : '',
    })),
  }));
  const next = [...modules];
  next[moduleIndex] = { ...skillModule, records };
  return next;
}

export function prepareProfilePresets(profile: UserProfile): UserProfile {
  const customModules = mergeLegacySkills(
    mergeDefaultModules(profile.customModules || []),
    profile.skills || [],
  );
  return {
    ...profile,
    personal: {
      ...profile.personal,
      customFields: mergePresetFields(profile.personal.customFields, 'personal', PERSONAL_FIELD_PRESETS),
    },
    education: profile.education.map(record => ({ ...record, customFields: mergePresetFields(record.customFields, 'education', EDUCATION_FIELD_PRESETS) })),
    experience: profile.experience.map(record => ({ ...record, customFields: mergePresetFields(record.customFields, 'experience', EXPERIENCE_FIELD_PRESETS) })),
    projects: profile.projects.map(record => ({ ...record, customFields: mergePresetFields(record.customFields, 'project', PROJECT_FIELD_PRESETS) })),
    awards: profile.awards.map(record => ({ ...record, customFields: mergePresetFields(record.customFields, 'award', AWARD_FIELD_PRESETS) })),
    customModules,
  };
}

export function createRecordPresetFields(scope: 'education' | 'experience' | 'project' | 'award'): ProfileCustomField[] {
  const presets = scope === 'education'
    ? EDUCATION_FIELD_PRESETS
    : scope === 'experience'
      ? EXPERIENCE_FIELD_PRESETS
      : scope === 'project'
        ? PROJECT_FIELD_PRESETS
        : AWARD_FIELD_PRESETS;
  return mergePresetFields([], scope, presets);
}
