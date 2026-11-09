// 旧版 Python「校招表单助手」profile.json → 新扩展 UserProfile 一次性迁移。
//
// 设计约束：
// - 纯函数，不依赖 chrome API / DOM，便于 Node 单元测试与真实资料离线校验；
// - 只做“保存的原始事实 + 旧语义映射”的搬迁，不生成任何新答案、不编造缺失值；
// - 不打印个人答案值：stats / warnings 只包含计数与通用说明，本模块也不写日志；
// - 对未知段落/字段保留并给出警告，不静默丢数据；对损坏的根结构给出明确错误；
// - 去重只合并身份锚点完全一致的教育记录，冲突值绝不覆盖（保留最完整记录的值并告警）。
//
// 与设置页的关系：设置页读取 profile.json 后调用 convertLegacyProfile()，
// 展示条数摘要，确认后再经 SAVE_USER_PROFILE 覆盖当前活动简历。

import type {
  AwardInfo,
  CertificationInfo,
  CustomInformation,
  EducationInfo,
  ExperienceInfo,
  FieldAliasOverrides,
  PersonalInfo,
  ProfileCustomField,
  ProfileCustomModule,
  ProfileCustomRecord,
  ProfileFieldType,
  ProjectInfo,
  UserProfile,
} from './types.ts';
import {
  AWARD_FIELD_PRESETS,
  DEFAULT_MODULE_PRESETS,
  EDUCATION_FIELD_PRESETS,
  EXPERIENCE_FIELD_PRESETS,
  PERSONAL_FIELD_PRESETS,
  PROJECT_FIELD_PRESETS,
  type ProfileFieldPreset,
  type ProfileModulePreset,
} from './profilePresets.ts';
import { normalizeFieldText } from '../utils/fieldText.ts';

export const LEGACY_PROFILE_FORMAT_VERSION = 1;

export type LegacyProfileImportErrorCode =
  | 'INVALID_ROOT'
  | 'INVALID_FACTS'
  | 'INVALID_RECORDS'
  | 'INVALID_FACT_ENTRY'
  | 'UNSUPPORTED_SCHEMA'
  | 'NEW_EXTENSION_BACKUP';

/** 转换失败时抛出的可读错误；message 不包含任何个人答案值。 */
export class LegacyProfileImportError extends Error {
  readonly code: LegacyProfileImportErrorCode;

  constructor(code: LegacyProfileImportErrorCode, message: string) {
    super(message);
    this.name = 'LegacyProfileImportError';
    this.code = code;
  }
}

export interface LegacyFactsStats {
  total: number;
  imported: number;
  empty: number;
  unknown: number;
  corePersonal: number;
  customFields: number;
  customInformation: number;
  skills: number;
}

export interface LegacyRecordStats {
  input: number;
  imported: number;
}

export interface LegacyEducationStats extends LegacyRecordStats {
  merged: number;
}

export interface LegacyAliasStats {
  /** 旧资料 mappings 条目总数。 */
  mappings: number;
  /** status=ready 的映射条数。 */
  readyMappings: number;
  /** 旧语义关联（semanticLinks）条数。 */
  semanticLinks: number;
  /** 从 ready 映射直接取得 canonicalKey 的条数。 */
  resolvedFromMappings: number;
  /** 实际写入 fieldAliasOverrides 的别名条数（去重后）。 */
  imported: number;
  /** 迁移到多少个新字段（override key 数）。 */
  keys: number;
  /** ready 映射没有可迁移语义键而跳过。 */
  droppedNoCanonical: number;
  /** 旧语义键在新模型中没有明确对应字段而跳过。 */
  droppedUnknownCanonical: number;
  /** 标签过长/疑似选项列表/过于通用而跳过。 */
  droppedUnsafeLabel: number;
  /** 同一标签对应多个新字段，保留第一个。 */
  droppedConflicting: number;
  /** 重复标签（同一个键上重复出现）。 */
  duplicates: number;
}

export interface LegacyImportStats {
  facts: LegacyFactsStats;
  education: LegacyEducationStats;
  projects: LegacyRecordStats;
  experience: LegacyRecordStats;
  awards: LegacyRecordStats;
  certifications: LegacyRecordStats;
  family: LegacyRecordStats;
  languages: LegacyRecordStats;
  publications: LegacyRecordStats;
  customModules: {
    total: number;
    records: number;
    unknown: number;
  };
  customInformation: number;
  aliases: LegacyAliasStats;
  warnings: number;
}

export interface LegacyConvertResult {
  profile: UserProfile;
  stats: LegacyImportStats;
  warnings: string[];
}

