// 用户资料数据模型
export interface UserProfile {
  personal: PersonalInfo;
  education: EducationInfo[];
  experience: ExperienceInfo[];
  projects: ProjectInfo[];
  awards: AwardInfo[];
  customInformation: CustomInformation[];
  customModules?: ProfileCustomModule[];
  skills: string[];
  certifications: CertificationInfo[];
  resume?: ResumeInfo;
  // 用户为字段补充的匹配别名（阶段 3；按稳定 key 保存，旧资料缺省按空对象处理）。
  fieldAliasOverrides?: FieldAliasOverrides;
}

export interface FieldAliasOverride {
  added: string[];
}

export type FieldAliasOverrides = Partial<Record<string, FieldAliasOverride>>;

export interface CustomInformation {
  id: string;
  name: string;
  content: string;
  aliases?: string[];
  moduleName?: string;
  fieldType?: ProfileFieldType;
  unit?: string;
  allowAI?: boolean;
  sensitive?: boolean;
}

export type ProfileFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'year'
  | 'month'
  | 'date'
  | 'single'
  | 'multi'
  | 'boolean'
  | 'url'
  | 'file'
  | 'date-range'
  | 'address';

export interface ProfileCustomField {
  id: string;
  presetKey?: string;
  name: string;
  value: string;
  type: ProfileFieldType;
  aliases: string[];
  options?: string[];
  unit?: string;
  allowAI: boolean;
  sensitive: boolean;
}

export interface ProfileCustomRecord {
  id: string;
  title?: string;
  fields: ProfileCustomField[];
}

export interface ProfileCustomModule {
  id: string;
  presetKey?: string;
  name: string;
  repeatable: boolean;
  records: ProfileCustomRecord[];
}

export interface PersonalInfo {
  name: string;
  gender: string;
  birthDate: string;
  phone: string;
  email: string;
  wechat?: string;
  idCard?: string;
  politicalStatus?: string;
  ethnicity?: string;
  hometown?: string;
  currentAddress?: string;
  selfEvaluation?: string;
  customFields?: ProfileCustomField[];
}

export interface EducationInfo {
  id: string;
  school: string;
  college?: string;
  educationType?: string;
  major: string;
  degree: string;
  startDate: string;
  endDate: string;
  gpa?: string;
  ranking?: string;
  customFields?: ProfileCustomField[];
}

export interface ExperienceInfo {
  id: string;
  company: string;
  position: string;
  startDate: string;
  endDate: string;
  description: string;
  customFields?: ProfileCustomField[];
}

export interface ProjectInfo {
  id: string;
  name: string;
  role: string;
  startDate: string;
  endDate: string;
  description: string;
  customFields?: ProfileCustomField[];
}

export interface AwardInfo {
  id: string;
  name: string;
  role: string;
  date: string;
  description: string;
  customFields?: ProfileCustomField[];
}

export interface CertificationInfo {
  id: string;
  name: string;
  issuer: string;
  date: string;
  credentialId?: string;
}

export interface ResumeInfo {
  fileName: string;
  fileData: string; // Base64编码
  fileType: string;
  parsedText?: string;
  uploadDate: string;
}

import type { LLMConfig } from '../services/llm/types';

export type SettingsData = Record<string, unknown>;

export interface BackupData {
  resumeProfileLibrary: ResumeProfileLibrary;
  llmConfig: LLMConfig | null;
  settings: SettingsData | null;
  applicationRecords?: ApplicationRecord[] | null;
}

export interface BackupDataV1 {
  userProfile: UserProfile | null;
  llmConfig: LLMConfig | null;
  settings: SettingsData | null;
  applicationRecords?: ApplicationRecord[] | null;
}

export interface BackupDocumentV1 {
  schemaVersion: 1;
  exportedAt: string;
  source: { extensionVersion: string };
  data: BackupDataV1;
  webdavConfig?: WebDAVConfig | null;
}

export interface BackupDocumentV2 {
  schemaVersion: 2;
  exportedAt: string;
  source: { extensionVersion: string };
  data: BackupData;
  webdavConfig?: WebDAVConfig | null;
}

export type BackupDocument = BackupDocumentV2;

export type BackupErrorCode =
  | 'FILE_TOO_LARGE'
  | 'INVALID_JSON'
  | 'INVALID_ROOT'
  | 'MISSING_SCHEMA_VERSION'
  | 'INVALID_SCHEMA_VERSION'
  | 'UNSUPPORTED_FUTURE_VERSION'
  | 'UNSUPPORTED_OLD_VERSION'
  | 'INVALID_EXPORTED_AT'
  | 'INVALID_SOURCE'
  | 'INVALID_DATA'
  | 'INVALID_USER_PROFILE'
  | 'INVALID_RESUME_PROFILE_LIBRARY'
  | 'INVALID_LLM_CONFIG'
  | 'INVALID_SETTINGS'
  | 'INVALID_WEBDAV_CONFIG';

export interface BackupParseError {
  code: BackupErrorCode;
  message: string;
}

export type BackupParseResult =
  | { success: true; document: BackupDocument }
  | { success: false; error: BackupParseError };

export interface BackupSummary {
  schemaVersion: number;
  exportedAt: string;
  extensionVersion: string;
  hasUserProfile: boolean;
  hasResumeFile: boolean;
  hasLLMConfig: boolean;
  hasApiKey: boolean;
  hasWebDAVConfig: boolean;
}