export interface LegacyConvertOptions {
  /** 测试用：替换随机 ID 生成器。 */
  createId?: () => string;
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function defaultCreateId(): string {
  const cryptoObject = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  return `legacy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createIdFactory(options: LegacyConvertOptions): () => string {
  return typeof options.createId === 'function' ? options.createId : defaultCreateId;
}

/** 记录字段比较用的文字键：NFKC + 去空白，不删标点（避免把不同名称强行并为一条）。 */
function textKey(value: string): string {
  return (value || '').normalize('NFKC').replace(/\s+/gu, '').trim();
}

/** 日期比较键：统一到 YYYY-MM；无法解析时退化为文字键。 */
function dateKey(value: string): string {
  const text = (value || '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})\s*[-./年]?\s*(\d{1,2})/u);
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) {
      return `${match[1]}-${String(month).padStart(2, '0')}`;
    }
  }
  return textKey(text);
}

const REGION_KEYS = ['province', 'city', 'district'] as const;

function isRegionValue(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  if (!keys.every(key => (REGION_KEYS as readonly string[]).includes(key))) return false;
  return keys.some(key => typeof value[key] === 'string' && String(value[key]).trim() !== '');
}

/** 旧资料把“省/市/区”分级保存为对象；新模型是单行地址，这里按顺序拼接并去重。 */
function joinRegionValue(value: Record<string, unknown>): string {
  let result = '';
  for (const key of REGION_KEYS) {
    const raw = value[key];
    if (typeof raw !== 'string') continue;
    const part = raw.trim();
    if (!part) continue;
    if (!result) {
      result = part;
      continue;
    }
    if (result.includes(part)) continue;
    if (part.includes(result)) {
      result = part;
      continue;
    }
    result += part;
  }
  return result;
}

interface ParsedScalar {
  text: string;
  structured: 'region' | 'json' | null;
}

/** 把旧字段值安全转成字符串；结构化值会标记出来以便汇总警告（不泄露内容）。 */
function readLegacyScalar(value: unknown): ParsedScalar {
  if (typeof value === 'string') {
    return { text: value.trim(), structured: null };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { text: String(value), structured: null };
  }
  if (typeof value === 'boolean') {
    return { text: value ? '是' : '否', structured: null };
  }
  if (value === null || value === undefined) {
    return { text: '', structured: null };
  }
  if (isRecord(value)) {
    if (isRegionValue(value)) {
      return { text: joinRegionValue(value), structured: 'region' };
    }
    try {
      return { text: JSON.stringify(value), structured: 'json' };
    } catch {
      return { text: '', structured: 'json' };
    }
  }
  if (Array.isArray(value)) {
    const parts = value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) return { text: parts.join('、'), structured: 'json' };
    try {
      return { text: JSON.stringify(value), structured: 'json' };
    } catch {
      return { text: '', structured: 'json' };
    }
  }
  return { text: '', structured: 'json' };
}

function errorMessageForEntry(entry: unknown): string | null {
  if (!isRecord(entry)) return '条目不是对象';
  return null;
}

// ---------------------------------------------------------------------------
// 旧字段 / 语义键 → 新模型字段 的资料表
// ---------------------------------------------------------------------------

/** 旧 facts 的中文字段名（来自旧工具页面标签），仅用于“其他信息”展示与别名补充。 */
const LEGACY_FACT_LABELS: Record<string, string> = {
  'basic.name': '姓名',
  'basic.phone': '手机号码',
  'basic.email': '电子邮箱',
  'basic.gender': '性别',
  'basic.birth_date': '出生日期',
  'basic.nationality': '国籍/地区',
  'basic.ethnicity': '民族',
  'basic.marital_status': '婚姻状况',
  'basic.work_years': '工作年限',
  'basic.political_status': '政治面貌',
  'basic.id_type': '证件类型',
  'basic.current_city': '现居住地',
  'basic.household_location': '户口所在地',
  'basic.hometown': '籍贯',
  'basic.gaokao_location': '高考所在地',
  'basic.overseas_student': '是否海外留学生',
  'basic.height': '身高',
  'basic.weight': '体重',
  'basic.student_origin': '入学前户口所在地/生源地',
  'basic.address': '联系地址',
  'basic.postal_code': '邮政编码',
  'basic.id_number': '证件号码',
  'emergency.name': '紧急联系人',
  'emergency.phone': '紧急联系人电话',
  'language.english_level': '英语水平',
  'resume.skills': '专业技能',
  'resume.research': '科研成果',
};

/** 旧记录字段的中文字段名，仅用于保留未知字段时的可读名称。 */
const LEGACY_RECORD_FIELD_LABELS: Record<string, string> = {
  'education.school': '学校',
  'education.major': '专业',
  'education.degree': '学历',
  'education.academic_degree': '学位',
  'education.start_date': '开始时间',
  'education.end_date': '结束时间',
  'education.gpa': 'GPA',
  'education.rank': '排名',
  'education.mode': '培养方式',
  'education.college': '学院',
  'education.courses': '主修课程',
  'education.full_time': '是否全日制',
  'education.major_category': '专业类别',
  'education.city': '所在城市',
  'project.name': '项目名称',
  'project.role': '项目角色',
  'project.start_date': '开始时间',
  'project.end_date': '结束时间',
  'project.description': '项目描述',
  'experience.company': '单位名称',
  'experience.role': '职位/岗位',
  'experience.start_date': '开始时间',
  'experience.end_date': '结束时间',
  'experience.description': '经历描述',
  'award.name': '奖项名称',
  'award.role': '获奖角色',
  'award.date': '获奖时间',
  'award.description': '奖项描述',
  'certificate.name': '证书名称',
  'certificate.date': '获得时间',
  'certificate.description': '说明',
  'certificate.issuer': '颁发机构',
  'certificate.credential_id': '证书编号',
  'family.name': '姓名',
  'family.title': '与本人关系',
  'family.employer': '工作单位',
  'family.position': '职务',
  'family.phone': '联系电话',
  'language.type': '语种',
  'language.proficiency': '熟练程度',
  'language.score': '成绩',
  'language.level': '水平',
  'language.work_language': '是否工作语言',
  'language.obtained_at': '获得时间',
  'publication.name': '论文标题',
  'publication.journal': '期刊/会议名称',
  'publication.date': '发表时间',
  'publication.author_order': '作者排名',
  'publication.type': '论文类型',
  'publication.status': '发表状态',
};

/**
 * 旧 canonicalKey → 新扩展稳定字段 key（fieldAliasOverrides / 候选 key）。
 * 只收录新模型中语义明确的字段；未收录的旧键会在 stats 中计数并写入文档。
 */
const LEGACY_CANONICAL_KEY_MAP: Record<string, string> = {
  'basic.household_location': 'personal.householdRegistration',
  'basic.hometown': 'personal.hometown',
  'basic.gaokao_location': 'personal.gaokaoLocation',
  'basic.current_city': 'personal.currentAddress',
  'basic.student_origin': 'personal.studentOrigin',
  'basic.address': 'personal.mailingAddress',
  'basic.height': 'personal.height',
  'basic.weight': 'personal.weight',
  'basic.highest_degree': 'personal.highestEducation',
  'basic.highest_school': 'education.school',
  'basic.highest_major': 'education.major',
  'basic.graduation_date': 'education.endDate',
  'emergency.name': 'personal.emergencyName',
  'emergency.phone': 'personal.emergencyPhone',
  'family.title': 'module.family.relationship',
  'family.position': 'module.family.position',
  'family.phone': 'module.family.phone',
  'education.school': 'education.school',
  'education.college': 'education.college',
  'education.major': 'education.major',
  'education.gpa': 'education.gpa',
  'education.rank': 'education.ranking',
  'education.mode': 'education.educationType',
  'education.start_date': 'education.startDate',
  'education.major_category': 'education.majorCategory',
  'experience.role': 'experience.position',
  'project.description': 'project.description',
  'project.start_date': 'project.startDate',
  'language.type': 'module.languages.language',
  'language.level': 'module.languages.level',
  'language.score': 'module.languages.score',
  'publication.name': 'module.papers.title',
  'publication.author_order': 'module.papers.authorRank',
  'preference.salary': 'module.jobIntent.salaryExpected',
};

/** 旧页面标签过于通用时不能作为别名，避免把“姓名/电话”类字段绑错。 */
const GENERIC_ALIAS_LABELS = new Set([
  '姓名', '名字', '性别', '关系', '时间', '日期', '学校', '专业', '职位', '职务', '岗位',
  '学历', '学位', '排名', '成绩', '证书', '地址', '备注', '手机号码', '手机号', '移动电话',
  '联系电话', '电话', '邮箱', '电子邮箱', '起止时间', '工作单位', '出生日期', '身高', '体重',
  '民族', '籍贯', '出生年月', '院校', '公司', '单位', '联系方式', '是否',
]);

function sanitizeLegacyAliasLabel(raw: string): string {
  return raw
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[*?？*]+/u, '')
    .replace(/[*?？：:]+$/u, '')
    .trim();
}

/** 返回丢弃原因；null 表示可以作为别名。 */
function rejectAliasLabel(label: string): 'unsafe' | 'generic' | null {
  if (!label) return 'unsafe';
  const normalized = normalizeFieldText(label);
  if (normalized.length < 2) return 'unsafe';
  if (label.length > 40) return 'unsafe';
  if (label.includes('----')) return 'unsafe';
  const years = label.match(/(?:19|20)\d{2}/gu);
  if (years && years.length >= 3) return 'unsafe';
  if ((label.match(/\//gu) || []).length > 4) return 'unsafe';
  if (GENERIC_ALIAS_LABELS.has(label) || GENERIC_ALIAS_LABELS.has(normalized)) return 'generic';
  return null;
}

// ---------------------------------------------------------------------------
// 预设字段构造
// ---------------------------------------------------------------------------

const FIELD_PRESET_BY_KEY = new Map<string, ProfileFieldPreset>();
const PRESET_SCOPES: Array<[string, ProfileFieldPreset[]]> = [
  ['personal', PERSONAL_FIELD_PRESETS],
  ['education', EDUCATION_FIELD_PRESETS],
  ['experience', EXPERIENCE_FIELD_PRESETS],
  ['project', PROJECT_FIELD_PRESETS],
  ['award', AWARD_FIELD_PRESETS],
];
for (const [scope, presets] of PRESET_SCOPES) {
  for (const preset of presets) FIELD_PRESET_BY_KEY.set(`${scope}.${preset.key}`, preset);
}

const MODULE_PRESET_BY_KEY = new Map<string, ProfileModulePreset>(
  DEFAULT_MODULE_PRESETS.map(preset => [preset.key, preset]),
);

type PresetScope = 'personal' | 'education' | 'experience' | 'project' | 'award';

/** 预设字段是否存在（新预设可能由其它改动新增，转换器按“有则用预设、无则保留通用字段”处理）。 */
function hasPresetField(scope: PresetScope, presetKey: string): boolean {
  return FIELD_PRESET_BY_KEY.has(`${scope}.${presetKey}`);
}

/** 按预设构造自定义字段（包含预设的类型/选项/敏感标记），value 来自旧资料。 */
function presetCustomField(
  scope: PresetScope,
  presetKey: string,
  value: string,
  extraAliases: string[],
  createId: () => string,
): ProfileCustomField {
  const preset = FIELD_PRESET_BY_KEY.get(`${scope}.${presetKey}`);
  if (!preset) {
    throw new LegacyProfileImportError('INVALID_RECORDS', `内部错误：未找到预设字段 ${scope}.${presetKey}`);
  }
  return {
    id: createId(),
    presetKey: `${scope}.${presetKey}`,
    name: preset.name,
    value,
    type: preset.type || 'text',
    aliases: dedupeStrings([...(preset.aliases || []), ...extraAliases]),
    ...(preset.options ? { options: [...preset.options] } : {}),
    ...(preset.unit ? { unit: preset.unit } : {}),
    allowAI: !preset.sensitive,
    sensitive: Boolean(preset.sensitive),
  };
}

/** 没有新预设可对应的字段：保留中文名称与值，不猜测语义。 */
function plainCustomField(
  name: string,
  value: string,
  type: ProfileFieldType,
  aliases: string[],
  createId: () => string,
  options: { presetKey?: string; sensitive?: boolean; unit?: string } = {},
): ProfileCustomField {
  return {
    id: createId(),
    ...(options.presetKey ? { presetKey: options.presetKey } : {}),
    name,
    value,
    type,
    aliases: dedupeStrings(aliases),
    ...(options.unit ? { unit: options.unit } : {}),
    allowAI: !options.sensitive,
    sensitive: Boolean(options.sensitive),
  };
}

function presetModuleField(
  moduleKey: string,
  fieldKey: string,
  value: string,
  extraAliases: string[],
  createId: () => string,
): ProfileCustomField {
  const modulePreset = MODULE_PRESET_BY_KEY.get(moduleKey);
  const fieldPreset = modulePreset?.fields.find(item => item.key === fieldKey);
  if (!modulePreset || !fieldPreset) {
    throw new LegacyProfileImportError('INVALID_RECORDS', `内部错误：未找到模块预设字段 ${moduleKey}.${fieldKey}`);
  }
  return {
    id: createId(),
    presetKey: `module.${moduleKey}.${fieldKey}`,
    name: fieldPreset.name,
    value,
    type: fieldPreset.type || 'text',
    aliases: dedupeStrings([...(fieldPreset.aliases || []), ...extraAliases]),
    ...(fieldPreset.options ? { options: [...fieldPreset.options] } : {}),
    ...(fieldPreset.unit ? { unit: fieldPreset.unit } : {}),
    allowAI: !fieldPreset.sensitive,
    sensitive: Boolean(fieldPreset.sensitive),
  };
}

// ---------------------------------------------------------------------------
// 记录读取
// ---------------------------------------------------------------------------

interface ParsedLegacyRecord {
  values: Map<string, string>;
  /** fields 与 identityHints 同时存在且不一致的处数。 */
  hintConflicts: number;
  /** 省/市分级结构被拼接为字符串的字段数。 */
  regionFields: number;
  /** 其它非字符串值被序列化保留的字段数。 */
  structuredFields: number;
}

function readLegacyRecord(entry: unknown): ParsedLegacyRecord | null {
  if (!isRecord(entry)) return null;
  const values = new Map<string, string>();
  let structuredFields = 0;
  let regionFields = 0;
  const fields = isRecord(entry.fields) ? entry.fields : {};
  for (const [key, rawField] of Object.entries(fields)) {
    const rawValue = isRecord(rawField) && 'value' in rawField ? rawField.value : rawField;
    const parsed = readLegacyScalar(rawValue);
    if (parsed.structured === 'region') regionFields += 1;
    else if (parsed.structured) structuredFields += 1;
    if (parsed.text) values.set(key, parsed.text);
  }
  let hintConflicts = 0;
  if (isRecord(entry.identityHints)) {
    for (const [key, rawHint] of Object.entries(entry.identityHints)) {
      const rawValue = isRecord(rawHint) && 'value' in rawHint ? rawHint.value : rawHint;
      const parsed = readLegacyScalar(rawValue);
      if (!parsed.text) continue;
      const existing = values.get(key);
      if (existing === undefined) {
        values.set(key, parsed.text);
      } else if (existing !== parsed.text) {
        hintConflicts += 1;
      }
    }
  }
  if (values.size === 0) return null;
  return { values, hintConflicts, structuredFields, regionFields };
}

interface RecordsSegment {
  modules: Map<string, unknown[]>;
  invalidModules: number;
}

function readRecordsSegment(raw: unknown, warnings: string[]): RecordsSegment {
  const modules = new Map<string, unknown[]>();
  let invalidModules = 0;
  if (!isRecord(raw)) return { modules, invalidModules };
  for (const [moduleName, moduleValue] of Object.entries(raw)) {
    if (Array.isArray(moduleValue)) {
      modules.set(moduleName, moduleValue);
      continue;
    }
    if (isRecord(moduleValue)) {
      modules.set(moduleName, Object.values(moduleValue));
      continue;
    }
    invalidModules += 1;
    warnings.push(`旧资料记录段「${moduleName}」结构无效，已跳过该段。`);
  }
  return { modules, invalidModules };
}

function recordFieldLabel(key: string): string {
  return LEGACY_RECORD_FIELD_LABELS[key] || key;
}

function extraRecordFields(
  values: Map<string, string>,
  handled: Set<string>,
  createId: () => string,
): ProfileCustomField[] {
  const fields: ProfileCustomField[] = [];
  for (const [key, value] of values) {
    if (handled.has(key) || !value) continue;
    fields.push(plainCustomField(recordFieldLabel(key), value, 'text', [key], createId));
  }
  return fields;
}

// ---------------------------------------------------------------------------
// 教育经历：按身份锚点去重
// ---------------------------------------------------------------------------

const EDUCATION_CORE_FIELDS: Array<[string, keyof EducationInfo]> = [
  ['education.school', 'school'],
  ['education.major', 'major'],
  ['education.degree', 'degree'],
  ['education.start_date', 'startDate'],
  ['education.end_date', 'endDate'],
];

const EDUCATION_CUSTOM_PRESETS: Array<[string, string]> = [
  ['education.academic_degree', 'academicDegree'],
  ['education.courses', 'coreCourses'],
  ['education.major_category', 'majorCategory'],
];

const EDUCATION_CUSTOM_FIELDS: Array<[string, string, ProfileFieldType]> = [
  ['education.full_time', '是否全日制', 'single'],
];

function educationAnchor(values: Map<string, string>): string {
  return [
    textKey(values.get('education.school') || ''),
    textKey(values.get('education.degree') || ''),
    dateKey(values.get('education.start_date') || ''),
    dateKey(values.get('education.end_date') || ''),
  ].join('\u0001');
}

interface EducationDedupResult {
  groups: Map<string, string>[];
  merged: number;
  conflicts: number;
}

function dedupeEducation(
  records: ParsedLegacyRecord[],
  warnings: string[],
): EducationDedupResult {
  const grouped = new Map<string, Map<string, string>[]>();
  for (const record of records) {
    const anchor = educationAnchor(record.values);
    const list = grouped.get(anchor);
    if (list) list.push(record.values);
    else grouped.set(anchor, [record.values]);
  }
  let merged = 0;
  let conflicts = 0;
  const output: Map<string, string>[] = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      output.push(new Map(group[0]));
      continue;
    }
    const nonEmpty = (values: Map<string, string>) => {
      let count = 0;
      for (const value of values.values()) if (value.trim()) count += 1;
      return count;
    };
    const baseIndex = group.reduce(
      (best, values, index) => (nonEmpty(values) > nonEmpty(group[best]) ? index : best),
      0,
    );
    const base = new Map(group[baseIndex]);
    for (let index = 0; index < group.length; index += 1) {
      if (index === baseIndex) continue;
      merged += 1;
      for (const [key, value] of group[index]) {
        if (!value.trim()) continue;
        const existing = base.get(key);
        if (!existing || !existing.trim()) base.set(key, value);
        else if (existing !== value) conflicts += 1;
      }
    }
    output.push(base);
  }
  if (conflicts > 0) {
    warnings.push(`教育经历去重合并时发现 ${conflicts} 处字段值冲突，已保留较完整记录的原值，未覆盖。`);
  }

  // 同校但锚点不同的记录不自动合并（可能对应本科/硕士两段），仅提示人工核对。
  const schoolGroups = new Map<string, Map<string, string>[]>();
  for (const values of output) {
    const school = textKey(values.get('education.school') || '');
    if (!school) continue;
    const list = schoolGroups.get(school);
    if (list) list.push(values);
    else schoolGroups.set(school, [values]);
  }
  const potentialDuplicateGroups = [...schoolGroups.values()].filter(group => group.length > 1).length;
  if (potentialDuplicateGroups > 0) {
    warnings.push(`教育经历中有 ${potentialDuplicateGroups} 组同校记录但起止时间/学历不完全一致，未自动合并，请人工核对。`);
  }
  return { groups: output, merged, conflicts };
}

function buildEducationRecord(values: Map<string, string>, createId: () => string): EducationInfo {
  const record: EducationInfo = {
    id: createId(),
    school: values.get('education.school') || '',
    major: values.get('education.major') || '',
    degree: values.get('education.degree') || '',
    startDate: values.get('education.start_date') || '',
    endDate: values.get('education.end_date') || '',
  };
  const college = values.get('education.college');
  if (college) record.college = college;
  const educationType = values.get('education.mode');
  if (educationType) record.educationType = educationType;
  const gpa = values.get('education.gpa');
  if (gpa) record.gpa = gpa;
  const ranking = values.get('education.rank');
  if (ranking) record.ranking = ranking;
  const customFields: ProfileCustomField[] = [];
  for (const [legacyKey, presetKey] of EDUCATION_CUSTOM_PRESETS) {
    const value = values.get(legacyKey);
    if (!value) continue;
    customFields.push(presetCustomField('education', presetKey, value, [recordFieldLabel(legacyKey)], createId));
  }
  for (const [legacyKey, name, type] of EDUCATION_CUSTOM_FIELDS) {
    const value = values.get(legacyKey);
    if (!value) continue;
    customFields.push(plainCustomField(name, value, type, [recordFieldLabel(legacyKey)], createId));
  }
  const schoolCity = values.get('education.city');
  if (schoolCity) {
    customFields.push(hasPresetField('education', 'schoolCity')
      ? presetCustomField('education', 'schoolCity', schoolCity, [recordFieldLabel('education.city')], createId)
      : plainCustomField('所在城市', schoolCity, 'text', [recordFieldLabel('education.city')], createId));
  }
  const handled = new Set<string>([
    ...EDUCATION_CORE_FIELDS.map(([legacyKey]) => legacyKey),
    ...EDUCATION_CUSTOM_PRESETS.map(([legacyKey]) => legacyKey),
    ...EDUCATION_CUSTOM_FIELDS.map(([legacyKey]) => legacyKey),
    'education.city',
  ]);
  customFields.push(...extraRecordFields(values, handled, createId));
  if (customFields.length > 0) record.customFields = customFields;
  return record;
}

// ---------------------------------------------------------------------------
// 基础个人字段构造
// ---------------------------------------------------------------------------

function legacyFactExtraAliases(
  key: string,
  entry: Record<string, unknown>,
): string[] {
  const aliases: string[] = [];
  const canonicalLabel = LEGACY_FACT_LABELS[key];
  if (canonicalLabel) aliases.push(canonicalLabel);
  const sourceLabel = entry.source_label;
  if (typeof sourceLabel === 'string') {
    const trimmed = sourceLabel.trim();
    // 只把中文页面标签补为别名，避免把 `basic.name` 这类内部 key 当标题。
    if (trimmed && /[一-鿿]/u.test(trimmed)) aliases.push(trimmed);
  }
  return dedupeStrings(aliases);
}

function createEmptyProfile(): UserProfile {
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

function splitLegacySkills(text: string): string[] {
  return dedupeStrings(
    text
      .split(/[\r\n]+|、|；|;/u)
      .map(item => item.replace(/^[\s\-•·*]+/u, '').trim()),
  );
}

// ---------------------------------------------------------------------------
// 别名迁移
// ---------------------------------------------------------------------------

interface LegacySemanticLink {
  label: string;
  section: string;
  type: string;
  options: string[];
  canonicalKey: string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function readSemanticLinks(raw: unknown, warnings: string[]): LegacySemanticLink[] {
  const links: LegacySemanticLink[] = [];
  if (raw === undefined || raw === null) return links;
  if (isRecord(raw)) {
    let invalid = 0;
    for (const [key, value] of Object.entries(raw)) {
      if (!isRecord(value) || typeof value.canonicalKey !== 'string' || !value.canonicalKey) {
        invalid += 1;
        continue;
      }
      let parts: unknown;
      try {
        parts = JSON.parse(key);
      } catch {
        invalid += 1;
        continue;
      }
      if (!Array.isArray(parts) || parts.length < 3) {
        invalid += 1;
        continue;
      }
      const [label, section, type] = parts;
      if (typeof label !== 'string' || !label) {
        invalid += 1;
        continue;
      }
      links.push({
        label,
        section: typeof section === 'string' ? section : '',
        type: typeof type === 'string' ? type : '',
        options: asStringArray(parts[3]),
        canonicalKey: value.canonicalKey,
      });
    }
    if (invalid > 0) warnings.push(`旧资料 semanticLinks 中有 ${invalid} 条结构无效，已跳过。`);
    return links;
  }
  if (Array.isArray(raw)) {
    let invalid = 0;
    for (const item of raw) {
      if (!isRecord(item) || typeof item.label !== 'string' || typeof item.canonicalKey !== 'string'
        || !item.canonicalKey) {
        invalid += 1;
        continue;
      }
      links.push({
        label: item.label,
        section: typeof item.section === 'string' ? item.section : '',
        type: typeof item.type === 'string' ? item.type : '',
        options: asStringArray(item.options),
        canonicalKey: item.canonicalKey,
      });
    }
    if (invalid > 0) warnings.push(`旧资料 semanticLinks 中有 ${invalid} 条结构无效，已跳过。`);
    return links;
  }
  warnings.push('旧资料 semanticLinks 段结构未知，未用于别名迁移。');
  return links;
}

interface LegacyPageMapping {
  label: string;
  section: string;
  type: string;
  options: string[];
  status: string;
  canonicalKey: string;
}

function readMappings(raw: unknown, warnings: string[]): { mappings: LegacyPageMapping[]; invalid: number } {
  const mappings: LegacyPageMapping[] = [];
  let invalid = 0;
  const readOne = (value: unknown): LegacyPageMapping | null => {
    if (!isRecord(value) || typeof value.label !== 'string' || !value.label.trim()) return null;
    return {
      label: value.label,
      section: typeof value.section === 'string' ? value.section : '',
      type: typeof value.type === 'string' ? value.type : '',
      options: asStringArray(value.options),
      status: typeof value.status === 'string' ? value.status : '',
      canonicalKey: typeof value.canonicalKey === 'string' ? value.canonicalKey : '',
    };
  };
  if (raw === undefined || raw === null) return { mappings, invalid };
  if (isRecord(raw)) {
    for (const value of Object.values(raw)) {
      const mapping = readOne(value);
      if (mapping) mappings.push(mapping);
      else invalid += 1;
    }
  } else if (Array.isArray(raw)) {
    for (const value of raw) {
      const mapping = readOne(value);
      if (mapping) mappings.push(mapping);
      else invalid += 1;
    }
  } else {
    warnings.push('旧资料 mappings 段结构未知，未迁移页面字段别名。');
    return { mappings, invalid };
  }
  if (invalid > 0) warnings.push(`旧资料页面映射中有 ${invalid} 条结构无效，已跳过。`);
  return { mappings, invalid };
}

function migrateAliases(
  links: LegacySemanticLink[],
  mappings: LegacyPageMapping[],
  warnings: string[],
): { overrides: FieldAliasOverrides | undefined; stats: LegacyAliasStats } {
  const exactIndex = new Map<string, string>();
  const tripleIndex = new Map<string, string>();
  const joinExact = (link: LegacySemanticLink) => JSON.stringify([link.label, link.section, link.type, link.options]);
  const joinTriple = (link: LegacySemanticLink) => JSON.stringify([link.label, link.section, link.type]);
  for (const link of links) {
    if (!exactIndex.has(joinExact(link))) exactIndex.set(joinExact(link), link.canonicalKey);
    if (!tripleIndex.has(joinTriple(link))) tripleIndex.set(joinTriple(link), link.canonicalKey);
  }

  const readyMappings = mappings.filter(mapping => mapping.status === 'ready');
  let resolvedFromMappings = 0;
  let droppedNoCanonical = 0;
  let directCanonicalCount = 0;

  interface Candidate {
    label: string;
    canonicalKey: string;
  }
  const candidates: Candidate[] = [];
  for (const mapping of readyMappings) {
    let canonicalKey = mapping.canonicalKey;
    if (canonicalKey) {
      directCanonicalCount += 1;
    } else {
      canonicalKey = exactIndex.get(JSON.stringify([mapping.label, mapping.section, mapping.type, mapping.options])) || '';
      if (!canonicalKey) {
        canonicalKey = tripleIndex.get(JSON.stringify([mapping.label, mapping.section, mapping.type])) || '';
      }
    }
    if (!canonicalKey) {
      droppedNoCanonical += 1;
      continue;
    }
    resolvedFromMappings += 1;
    candidates.push({ label: mapping.label, canonicalKey });
  }
  for (const link of links) {
    candidates.push({ label: link.label, canonicalKey: link.canonicalKey });
  }

  const overrides: FieldAliasOverrides = {};
  const aliasOwner = new Map<string, string>();
  let imported = 0;
  let droppedUnknownCanonical = 0;
  let droppedUnsafeLabel = 0;
  let droppedConflicting = 0;
  let duplicates = 0;

  for (const candidate of candidates) {
    const newKey = LEGACY_CANONICAL_KEY_MAP[candidate.canonicalKey];
    if (!newKey) {
      droppedUnknownCanonical += 1;
      continue;
    }
    const label = sanitizeLegacyAliasLabel(candidate.label);
    const rejected = rejectAliasLabel(label);
    if (rejected) {
      droppedUnsafeLabel += 1;
      continue;
    }
    const normalized = normalizeFieldText(label);
    const owner = aliasOwner.get(normalized);
    if (owner !== undefined) {
      if (owner === newKey) duplicates += 1;
      else droppedConflicting += 1;
      continue;
    }
    aliasOwner.set(normalized, newKey);
    const existing = overrides[newKey]?.added || [];
    overrides[newKey] = { added: [...existing, label] };
    imported += 1;
  }

  if (mappings.length > 0 && directCanonicalCount === 0) {
    warnings.push(
      `旧资料 mappings 的 canonicalKey 全为空（${mappings.length} 条映射均未保存）；`
      + `别名迁移改以旧语义关联 semanticLinks（${links.length} 条）为来源，并只采用 status=ready 的映射做交叉核对。`,
    );
  }
  if (droppedNoCanonical > 0) {
    warnings.push(
      `旧版页面映射中 ${droppedNoCanonical} 条 status=ready 的记录没有可迁移的语义键`
      + '（旧资料未保存 canonicalKey 且未匹配到语义关联），已跳过。',
    );
  }
  if (droppedUnknownCanonical > 0) {
    warnings.push(
      `旧语义键中有 ${droppedUnknownCanonical} 条在新资料模型里没有明确对应字段，未迁移为别名。`,
    );
  }
  if (droppedUnsafeLabel > 0) {
    warnings.push(`有 ${droppedUnsafeLabel} 条旧页面标签过长、疑似选项列表或过于通用，未迁移为别名。`);
  }
  if (droppedConflicting > 0) {
    warnings.push(`有 ${droppedConflicting} 条页面标签同时对应多个新字段，已保留第一个映射。`);
  }

  const keyCount = Object.keys(overrides).length;
  const normalizedOverrides = keyCount > 0 ? overrides : undefined;
  return {
    overrides: normalizedOverrides,
    stats: {
      mappings: mappings.length,
      readyMappings: readyMappings.length,
      semanticLinks: links.length,
      resolvedFromMappings,
      imported,
      keys: keyCount,
      droppedNoCanonical,
      droppedUnknownCanonical,
      droppedUnsafeLabel,
      droppedConflicting,
      duplicates,
    },
  };
}

// ---------------------------------------------------------------------------
// 主转换
// ---------------------------------------------------------------------------

interface ValidatedRoot {
  facts: Record<string, unknown> | undefined;
  records: Record<string, unknown> | undefined;
  mappingsRaw: unknown;
  semanticLinksRaw: unknown;
}

function validateRoot(raw: unknown, warnings: string[]): ValidatedRoot {
  if (!isRecord(raw)) {
    throw new LegacyProfileImportError(
      'INVALID_ROOT',
      '所选文件不是旧版「校招表单助手」的 profile.json（根节点必须是 JSON 对象）。',
    );
  }
  const looksLikeExtensionBackup = isRecord(raw.data)
    && (raw.data.resumeProfileLibrary !== undefined || raw.data.userProfile !== undefined)
    && raw.facts === undefined;
  if (looksLikeExtensionBackup) {
    throw new LegacyProfileImportError(
      'NEW_EXTENSION_BACKUP',
      '这是新扩展导出的备份文件，请到「数据与同步 → 本地 JSON 备份 → 导入完整数据」导入。',
    );
  }
  if (raw.schemaVersion !== undefined) {
    if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion !== LEGACY_PROFILE_FORMAT_VERSION) {
      throw new LegacyProfileImportError(
        'UNSUPPORTED_SCHEMA',
        `旧资料 schemaVersion=${String(raw.schemaVersion)} 暂不支持，当前仅支持 v${LEGACY_PROFILE_FORMAT_VERSION}。`,
      );
    }
  } else {
    warnings.push('旧资料缺少 schemaVersion，已按 v1 结构尽力解析。');
  }
  const facts = raw.facts;
  const records = raw.records;
  if (facts !== undefined && !isRecord(facts)) {
    throw new LegacyProfileImportError('INVALID_FACTS', '旧资料的 facts 段结构无效（应为对象）。');
  }
  if (records !== undefined && !isRecord(records)) {
    throw new LegacyProfileImportError('INVALID_RECORDS', '旧资料的 records 段结构无效（应为对象）。');
  }
  if (facts === undefined && records === undefined) {
    throw new LegacyProfileImportError(
      'INVALID_ROOT',
      '文件里既没有 facts 也没有 records，无法识别为旧版校招表单助手资料。',
    );
  }
  if (facts === undefined) warnings.push('旧资料缺少 facts 段，个人信息可能不完整。');
  if (records === undefined) warnings.push('旧资料缺少 records 段，教育/项目等经历可能不完整。');
  return { facts, records, mappingsRaw: raw.mappings, semanticLinksRaw: raw.semanticLinks };
}

export function convertLegacyProfile(
  raw: unknown,
  options: LegacyConvertOptions = {},
): LegacyConvertResult {
  const warnings: string[] = [];
  const createId = createIdFactory(options);
  const root = validateRoot(raw, warnings);
  const profile = createEmptyProfile();
  const personal: PersonalInfo = profile.personal;

  const personalCustomFields: ProfileCustomField[] = [];
  const customInformation: CustomInformation[] = [];
  const skills: string[] = [];
  let englishLevel = '';

  const factsStats: LegacyFactsStats = {
    total: 0,
    imported: 0,
    empty: 0,
    unknown: 0,
    corePersonal: 0,
    customFields: 0,
    customInformation: 0,
    skills: 0,
  };
  let regionFactCount = 0;
  let structuredFactCount = 0;

  const markFact = (kind: keyof Pick<LegacyFactsStats,
    'corePersonal' | 'customFields' | 'customInformation' | 'skills'>): void => {
    factsStats[kind] += 1;
    factsStats.imported += 1;
  };

  const pushCustomInformation = (
    name: string,
    content: string,
    moduleName: string,
    fieldType: ProfileFieldType,
    aliases: string[] = [],
    allowAI = false,
  ): void => {
    customInformation.push({
      id: createId(),
      name,
      content,
      moduleName,
      fieldType,
      ...(aliases.length > 0 ? { aliases } : {}),
      allowAI,
      sensitive: false,
    });
  };

  const addPresetPersonal = (presetKey: string, value: string, aliases: string[]): void => {
    personalCustomFields.push(presetCustomField('personal', presetKey, value, aliases, createId));
    markFact('customFields');
  };

  const addPlainPersonal = (
    presetKey: string,
    name: string,
    type: ProfileFieldType,
    value: string,
    aliases: string[],
  ): void => {
    personalCustomFields.push(plainCustomField(name, value, type, aliases, createId, {
      presetKey: `personal.${presetKey}`,
    }));
    markFact('customFields');
  };

  /** 新预设存在时按预设构造（类型/选项/别名统一）；否则退化为通用自定义字段。 */
  const addOptionalPresetPersonal = (
    presetKey: string,
    fallbackName: string,
    fallbackType: ProfileFieldType,
    value: string,
    aliases: string[],
  ): void => {
    if (hasPresetField('personal', presetKey)) addPresetPersonal(presetKey, value, aliases);
    else addPlainPersonal(presetKey, fallbackName, fallbackType, value, aliases);
  };

  // ---- facts ----
  for (const [key, entry] of Object.entries(root.facts ?? {})) {
    factsStats.total += 1;
    const entryProblem = errorMessageForEntry(entry);
    if (entryProblem) {
      throw new LegacyProfileImportError(
        'INVALID_FACT_ENTRY',
        `旧资料 facts 中的条目结构无效（第 ${factsStats.total} 项）。`,
      );
    }
    const fact = entry as Record<string, unknown>;
    const parsed = readLegacyScalar(fact.value);
    if (parsed.structured === 'region') regionFactCount += 1;
    else if (parsed.structured) structuredFactCount += 1;
    const text = parsed.text;
    if (!text) {
      factsStats.empty += 1;
      continue;
    }
    const extraAliases = legacyFactExtraAliases(key, fact);
    switch (key) {
      case 'basic.name': personal.name = text; markFact('corePersonal'); break;
      case 'basic.phone': personal.phone = text; markFact('corePersonal'); break;
      case 'basic.email': personal.email = text; markFact('corePersonal'); break;
      case 'basic.gender': personal.gender = text; markFact('corePersonal'); break;
      case 'basic.birth_date': personal.birthDate = text; markFact('corePersonal'); break;
      case 'basic.political_status': personal.politicalStatus = text; markFact('corePersonal'); break;
      case 'basic.ethnicity': personal.ethnicity = text; markFact('corePersonal'); break;
      case 'basic.hometown': personal.hometown = text; markFact('corePersonal'); break;
      case 'basic.current_city': personal.currentAddress = text; markFact('corePersonal'); break;
      case 'basic.id_number': personal.idCard = text; markFact('corePersonal'); break;
      case 'basic.nationality': addPresetPersonal('nationality', text, extraAliases); break;
      case 'basic.marital_status': addPresetPersonal('maritalStatus', text, extraAliases); break;
      case 'basic.work_years': addPresetPersonal('workYears', text, extraAliases); break;
      case 'basic.id_type': addPresetPersonal('idType', text, extraAliases); break;
      case 'basic.household_location': addPresetPersonal('householdRegistration', text, extraAliases); break;
      case 'basic.address': addPresetPersonal('mailingAddress', text, extraAliases); break;
      case 'basic.height': addPresetPersonal('height', text, extraAliases); break;
      case 'basic.weight': addPresetPersonal('weight', text, extraAliases); break;
      case 'basic.overseas_student': addPresetPersonal('overseasExperience', text, extraAliases); break;
      case 'emergency.name': addPresetPersonal('emergencyName', text, extraAliases); break;
      case 'emergency.phone': addPresetPersonal('emergencyPhone', text, extraAliases); break;
      case 'basic.gaokao_location':
        addOptionalPresetPersonal('gaokaoLocation', '高考所在地', 'address', text, extraAliases);
        break;
      case 'basic.student_origin':
        addOptionalPresetPersonal('studentOrigin', '生源地', 'address', text, extraAliases);
        break;
      case 'basic.postal_code':
        addOptionalPresetPersonal('postalCode', '邮政编码', 'text', text, extraAliases);
        break;
      case 'resume.skills': {
        const parsedSkills = splitLegacySkills(text);
        skills.push(...parsedSkills);
        factsStats.skills += parsedSkills.length;
        factsStats.imported += 1;
        break;
      }
      case 'resume.research':
        pushCustomInformation('科研成果', text, '论文发表', 'textarea', extraAliases);
        markFact('customInformation');
        break;
      case 'language.english_level':
        englishLevel = text;
        // 新版预设已提供“英语水平”字段时优先落到该字段；否则保留为通用自定义字段。
        addOptionalPresetPersonal('englishLevel', '英语水平', 'text', text, extraAliases);
        break;
      default:
        factsStats.unknown += 1;
        pushCustomInformation(
          LEGACY_FACT_LABELS[key] || key,
          text,
          '旧版资料未映射字段',
          'text',
          extraAliases,
        );
        markFact('customInformation');
        break;
    }
  }

  if (regionFactCount > 0) {
    warnings.push(
      `有 ${regionFactCount} 个旧版地区字段保存为“省/市”分级结构，已按“省+市”拼接为单个字符串，请在核对时确认格式。`,
    );
  }
  if (structuredFactCount > 0) {
    warnings.push(`有 ${structuredFactCount} 个旧版事实字段不是字符串，已序列化原样保留，请在核对时确认。`);
  }
  if (factsStats.unknown > 0) {
    warnings.push(`旧资料有 ${factsStats.unknown} 个未识别的 facts 字段，已原样保留在“其他信息”中。`);
  }
  if (factsStats.empty > 0) {
    warnings.push(`旧资料有 ${factsStats.empty} 个 facts 字段为空，未导入。`);
  }

  // ---- records ----
  const { modules: recordModules } = readRecordsSegment(root.records, warnings);
  const education: EducationInfo[] = [];
  const experience: ExperienceInfo[] = [];
  const projects: ProjectInfo[] = [];
  const awards: AwardInfo[] = [];
  const certifications: CertificationInfo[] = [];
  const customModules: ProfileCustomModule[] = [];
  const recordStats = {
    education: { input: 0, imported: 0, merged: 0 },
    projects: { input: 0, imported: 0 },
    experience: { input: 0, imported: 0 },
    awards: { input: 0, imported: 0 },
    certifications: { input: 0, imported: 0 },
    family: { input: 0, imported: 0 },
    languages: { input: 0, imported: 0 },
    publications: { input: 0, imported: 0 },
    unknownModules: 0,
  };
  let hintConflicts = 0;
  let structuredRecordFields = 0;
  let regionRecordFields = 0;
  let unknownRecordFields = 0;
  let missingSchoolCount = 0;
  let missingExperienceCompany = 0;
  let emptyRecordCount = 0;

  const parseModule = (moduleName: string): ParsedLegacyRecord[] => {
    const rawEntries = recordModules.get(moduleName) || [];
    const parsedEntries: ParsedLegacyRecord[] = [];
    for (const rawEntry of rawEntries) {
      const parsed = readLegacyRecord(rawEntry);
      if (!parsed) {
        emptyRecordCount += 1;
        continue;
      }
      hintConflicts += parsed.hintConflicts;
      structuredRecordFields += parsed.structuredFields;
      regionRecordFields += parsed.regionFields;
      parsedEntries.push(parsed);
    }
    return parsedEntries;
  };

  const buildLanguageModuleRecord = (
    values: Map<string, string>,
  ): ProfileCustomRecord | null => {
    const fieldValues = new Map<string, string>();
    const mapping: Record<string, string> = {
      'language.type': 'language',
      'language.proficiency': 'level',
      'language.level': 'level',
      'language.score': 'score',
      'language.work_language': 'workLanguage',
      'language.obtained_at': 'obtainedAt',
    };
    const handled = new Set<string>();
    for (const [legacyKey, fieldKey] of Object.entries(mapping)) {
      handled.add(legacyKey);
      const value = values.get(legacyKey);
      if (value && !fieldValues.get(fieldKey)) fieldValues.set(fieldKey, value);
    }
    const preset = MODULE_PRESET_BY_KEY.get('languages');
    if (!preset) return null;
    const fields = preset.fields.map(fieldPreset => presetModuleField(
      'languages',
      fieldPreset.key,
      fieldValues.get(fieldPreset.key) || '',
      [],
      createId,
    ));
    for (const [key, value] of values) {
      if (handled.has(key) || !value) continue;
      unknownRecordFields += 1;
      fields.push(plainCustomField(recordFieldLabel(key), value, 'text', [key], createId));
    }
    if (!fields.some(field => field.value.trim())) return null;
    return { id: createId(), fields };
  };

  // 教育经历
  const educationRecords = parseModule('教育经历');
  recordStats.education.input = educationRecords.length;
  if (educationRecords.length > 0) {
    const deduped = dedupeEducation(educationRecords, warnings);
    recordStats.education.merged = deduped.merged;
    for (const values of deduped.groups) {
      const record = buildEducationRecord(values, createId);
      if (!record.school.trim()) missingSchoolCount += 1;
      education.push(record);
    }
    recordStats.education.imported = education.length;
  }

  // 项目经历
  const projectRecords = parseModule('项目经历');
  recordStats.projects.input = projectRecords.length;
  for (const { values } of projectRecords) {
    const customFields = extraRecordFields(
      values,
      new Set(['project.name', 'project.role', 'project.start_date', 'project.end_date', 'project.description']),
      createId,
    );
    unknownRecordFields += customFields.length;
    const record: ProjectInfo = {
      id: createId(),
      name: values.get('project.name') || '',
      role: values.get('project.role') || '',
      startDate: values.get('project.start_date') || '',
      endDate: values.get('project.end_date') || '',
      description: values.get('project.description') || '',
      ...(customFields.length > 0 ? { customFields } : {}),
    };
    projects.push(record);
  }
  recordStats.projects.imported = projects.length;

  // 实习经历
  const experienceRecords = parseModule('实习经历');
  recordStats.experience.input = experienceRecords.length;
  for (const { values } of experienceRecords) {
    const customFields = extraRecordFields(
      values,
      new Set(['experience.company', 'experience.role', 'experience.start_date', 'experience.end_date', 'experience.description']),
      createId,
    );
    unknownRecordFields += customFields.length;
    if (!(values.get('experience.company') || '').trim()) missingExperienceCompany += 1;
    const record: ExperienceInfo = {
      id: createId(),
      company: values.get('experience.company') || '',
      position: values.get('experience.role') || '',
      startDate: values.get('experience.start_date') || '',
      endDate: values.get('experience.end_date') || '',
      description: values.get('experience.description') || '',
      ...(customFields.length > 0 ? { customFields } : {}),
    };
    experience.push(record);
  }
  recordStats.experience.imported = experience.length;

  // 获奖经历
  const awardRecords = parseModule('获奖经历');
  recordStats.awards.input = awardRecords.length;
  for (const { values } of awardRecords) {
    const customFields = extraRecordFields(
      values,
      new Set(['award.name', 'award.role', 'award.date', 'award.description']),
      createId,
    );
    unknownRecordFields += customFields.length;
    const record: AwardInfo = {
      id: createId(),
      name: values.get('award.name') || '',
      role: values.get('award.role') || '',
      date: values.get('award.date') || '',
      description: values.get('award.description') || '',
      ...(customFields.length > 0 ? { customFields } : {}),
    };
    awards.push(record);
  }
  recordStats.awards.imported = awards.length;

  // 证书：name/date/issuer/credentialId 进 certifications；description 等其余说明保留在“其他信息”。
  const certificateRecords = parseModule('证书');
  recordStats.certifications.input = certificateRecords.length;
  for (const { values } of certificateRecords) {
    const name = values.get('certificate.name') || '';
    if (!name.trim()) {
      // 没有名称的证书记录不丢弃内容：整体保留到“其他信息”。
      for (const [key, value] of values) {
        if (!value) continue;
        pushCustomInformation(recordFieldLabel(key), value, '证书', 'text', [], false);
      }
      continue;
    }
    certifications.push({
      id: createId(),
      name,
      issuer: values.get('certificate.issuer') || '',
      date: values.get('certificate.date') || '',
      ...(values.get('certificate.credential_id') ? { credentialId: values.get('certificate.credential_id') } : {}),
    });
    const description = values.get('certificate.description');
    if (description) pushCustomInformation('证书说明', description, '证书', 'textarea', [], false);
    const handled = new Set(['certificate.name', 'certificate.date', 'certificate.issuer', 'certificate.credential_id', 'certificate.description']);
    for (const [key, value] of values) {
      if (handled.has(key) || !value) continue;
      unknownRecordFields += 1;
      pushCustomInformation(recordFieldLabel(key), value, '证书', 'text', [], false);
    }
  }
  recordStats.certifications.imported = certifications.length;

  // 家庭信息 → 自定义模块 family（敏感字段保持 sensitive）。
  const familyRecords = parseModule('家庭信息');
  recordStats.family.input = familyRecords.length;
  if (familyRecords.length > 0) {
    const familyPreset = MODULE_PRESET_BY_KEY.get('family');
    if (familyPreset) {
      const module: ProfileCustomModule = {
        id: createId(),
        presetKey: 'family',
        name: familyPreset.name,
        repeatable: familyPreset.repeatable,
        records: [],
      };
      const mapping: Record<string, string> = {
        'family.name': 'name',
        'family.title': 'relationship',
        'family.employer': 'organization',
        'family.position': 'position',
        'family.phone': 'phone',
      };
      for (const { values } of familyRecords) {
        const fieldValues = new Map<string, string>();
        for (const [legacyKey, fieldKey] of Object.entries(mapping)) {
          const value = values.get(legacyKey);
          if (value) fieldValues.set(fieldKey, value);
        }
        const fields = familyPreset.fields.map(fieldPreset => presetModuleField(
          'family',
          fieldPreset.key,
          fieldValues.get(fieldPreset.key) || '',
          [],
          createId,
        ));
        for (const [key, value] of values) {
          if (Object.hasOwn(mapping, key) || !value) continue;
          unknownRecordFields += 1;
          fields.push(plainCustomField(recordFieldLabel(key), value, 'text', [key], createId));
        }
        if (!fields.some(field => field.value.trim())) continue;
        module.records.push({
          id: createId(),
          ...(fieldValues.get('name') ? { title: fieldValues.get('name') } : {}),
          fields,
        });
      }
      if (module.records.length > 0) {
        customModules.push(module);
        recordStats.family.imported = module.records.length;
      }
    }
  }

  // 语言能力 → 自定义模块 languages；facts 里的英语水平补入第一条英语记录。
  const languageRecords = parseModule('语言能力');
  recordStats.languages.input = languageRecords.length;
  {
    const languagePreset = MODULE_PRESET_BY_KEY.get('languages');
    if (languagePreset && (languageRecords.length > 0 || englishLevel)) {
      const module: ProfileCustomModule = {
        id: createId(),
        presetKey: 'languages',
        name: languagePreset.name,
        repeatable: languagePreset.repeatable,
        records: [],
      };
      for (const { values } of languageRecords) {
        const record = buildLanguageModuleRecord(values);
        if (record) module.records.push(record);
      }
      if (englishLevel) {
        const findValue = (record: ProfileCustomRecord, fieldKey: string): ProfileCustomField | undefined =>
          record.fields.find(field => field.presetKey === `module.languages.${fieldKey}`);
        const isEnglish = (record: ProfileCustomRecord): boolean =>
          normalizeFieldText(findValue(record, 'language')?.value || '') === normalizeFieldText('英语');
        const englishRecord = module.records.find(isEnglish);
        if (!englishRecord) {
          const fields = languagePreset.fields.map(fieldPreset => presetModuleField(
            'languages',
            fieldPreset.key,
            fieldPreset.key === 'language' ? '英语' : fieldPreset.key === 'level' ? englishLevel : '',
            [],
            createId,
          ));
          module.records.push({ id: createId(), title: '英语', fields });
        } else {
          const levelField = findValue(englishRecord, 'level');
          if (levelField && !levelField.value.trim()) levelField.value = englishLevel;
          else if (levelField && levelField.value.trim() !== englishLevel) {
            // 英语水平事实已保存在 personal.englishLevel；语言记录里的原值不改写，仅提示核对。
            warnings.push('旧资料中的英语水平与语言记录中的水平不一致，已同时保留，请人工核对。');
          }
        }
      }
      if (module.records.length > 0) {
        customModules.push(module);
        recordStats.languages.imported = module.records.length;
      }
    }
  }

  // 论文发表 → 自定义模块 papers。
  const publicationRecords = parseModule('论文发表');
  recordStats.publications.input = publicationRecords.length;
  if (publicationRecords.length > 0) {
    const papersPreset = MODULE_PRESET_BY_KEY.get('papers');
    if (papersPreset) {
      const module: ProfileCustomModule = {
        id: createId(),
        presetKey: 'papers',
        name: papersPreset.name,
        repeatable: papersPreset.repeatable,
        records: [],
      };
      const mapping: Record<string, string> = {
        'publication.name': 'title',
        'publication.journal': 'venue',
        'publication.date': 'publishedAt',
        'publication.author_order': 'authorRank',
        'publication.type': 'type',
        'publication.status': 'status',
      };
      for (const { values } of publicationRecords) {
        const fieldValues = new Map<string, string>();
        for (const [legacyKey, fieldKey] of Object.entries(mapping)) {
          const value = values.get(legacyKey);
          if (value) fieldValues.set(fieldKey, value);
        }
        const fields = papersPreset.fields.map(fieldPreset => presetModuleField(
          'papers',
          fieldPreset.key,
          fieldValues.get(fieldPreset.key) || '',
          [],
          createId,
        ));
        for (const [key, value] of values) {
          if (Object.hasOwn(mapping, key) || !value) continue;
          unknownRecordFields += 1;
          fields.push(plainCustomField(recordFieldLabel(key), value, 'text', [key], createId));
        }
        if (!fields.some(field => field.value.trim())) continue;
        module.records.push({
          id: createId(),
          ...(fieldValues.get('title') ? { title: fieldValues.get('title') } : {}),
          fields,
        });
      }
      if (module.records.length > 0) {
        customModules.push(module);
        recordStats.publications.imported = module.records.length;
      }
    }
  }

  // 未知记录模块：原样保留为自定义模块，不静默丢弃。
  const knownModules = new Set([
    '教育经历', '项目经历', '证书', '家庭信息', '语言能力', '实习经历', '获奖经历', '论文发表',
  ]);
  for (const moduleName of recordModules.keys()) {
    if (knownModules.has(moduleName)) continue;
    const entries = parseModule(moduleName);
    if (entries.length === 0) continue;
    recordStats.unknownModules += 1;
    const module: ProfileCustomModule = {
      id: createId(),
      name: moduleName,
      repeatable: true,
      records: entries.map(({ values }) => ({
        id: createId(),
        fields: [...values].map(([key, value]) => plainCustomField(
          recordFieldLabel(key),
          value,
          'text',
          [key],
          createId,
        )),
      })),
    };
    customModules.push(module);
    warnings.push(
      `旧资料记录段「${moduleName}」（${entries.length} 条）没有对应的新模型预设，已原样保留为自定义模块。`,
    );
  }

  if (hintConflicts > 0) {
    warnings.push(`旧资料记录中有 ${hintConflicts} 处 identityHints 与正文字段值不一致，已保留正文字段值，请人工核对。`);
  }
  if (regionRecordFields > 0) {
    warnings.push(
      `旧资料记录中有 ${regionRecordFields} 个地址字段保存为“省/市”分级结构，`
      + '已拼接为单个字符串，请人工核对格式。',
    );
  }
  if (structuredRecordFields > 0) {
    warnings.push(`旧资料记录中有 ${structuredRecordFields} 个字段不是字符串，已序列化原样保留。`);
  }
  if (unknownRecordFields > 0) {
    warnings.push(`旧资料记录中有 ${unknownRecordFields} 个未识别字段，已保留为记录内的自定义字段。`);
  }
  if (missingSchoolCount > 0) {
    warnings.push(`教育经历中有 ${missingSchoolCount} 条缺少学校名称，已保留该记录，请人工补充。`);
  }
  if (missingExperienceCompany > 0) {
    warnings.push(`有 ${missingExperienceCompany} 条实习经历缺少单位名称，已保留该记录，请人工补充。`);
  }
  if (emptyRecordCount > 0) {
    warnings.push(`旧资料记录中有 ${emptyRecordCount} 条空记录（没有任何字段值），未导入。`);
  }

  // ---- 别名迁移 ----
  const links = readSemanticLinks(root.semanticLinksRaw, warnings);
  const { mappings } = readMappings(root.mappingsRaw, warnings);
  const aliasResult = migrateAliases(links, mappings, warnings);

  // ---- 摘要 ----
  const knownTopLevel = new Set([
    'schemaVersion', 'facts', 'records', 'mappings', 'semanticLinks', 'updatedAt', 'nextId',
  ]);
  const ignoredSections = Object.keys(raw as Record<string, unknown>)
    .filter(key => !knownTopLevel.has(key));
  if (ignoredSections.length > 0) {
    const shown = ignoredSections.slice(0, 8).join('、');
    const suffix = ignoredSections.length > 8 ? ' 等' : '';
    warnings.push(
      `旧资料中的 ${ignoredSections.length} 个辅助段（${shown}${suffix}）未迁移：`
      + '这些是旧工具的页面观察/学习/绑定状态，新扩展会在真实页面重新学习。',
    );
  }

  profile.personal = {
    ...personal,
    ...(personalCustomFields.length > 0 ? { customFields: personalCustomFields } : {}),
  };
  profile.education = education;
  profile.experience = experience;
  profile.projects = projects;
  profile.awards = awards;
  profile.certifications = certifications;
  profile.skills = skills;
  profile.customInformation = customInformation;
  if (customModules.length > 0) profile.customModules = customModules;
  if (aliasResult.overrides) profile.fieldAliasOverrides = aliasResult.overrides;

  const customModuleRecordCount = customModules.reduce((sum, module) => sum + module.records.length, 0);
  const stats: LegacyImportStats = {
    facts: factsStats,
    education: recordStats.education,
    projects: recordStats.projects,
    experience: recordStats.experience,
    awards: recordStats.awards,
    certifications: recordStats.certifications,
    family: recordStats.family,
    languages: recordStats.languages,
    publications: recordStats.publications,
    customModules: {
      total: customModules.length,
      records: customModuleRecordCount,
      unknown: recordStats.unknownModules,
    },
    customInformation: customInformation.length,
    aliases: aliasResult.stats,
    warnings: warnings.length,
  };

  return { profile, stats, warnings };
}