export interface WebDAVConfig {
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'conflict' | 'error';

export interface SyncExecutionResult {
  status: SyncResultStatus;
  action?: Exclude<SyncAction, 'conflict'>;
}

export interface SyncConflictSummary {
  local: BackupSummary;
  remote: BackupSummary;
}

export type SyncConcurrencyMode = 'etag' | 'hash-fallback';

export interface SyncMetadata {
  concurrencyMode?: SyncConcurrencyMode;
  etag?: string;
  lastSyncedHash?: string;
  lastSyncedAt?: string;
  hasTrustedBaseline: boolean;
  status: SyncStatus;
  lastAction?: Exclude<SyncAction, 'conflict'>;
  lastError?: string;
  conflict?: SyncConflictSummary;
  conflictReason?: 'missing-etag-confirmation';
}

export type ApplicationRecordStatus =
  | '待投递'
  | '已投递'
  | '已笔试'
  | '面试中'
  | 'offer'
  | '终止';

export interface ApplicationPageMetadata {
  companyName: string;
  sourceSite: string;
  sourceUrl: string;
  pageTitle?: string;
}

export interface ApplicationRecord {
  id: string;
  companyName: string;
  jobTitle: string;
  sourceSite: string;
  sourceUrl: string;
  status: ApplicationRecordStatus;
  notes: string;
  appliedAt: string;
  location: string;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationRecordDraft = Omit<ApplicationRecord, 'id'>;

export type SyncAction =
  | 'create-remote'
  | 'no-change'
  | 'upload-local'
  | 'download-remote'
  | 'conflict';

export type SyncResultStatus = 'disabled' | 'synced' | 'queued' | 'conflict' | 'error';

export interface LocalSaveResult {
  localSaved: true;
  sync: SyncResultStatus;
}

export type FocusedFieldFailureReason =
  | 'NO_ACTIVE_TAB'
  | 'NO_CONTENT_SCRIPT'
  | 'NO_FOCUSED_FIELD'
  | 'FIELD_DETACHED'
  | 'FIELD_NOT_WRITABLE'
  | 'VALUE_REJECTED'
  | 'RESTRICTED_PAGE';

export interface FocusedFieldWriteResult {
  written: boolean;
  reason?: FocusedFieldFailureReason;
}

export interface VisualRegionControlPayload {
  sessionId?: string;
  tabId?: number;
}

export interface VisualRegionSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface VisualRegionImagePayload {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface VisualRegionControlRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface VisualRegionControlCandidate {
  controlId: string;
  tagName: string;
  label: string;
  name: string;
  placeholder: string;
  options: string[];
  rect: VisualRegionControlRect;
  contextText: string;
}

export interface VisualRegionFillMapping {
  controlId: string;
  fieldMeaning: string;
  matchedProfilePath: string;
  value: string;
}

interface VisualRegionFillPayloadBase {
  requestId?: string;
  domain?: string;
  controls: VisualRegionControlCandidate[];
  imageDataUrl?: string;
  region: VisualRegionSelectionRect;
  instruction?: string;
  pageContext?: string;
  targetLabel?: string;
}

export interface VisualRegionFillPayload extends VisualRegionFillPayloadBase {
  image: VisualRegionImagePayload;
}

export interface VisualRegionFillRequestPayload extends VisualRegionFillPayloadBase {}

export interface VisualRegionFillResult {
  value: string;
  confidence?: number;
  model?: string;
}

export interface VisualRegionFillMappingResult {
  mappings: VisualRegionFillMapping[];
}

// —— “记住一次”字段学习报告（popup「本页字段对照」） ——
// 只包含网页字段元数据与匹配原因，禁止携带用户资料值/答案值。
export interface PageFieldReportItem {
  /** 帧内字段标识，仅用于本次报告关联下拉选择，不持久化。 */
  id: string;
  /** 页面可见字段标题（用于学习别名）。 */
  label: string;
  /** 建议写入 fieldAliasOverrides 的别名文本；空字符串表示该字段无法学习。 */
  suggestedAlias: string;
  /** 字段所属模块的中文名（基本信息 / 教育经历 / …）。 */
  section: string;
  /** 模块上下文原文（诊断展示用，截断）。 */
  module: string;
  /** 控件类型（text / select / textarea / combobox …）。 */
  type: string;
  /** 页面上的选项文字（仅 select / 已知枚举，不含资料值）。 */
  options: string[];
  /** 未识别原因。 */
  reason: string;
  /** 是否空白（空白才可以被自动写入）。 */
  blank: boolean;
  /** 是否可学习：有可用的字段标题且不属于禁止字段。 */
  learnable: boolean;
}

export interface PageMatchedField {
  /** 页面可见字段标题。 */
  label: string;
  /** 命中的资料字段名称。 */
  targetLabel: string;
}

export interface PageBlockedField {
  /** 页面可见字段标题。 */
  label: string;
  /** 禁止原因（如“验证码”）。 */
  reason: string;
}

/** 单个 frame 的字段对照报告（content → background）。 */
export interface PageFrameFieldReport {
  detected: number;
  matched: number;
  unmatched: PageFieldReportItem[];
  matchedFields: PageMatchedField[];
  blocked: PageBlockedField[];
  /** 禁止字段总数（blocked 列表可能被截断，计数保持精确）。 */
  blockedCount: number;
}

/** 汇总所有 frame 后的本页字段对照报告（background → popup）。 */
export interface PageFieldReport {
  detected: number;
  matched: number;
  unmatched: PageFieldReportItem[];
  matchedFields: PageMatchedField[];
  blocked: PageBlockedField[];
  blockedCount: number;
  /** 各 frame 明细（frameId 由 background 填充）。 */
  frames: Array<PageFrameFieldReport & { frameId: number }>;
}

/** SAVE_FIELD_ALIAS 成功结果。 */
export interface SaveFieldAliasResult {
  saved: boolean;
  profileKey: string;
  alias: string;
  /** 该别名此前已经记住过（本次未新增）。 */
  alreadyExists: boolean;
  /** 该资料字段保存后的别名总数。 */
  keyAliasCount: number;
  /** 当前简历保存后的别名总数。 */
  totalAliasCount: number;
}

// 消息类型定义
export type Message =
  | { type: 'GET_USER_PROFILE'; payload?: null }
  | { type: 'GET_ACTIVE_RESUME_CONTEXT'; payload?: null }
  | { type: 'SAVE_USER_PROFILE'; payload: UserProfile | { profile: UserProfile; expectedProfileId: string } }
  | { type: 'GET_RESUME_PROFILES'; payload?: null }
  | { type: 'SWITCH_RESUME_PROFILE'; payload: { id: string } }
  | { type: 'CREATE_RESUME_PROFILE'; payload: { name?: string } }
  | { type: 'DUPLICATE_RESUME_PROFILE'; payload: { id: string } }
  | { type: 'RENAME_RESUME_PROFILE'; payload: { id: string; name: string } }
  | { type: 'DELETE_RESUME_PROFILE'; payload: { id: string } }
  | { type: 'PARSE_RESUME'; payload: { file: string; fileType: string; fileName: string; rawText?: string } }
  | { type: 'FILL_FORM'; payload?: null }
  | { type: 'GET_PAGE_FIELD_REPORT'; payload?: { tabId?: number } | null }
  | { type: 'SAVE_FIELD_ALIAS'; payload: { profileKey: string; alias: string } }
  | { type: 'GET_APPLICATION_PAGE_METADATA'; payload?: null }
  | { type: 'CREATE_APPLICATION_RECORD_DRAFT'; payload: { tabId: number } }
  | { type: 'GET_APPLICATION_RECORD_DRAFT'; payload: { draftId: string } }
  | { type: 'GET_APPLICATION_RECORDS'; payload?: null }
  | { type: 'CREATE_APPLICATION_RECORD'; payload: ApplicationRecord }
  | { type: 'UPDATE_APPLICATION_RECORD'; payload: ApplicationRecord }
  | { type: 'DELETE_APPLICATION_RECORD'; payload: { id: string } }
  | { type: 'EXPORT_APPLICATION_RECORDS_CSV'; payload?: null }
  | { type: 'IMPORT_APPLICATION_RECORDS_CSV'; payload: { csv: string } }
  | { type: 'START_AI_PAGE_FILL'; payload?: null }
  | { type: 'DETECT_FIELDS'; payload?: null }
  | { type: 'START_AI_REGION_FILL'; payload?: VisualRegionControlPayload | null }
  | { type: 'AI_FILL_VISUAL_REGION'; payload: VisualRegionFillPayload | VisualRegionFillRequestPayload }
  | { type: 'CROP_IMAGE_OFFSCREEN'; payload: { imageDataUrl: string; selectionRect: VisualRegionSelectionRect } }
  | { type: 'WRITE_FOCUSED_FIELD'; payload: { tabId: number; value: string } }
  | { type: 'APPLY_FOCUSED_FIELD'; payload: VisualRegionFillResult }
  | { type: 'GET_RESUME_DATA'; payload?: null }
  | { type: 'GENERATE_ANSWER'; payload: { questionText: string; context?: string; fieldMaxLength?: number; language?: 'zh' | 'en' } }
  | { type: 'MATCH_FIELDS_LLM'; payload: { fields: Array<{ index: number; name: string; id: string; placeholder: string; labelText: string; type: string }>; domain: string } }
  | {
      type: 'AI_FILL_SECTION';
      payload: {
        requestId: string;
        section: string;
        fields: Array<{
          index: number;
          rowIndex: number;
          name: string;
          label: string;
          type: string;
          options: string[];
          context: string;
        }>;
        domain: string;
      };
    }
  | { type: 'CANCEL_AI_FILL'; payload: { requestId: string } }
  | { type: 'GET_LLM_CONFIG'; payload?: null }
  | { type: 'SAVE_LLM_CONFIG'; payload: LLMConfig }
  | { type: 'TEST_LLM_CONNECTION'; payload?: LLMConfig | null }
  | { type: 'EXPORT_BACKUP'; payload?: null }
  | { type: 'PREVIEW_BACKUP_IMPORT'; payload: { json: string } }
  | { type: 'IMPORT_BACKUP'; payload: { json: string } }
  | { type: 'GET_WEBDAV_CONFIG'; payload?: null }
  | { type: 'SAVE_WEBDAV_CONFIG'; payload: WebDAVConfig }
  | { type: 'TEST_WEBDAV'; payload: WebDAVConfig }
  | { type: 'GET_SYNC_STATUS'; payload?: null }
  | { type: 'SYNC_NOW'; payload?: null }
  | { type: 'FORCE_UPLOAD_LOCAL'; payload?: null }
  | { type: 'FORCE_DOWNLOAD_REMOTE'; payload?: null }
  | { type: 'RESOLVE_SYNC_CONFLICT'; payload: { choice: 'local' | 'remote' } };

export interface MessageResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// 表单字段检测结果
export interface DetectedField {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  fieldType: string;
  confidence: number;
  value?: string;
  // 自定义资料匹配成功后直接携带待填值，避免把用户自定义字段写死进 FieldType。
  profileValue?: string;
  // 命中永久禁止字段：进入结果统计但绝不写入。
  blocked?: boolean;
  // 多候选冲突无法唯一确定：计入 skippedAmbiguous 并跳过。
  ambiguous?: boolean;
  // 匹配/跳过的原因（诊断报告用）。
  matchReason?: string;
}

// 字段类型枚举
export enum FieldType {
  NAME = 'name',
  GENDER = 'gender',
  BIRTH_DATE = 'birthDate',
  PHONE = 'phone',
  EMAIL = 'email',
  WECHAT = 'wechat',
  ID_CARD = 'idCard',
  SCHOOL = 'school',
  COLLEGE = 'college',
  EDUCATION_TYPE = 'educationType',
  MAJOR = 'major',
  DEGREE = 'degree',
  GPA = 'gpa',
  SELF_EVALUATION = 'selfEvaluation',
  EDUCATION_START_DATE = 'educationStartDate',
  GRADUATION_DATE = 'graduationDate',
  COMPANY = 'company',
  POSITION = 'position',
  START_DATE = 'startDate',
  END_DATE = 'endDate',
  DESCRIPTION = 'description',
  PROJECT_NAME = 'projectName',
  PROJECT_ROLE = 'projectRole',
  PROJECT_START_DATE = 'projectStartDate',
  PROJECT_END_DATE = 'projectEndDate',
  PROJECT_DESCRIPTION = 'projectDescription',
  AWARD_NAME = 'awardName',
  AWARD_ROLE = 'awardRole',
  AWARD_DATE = 'awardDate',
  AWARD_DESCRIPTION = 'awardDescription',
  SKILLS = 'skills',
  RESUME_FILE = 'resumeFile',
  UNKNOWN = 'unknown'
}

// 简历解析结果
export interface ParsedResumeData {
  personal?: Partial<PersonalInfo>;
  education?: Partial<EducationInfo>[];
  experience?: Partial<ExperienceInfo>[];
  projects?: Partial<ProjectInfo>[];
  awards?: Partial<AwardInfo>[];
  skills?: string[];
  rawText: string;
}

export interface ResumeProfile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  profile: UserProfile;
}

export interface ResumeProfileSummary {
  activeProfileId: string;
  profiles: Array<Pick<ResumeProfile, 'id' | 'name' | 'createdAt' | 'updatedAt'>>;
}

export interface ResumeProfileMutationResult extends ResumeProfileSummary {
  sync: SyncResultStatus;
  syncError?: string;
}

export interface ActiveResumeContext extends ResumeProfileSummary {
  profile: UserProfile;
  revision: string;
}

export interface ResumeProfileLibrary {
  schemaVersion: 1;
  activeProfileId: string;
  profiles: ResumeProfile[];
}
