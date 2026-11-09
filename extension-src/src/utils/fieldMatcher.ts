import { FieldType } from '../shared/types';
import { matchBlockedField, type BlockedFieldEvidence } from '../shared/blockedFields.ts';
import {
  containsAny,
  matchesIdentifier,
  normalizeFieldText,
} from './fieldText.ts';
import {
  PROFILE_FIELD_REGISTRY,
  type ModuleScope,
  type ProfileFieldDefinition,
} from '../shared/profileFieldRegistry.ts';
import type { ProfileAnswerCandidate } from '../shared/profileAnswerCandidates.ts';
import type { FieldAliasOverrides } from '../shared/types.ts';

// 结构化证据（方案 §5.1）：网页信息分来源保存，禁止拼接后裸 includes。
export interface FieldEvidence {
  visibleLabel: string;
  placeholder: string;
  name: string;
  id: string;
  autocomplete: string;
  moduleContext: string;
  rowContext: string;
  inputType: string;
  controlKind:
    | 'input' | 'textarea' | 'select' | 'custom-select'
    | 'radio' | 'checkbox' | 'date' | 'cascader' | 'file' | 'other';
}

export type MatchConfidence =
  | 'exact-user-alias'
  | 'exact-system-alias'
  | 'exact-identifier'
  | 'contextual';

export interface FieldMatchResult {
  status: 'matched' | 'blocked' | 'ambiguous' | 'unmatched';
  profileKey?: string;
  /** 命中注册表核心字段时给出 FieldType，走记录索引取值管线。 */
  coreFieldType?: FieldType;
  /** 命中候选（预设/自定义字段）时给出候选 id，profileValue 直接携带。 */
  candidateId?: string;
  confidence: MatchConfidence;
  reason: string;
  /** 同级多候选时的冲突列表。 */
  candidates?: string[];
}

export interface MatchFieldOptions {
  candidates?: ProfileAnswerCandidate[];
  aliasOverrides?: FieldAliasOverrides;
}

type ExactTier = 'exact' | 'contained';

interface ExactHit {
  tier: ExactTier;
  key: string;
  candidateId?: string;
  coreFieldType?: FieldType;
  matchedName: string;
}

const MODULE_PATTERNS: Record<Exclude<ModuleScope, 'any'>, RegExp> = {
  education: /教育|学校|院校|大学|学院|就读|入学|毕业|学历类型|education|school|university|college|academic|enroll|enrol|admission/i,
  work: /工作|实习|公司|单位|入职|离职|岗位|职位|work|job|company|employer|intern|employment|职业/i,
  project: /项目|课题|project|research/i,
  award: /奖项|获奖|荣誉|award|honou?r/i,
};

/**
 * 模块候选（module.* 键）只有在对应模块语境下才允许命中通用短标签（§21.15 不跨模块抢字段）。
 * 例：module.family.name 的"姓名"不得抢基本信息页的本人姓名；module.campus.period 的"开始时间"
 * 不得抢教育经历的入学时间。
 */
const MODULE_SCOPE_KEYWORDS: Record<string, string[]> = {
  family: ['家庭', '家属', '亲属', '社会关系', '父母', '父亲', '母亲', '配偶', '子女'],
  languages: ['语言', '语种', '外语', '英语', '日语', '韩语', '法语', '德语', '俄语', '等级考试'],
  skills: ['技能', '专长', '技术栈', '工具', '软件'],
  papers: ['论文', '期刊', '发表', '学术成果', '文献'],
  research: ['科研', '课题', '研究'],
  patents: ['专利', '软著', '软件著作权', '著作权'],
  jobIntent: ['求职意向', '意向', '期望', '志愿', '到岗', '薪酬', '薪资', '工作性质', '工作类型', '工作城市', '调剂', '出差', '轮班', '海外', '外派'],
  campus: ['校园', '社团', '学生工作', '学生会', '任职', '干部', '班级', '组织', '在校'],
  certificates: ['证书', '资格'],
  books: ['著作', '教材', '专著', '编著'],
  conferences: ['会议', '学术活动'],
};

const RECORD_SCOPE_FLAG: Record<string, Exclude<ModuleScope, 'any' | 'any'>> = {
  education: 'education',
  experience: 'work',
  project: 'project',
  award: 'award',
};

/** 候选归属：个人资料 / 某类经历记录 / 预设模块 / 用户自建（自定义字段）。 */
type CandidateScope =
  | { kind: 'personal' }
  | { kind: 'record'; module: 'education' | 'work' | 'project' | 'award' }
  | { kind: 'module'; name: string }
  | { kind: 'custom' };

function candidateScope(candidate: ProfileAnswerCandidate): CandidateScope {
  const key = candidate.key;
  const moduleMatch = /^module\.([A-Za-z0-9_-]+)\./.exec(key);
  if (moduleMatch) return { kind: 'module', name: moduleMatch[1] };
  const head = key.split('.')[0];
  if (head === 'personal') return { kind: 'personal' };
  if (head === 'education' || head === 'experience' || head === 'project' || head === 'award') {
    return { kind: 'record', module: RECORD_SCOPE_FLAG[head] };
  }
  return { kind: 'custom' };
}

function evidenceHasModuleSignal(evidence: FieldEvidence, flags: Record<string, boolean>): boolean {
  return Boolean(evidence.moduleContext.trim()) || Object.values(flags).some(Boolean);
}

/**
 * 作用域限定：明确处于其它模块语境时，记录候选只允许"标题本身足够具体"的跨模块兜底；
 * 模块候选必须命中本模块关键词。无任何模块信号时维持旧版简单页面兜底。
 */
function scopeAllowsCandidate(
  candidate: ProfileAnswerCandidate,
  evidence: FieldEvidence,
  flags: Record<string, boolean>,
  matchedName: string,
): boolean {
  const scope = candidateScope(candidate);
  if (scope.kind === 'personal' || scope.kind === 'custom') return true;
  const hasSignal = evidenceHasModuleSignal(evidence, flags);
  const specific = normalizeFieldText(matchedName).length >= 5;
  if (scope.kind === 'record') {
    if (flags[scope.module]) return true;
    return !hasSignal || specific;
  }
  const keywords = MODULE_SCOPE_KEYWORDS[scope.name];
  if (!keywords || keywords.length === 0) return true;
  const text = `${evidence.moduleContext} ${evidence.visibleLabel} ${evidence.rowContext} ${evidence.placeholder}`;
  if (keywords.some(keyword => containsAny(text, [keyword]))) return true;
  return !hasSignal && specific;
}

/** 冲突裁决：证据落在唯一一个记录模块时，优先选择该模块的记录/模块候选。 */
function preferredScopedHit(hits: ExactHit[], flags: Record<string, boolean>): ExactHit | null {
  const activeScopes = (Object.keys(RECORD_SCOPE_FLAG) as Array<'education' | 'experience' | 'project' | 'award'>)
    .map(key => RECORD_SCOPE_FLAG[key])
    .filter(flag => flags[flag]);
  const uniqueActive = Array.from(new Set(activeScopes));
  if (uniqueActive.length !== 1) return null;
  const active = uniqueActive[0];
  const scoped = hits.filter(hit => {
    const scope = candidateScopeOfKey(hit.key);
    return scope.kind === 'record' && scope.module === active;
  });
  const distinct = new Set(scoped.map(hit => hit.key));
  return distinct.size === 1 ? scoped[0] : null;
}

function candidateScopeOfKey(key: string): CandidateScope {
  const moduleMatch = /^module\.([A-Za-z0-9_-]+)\./.exec(key);
  if (moduleMatch) return { kind: 'module', name: moduleMatch[1] };
  const head = key.split('.')[0];
  if (head === 'personal') return { kind: 'personal' };
  if (head === 'education' || head === 'experience' || head === 'project' || head === 'award') {
    return { kind: 'record', module: RECORD_SCOPE_FLAG[head] };
  }
  return { kind: 'custom' };
}

/** 英文可见标题完整相等时的兜底映射（§7.1：单独的 name 只能完整等于 name）。 */
const ENGLISH_LABEL_SHORTCUTS: Record<string, string[]> = {
  'personal.name': ['name'],
  'personal.phone': ['phone', 'mobile', 'telephone', 'mobile number', 'phone number'],
  'personal.email': ['email', 'mail', 'e-mail'],
  'personal.birthDate': ['birthday', 'date of birth', 'birth date'],
  'personal.gender': ['gender', 'sex'],
  'personal.wechat': ['wechat', 'wechat id'],
  'personal.idCard': ['id number', 'identity number'],
  'personal.nationality': ['nationality', 'country of citizenship', 'citizenship'],
  'personal.ethnicity': ['ethnicity', 'ethnic group'],
};

function contextFlags(evidence: FieldEvidence): Record<Exclude<ModuleScope, 'any'>, boolean> {
  const searchText = [
    evidence.moduleContext,
    evidence.visibleLabel,
    evidence.rowContext,
    evidence.name,
    evidence.id,
    evidence.placeholder,
    evidence.autocomplete,
  ].join(' ');
  return {
    education: MODULE_PATTERNS.education.test(searchText),
    work: MODULE_PATTERNS.work.test(searchText),
    project: MODULE_PATTERNS.project.test(searchText),
    award: MODULE_PATTERNS.award.test(searchText),
  };
}

/** 关键词组：以 | 分隔的任意关键词命中即可。 */
function keywordGroupHits(text: string, group: string): boolean {
  return group.split('|').some(keyword => {
    const normalized = keyword.trim();
    if (normalized.includes('|')) return false;
    return containsAny(text, [normalized]);
  });
}

function moduleAllowed(
  required: ModuleScope[] | undefined,
  flags: Record<string, boolean>,
  hasModuleSignal: boolean,
): boolean {
  if (!required || required.length === 0) return true;
  if (required.some(module => flags[module])) return true;
  // 页面完全无可识别模块时，具体标题本身就是语义（简单页面兜底，保住旧版覆盖）；
  // 一旦页面存在任何模块信号，就严格按模块限定，防止跨模块抢字段。
  return !hasModuleSignal;
}

function contextExcluded(text: string, exclude: string[] | undefined): boolean {
  if (!exclude || exclude.length === 0) return false;
  return exclude.some(keyword => {
    // 排除语境同样支持 a|b 分组。
    return keyword.split('|').some(part => {
      const normalized = part.trim();
      return normalized.length > 0 && containsAny(text, [normalized]);
    });
  });
}

function blockedEvidence(evidence: FieldEvidence): BlockedFieldEvidence {
  return {
    name: evidence.name,
    id: evidence.id,
    placeholder: evidence.placeholder,
    labelText: `${evidence.visibleLabel} ${evidence.rowContext}`,
    autocomplete: evidence.autocomplete,
  };
}

// —— 第 3/4 层：完整别名精确匹配 ——

function matchExactLayer(
  evidence: FieldEvidence,
  candidates: ProfileAnswerCandidate[],
  filter: (candidate: ProfileAnswerCandidate) => boolean,
  flags: Record<string, boolean>,
): { hit?: ExactHit; conflict?: ExactHit[] } {
  const normLabel = normalizeFieldText(evidence.visibleLabel);
  const normPlaceholder = normalizeFieldText(evidence.placeholder);
  const normIdentifiers = normalizeFieldText(`${evidence.name} ${evidence.id}`);
  const normLabelWithPlaceholder = normalizeFieldText(`${evidence.visibleLabel} ${evidence.placeholder}`);

  const hits: ExactHit[] = [];
  for (const candidate of candidates) {
    if (!filter(candidate)) continue;
    const names = [candidate.label, ...candidate.aliases];
    let best: ExactHit | null = null;

    const consider = (tier: ExactTier, name: string) => {
      // 作用域限定：模块/记录候选不得跨模块抢通用标签（§21.15）。
      if (!scopeAllowsCandidate(candidate, evidence, flags, name)) return;
      if (!best || (best.tier === 'contained' && tier === 'exact')) {
        best = {
          tier,
          key: candidate.key,
          candidateId: candidate.id,
          coreFieldType: candidate.coreFieldType as FieldType | undefined,
          matchedName: name,
        };
      }
    };

    for (const name of names) {
      const normalized = normalizeFieldText(name);
      if (!normalized) continue;

      if ((normLabel && normLabel === normalized) || (normPlaceholder && normPlaceholder === normalized)) {
        consider('exact', name);
        continue;
      }

      // 包含匹配有长度下限（≥4），中文短别名不得随意包含（§6 第 3 层）。
      if (normalized.length >= 4) {
        if (normLabelWithPlaceholder.includes(normalized)) {
          consider('contained', name);
          continue;
        }
        // 反向包含：别名比标题长且包含标题（标题至少 3 字，避免"专业/学位/学校"
        // 这类两字通用标签被"专业方向/最高学位"等长别名沾走）。
        if (normLabel && normLabel.length >= 3 && normalized.includes(normLabel)) {
          consider('contained', name);
          continue;
        }
        // 内部标识符包含（如 data-form-field-name 直接写中文标题）。
        if (normIdentifiers && normIdentifiers.includes(normalized)) {
          consider('contained', name);
        }
      }
    }

    if (best) hits.push(best);
  }

  if (hits.length === 0) return {};
  const topTier: ExactTier = hits.some(hit => hit.tier === 'exact') ? 'exact' : 'contained';
  const top = hits.filter(hit => hit.tier === topTier);
  const distinctKeys = new Set(top.map(hit => hit.key));
  if (distinctKeys.size === 1) return { hit: top[0] };
  return { conflict: top };
}

/**
 * 同值冲突裁决：别名同时命中多个候选、但所有候选值规范化后完全一致时，
 * 填哪个都是同一个答案 → 确定性命中（不再按 ambiguous 跳过）。
 * 任一候选无值或值不同 → 维持 ambiguous（方案 §6 第 3/4 层的防乱填底线不动）。
 */
function allConflictsShareSameValue(
  hits: ExactHit[],
  candidates: ProfileAnswerCandidate[],
): boolean {
  if (hits.length < 2) return false;
  const values = hits.map(hit => {
    const candidate = candidates.find(item => item.id === hit.candidateId);
    return candidate ? normalizeFieldText(candidate.value) : '';
  });
  if (values.some(value => !value)) return false;
  return values.every(value => value === values[0]);
}

// —— 第 5 层：字段专属上下文小 if（按注册表定义执行，具体字段在前） ——

function matchContextualRule(
  definition: ProfileFieldDefinition,
  evidence: FieldEvidence,
  flags: Record<string, boolean>,
): boolean {
  const rule = definition.contextual;
  if (!rule) return false;
  const hasModuleSignal = Boolean(evidence.moduleContext.trim())
    || Object.values(flags).some(value => value);
  const allowFallback = rule.fallbackWithoutModule === true;
  // 未开启兜底的规则：永远视为"存在模块信号"，禁止仅凭泛化标题命中。
  if (!moduleAllowed(rule.modules, flags, allowFallback ? hasModuleSignal : true)) return false;

  // placeholder 是合法证据（§5.1 第 5 级）：无 label 站点只有"请输入民族"这类占位文字。
  const fieldText = `${evidence.visibleLabel} ${evidence.rowContext} ${evidence.placeholder}`;
  if (!keywordGroupHits(fieldText, rule.anyOf.join('|'))) return false;
  if (rule.required && !keywordGroupHits(fieldText, rule.required.join('|'))) return false;
  if (contextExcluded(fieldText, rule.exclude)) return false;
  return true;
}

/** 上下文规则命中顺序：具体字段先于普通字段（§21.16）。未列入的规则自动追加，避免漏规则。 */
const CONTEXTUAL_ORDER = [
  'personal.emergencyPhone',
  'personal.emergencyName',
  'personal.emergencyRelationship',
  'personal.nationality',
  'personal.ethnicity',
  'personal.politicalStatus',
  'personal.hometown',
  'personal.currentAddress',
  'personal.birthDate',
  'education.educationType',
  'education.school',
  'education.college',
  'education.major',
  'education.degree',
  'education.gpa',
  'education.ranking',
  'education.startDate',
  'education.endDate',
  'experience.company',
  'experience.position',
  'experience.startDate',
  'experience.endDate',
  'experience.description',
  'project.name',
  'project.role',
  'project.startDate',
  'project.endDate',
  'project.description',
  'award.name',
  'award.role',
  'award.date',
  'award.description',
  'module.jobIntent.relocation',
  'personal.phone',
  'personal.email',
  'personal.wechat',
  'personal.idCard',
  'personal.name',
  'personal.gender',
  'personal.selfEvaluation',
];

const CONTEXTUAL_ORDER_COMPLETE = [
  ...CONTEXTUAL_ORDER,
  ...PROFILE_FIELD_REGISTRY
    .filter(definition => definition.contextual && !CONTEXTUAL_ORDER.includes(definition.key))
    .map(definition => definition.key),
];

function matchContextualLayer(
  evidence: FieldEvidence,
  flags: Record<string, boolean>,
): FieldMatchResult | null {
  const byKey = new Map(PROFILE_FIELD_REGISTRY.map(def => [def.key, def]));

  // 英文可见标题完整相等的兜底（§7.1：单独的 name 只能完整等于 name）。
  const normLabel = normalizeFieldText(evidence.visibleLabel);
  if (normLabel) {
    for (const [key, labels] of Object.entries(ENGLISH_LABEL_SHORTCUTS)) {
      if (!labels.some(label => normalizeFieldText(label) === normLabel)) continue;
      const definition = byKey.get(key);
      if (definition) {
        return {
          status: 'matched',
          profileKey: definition.key,
          coreFieldType: definition.fieldType,
          confidence: 'contextual',
          reason: `英文标题完整命中：${definition.label}`,
        };
      }
    }
  }

  for (const key of CONTEXTUAL_ORDER_COMPLETE) {
    const definition = byKey.get(key);
    if (!definition?.contextual) continue;
    if (!matchContextualRule(definition, evidence, flags)) continue;

    return {
      status: 'matched',
      profileKey: definition.key,
      coreFieldType: definition.fieldType,
      confidence: 'contextual',
      reason: `上下文规则命中：${definition.label}`,
    };
  }
  return null;
}

// —— 第 6 层：安全内部复合标识符 ——

function matchIdentifierLayer(evidence: FieldEvidence): FieldMatchResult | null {
  const identifierText = `${evidence.name} ${evidence.id} ${evidence.autocomplete}`;
  if (!identifierText.trim()) return null;

  const hits: Array<{ key: string; definition: ProfileFieldDefinition; matched: string }> = [];
  for (const definition of PROFILE_FIELD_REGISTRY) {
    const matched = matchesIdentifier(identifierText, definition.compounds || []);
    if (matched) {
      hits.push({ key: definition.key, definition, matched });
      continue;
    }
    const single = matchesIdentifier(
      identifierText,
      definition.singleSegmentCompounds || [],
      { singleTokens: true },
    );
    if (single) {
      hits.push({ key: definition.key, definition, matched: single });
    }
  }

  if (hits.length === 0) return null;
  const distinctKeys = new Set(hits.map(hit => hit.key));
  if (distinctKeys.size > 1) {
    return {
      status: 'ambiguous',
      confidence: 'exact-identifier',
      reason: `多个复合标识符同时命中：${hits.map(hit => hit.matched).join(', ')}`,
      candidates: Array.from(distinctKeys),
    };
  }
  const hit = hits[0];
  return {
    status: 'matched',
    profileKey: hit.definition.key,
    coreFieldType: hit.definition.fieldType,
    confidence: 'exact-identifier',
    reason: `复合标识符命中：${hit.matched}`,
  };
}

// —— 主入口（方案 §18） ——

export function matchField(
  evidence: FieldEvidence,
  options: MatchFieldOptions = {},
): FieldMatchResult {
  // 第 1 层：永久禁止字段，先于一切别名与规则（§21.2）。
  const blocked = matchBlockedField(blockedEvidence(evidence));
  if (blocked) {
    return {
      status: 'blocked',
      confidence: 'exact-system-alias',
      reason: `禁止自动填写：${blocked.label}`,
    };
  }

  const candidates = options.candidates || [];
  const flags = contextFlags(evidence);

  // 第 3 层：用户配置的完整别名（预设/自定义字段的别名视为用户配置）。
  const userLayer = matchExactLayer(
    evidence,
    candidates,
    candidate => !candidate.coreFieldType,
    flags,
  );

  // 第 4 层：系统标准名称与完整别名（注册表核心字段 + 全部候选）。
  const systemLayer = matchExactLayer(evidence, candidates, () => true, flags);

  // 精确相等（exact）先裁决；"包含"匹配（contained）弱于上下文规则与复合标识符，
  // 放到最后兜底：否则"专业方向/最高学位"这类长别名会把"专业/学位"等短标题抢成冲突。
  const userExact = selectTier(userLayer, 'exact');
  if (userExact.hit) {
    return matchedFromHit(userExact.hit, 'exact-user-alias', `用户别名完整命中：${userExact.hit.matchedName}`);
  }
  if (userExact.conflict) {
    const resolved = resolveExactConflict(userExact.conflict, evidence, flags, candidates, 'exact-user-alias');
    if (resolved) return resolved;
    return ambiguousFromHits(userExact.conflict, 'exact-user-alias', '同一别名命中多个自定义字段');
  }

  const systemExact = selectTier(systemLayer, 'exact');
  if (systemExact.hit) {
    return matchedFromHit(systemExact.hit, 'exact-system-alias', `标准名称/别名完整命中：${systemExact.hit.matchedName}`);
  }
  if (systemExact.conflict) {
    const resolved = resolveExactConflict(systemExact.conflict, evidence, flags, candidates, 'exact-system-alias');
    if (resolved) return resolved;
    return ambiguousFromHits(systemExact.conflict, 'exact-system-alias', '同一名称命中多个资料字段');
  }

  // 第 5 层：字段专属上下文小 if。
  const contextual = matchContextualLayer(evidence, flags);
  if (contextual) return contextual;

  // 第 6 层：安全复合标识符。
  const identifier = matchIdentifierLayer(evidence);
  if (identifier) return identifier;

  // 第 6.5 层：包含匹配兜底（用户别名 > 系统别名）。含作用域限定，不会跨模块抢字段。
  const userContained = selectTier(userLayer, 'contained');
  if (userContained.hit) {
    return matchedFromHit(userContained.hit, 'exact-user-alias', `用户别名包含命中：${userContained.hit.matchedName}`);
  }
  if (userContained.conflict) {
    const resolved = resolveExactConflict(userContained.conflict, evidence, flags, candidates, 'exact-user-alias');
    if (resolved) return resolved;
    return ambiguousFromHits(userContained.conflict, 'exact-user-alias', '同一别名命中多个自定义字段');
  }

  const systemContained = selectTier(systemLayer, 'contained');
  if (systemContained.hit) {
    return matchedFromHit(systemContained.hit, 'exact-system-alias', `标准名称/别名包含命中：${systemContained.hit.matchedName}`);
  }
  if (systemContained.conflict) {
    const resolved = resolveExactConflict(systemContained.conflict, evidence, flags, candidates, 'exact-system-alias');
    if (resolved) return resolved;
    return ambiguousFromHits(systemContained.conflict, 'exact-system-alias', '同一名称命中多个资料字段');
  }

  // 第 7 层：不确定就跳过。相似度只能作为诊断信息，不触发填写。
  return {
    status: 'unmatched',
    confidence: 'contextual',
    reason: '没有唯一可靠规则',
  };
}

function selectTier(
  layer: { hit?: ExactHit; conflict?: ExactHit[] },
  tier: ExactTier,
): { hit?: ExactHit; conflict?: ExactHit[] } {
  if (layer.hit) return layer.hit.tier === tier ? { hit: layer.hit } : {};
  if (layer.conflict && layer.conflict[0]?.tier === tier) return { conflict: layer.conflict };
  return {};
}

function matchedFromHit(hit: ExactHit, confidence: MatchConfidence, reason: string): FieldMatchResult {
  return {
    status: 'matched',
    profileKey: hit.key,
    candidateId: hit.candidateId,
    coreFieldType: hit.coreFieldType,
    confidence,
    reason,
  };
}

function ambiguousFromHits(hits: ExactHit[], confidence: MatchConfidence, reason: string): FieldMatchResult {
  return {
    status: 'ambiguous',
    confidence,
    reason,
    candidates: hits.map(hit => hit.key),
  };
}

/** 精确层冲突裁决：同值 → 模块作用域唯一匹配 → 否则 ambiguous（防乱填底线不动）。 */
function resolveExactConflict(
  hits: ExactHit[],
  evidence: FieldEvidence,
  flags: Record<string, boolean>,
  candidates: ProfileAnswerCandidate[],
  confidence: MatchConfidence,
): FieldMatchResult | null {
  if (allConflictsShareSameValue(hits, candidates)) {
    const hit = hits[0];
    return matchedFromHit(hit, confidence, `多字段同别名但值一致，取其一：${hit.matchedName}`);
  }
  const scoped = preferredScopedHit(hits, flags);
  if (scoped) {
    return matchedFromHit(scoped, confidence, `模块上下文裁决：${scoped.matchedName}`);
  }
  // 任何经历记录模块信号存在但无法唯一裁决 → 保持 ambiguous，不猜记录。
  if (Object.values(flags).some(Boolean)) return null;
  // 基本信息页（明确无经历记录模块信号）且标题/模块为"基本信息"：优先个人资料字段。
  const personalHits = hits.filter(hit => candidateScopeOfKey(hit.key).kind === 'personal');
  const distinctPersonal = new Set(personalHits.map(hit => hit.key));
  if (distinctPersonal.size === 1 && evidence.moduleContext.includes('基本')) {
    return matchedFromHit(personalHits[0], confidence, `基本信息上下文裁决：${personalHits[0].matchedName}`);
  }
  return null;
}

// —— 证据构建 ——

/** 候选字段标题必须是干净的短文本：排除校验错误（"必填项未填写"）与占位提示。 */
function isUsableLabelCandidate(candidate: string): boolean {
  if (!candidate || candidate.length > 30) return false;
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(candidate)) return false;
  if (/必填|不能为空|请输入|请选择|请完善|请填写|该项为必填/.test(candidate)) return false;
  if (/AI\s*生成/.test(candidate)) return false;
  return true;
}

/** 排除插件自己注入的控件（如开放问题旁的"AI 生成"按钮），它们不是字段标题。 */
function isInjectedHelperElement(element: Element): boolean {
  const className = element.getAttribute?.('class') || '';
  return /ai-gen-btn/.test(className);
}

function detectControlKind(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  inputType: string,
): FieldEvidence['controlKind'] {  if (element.tagName === 'SELECT') return 'select';
  if (element.tagName === 'TEXTAREA') return 'textarea';
  if (inputType === 'radio') return 'radio';
  if (inputType === 'checkbox') return 'checkbox';
  if (inputType === 'file') return 'file';
  if (inputType === 'date' || inputType === 'month') return 'date';
  if (element.getAttribute('role') === 'combobox') return 'custom-select';
  if (element instanceof HTMLInputElement && element.readOnly) return 'custom-select';
  return 'input';
}

export class FieldMatcher {
  // 从元素中提取所有可能的标识符（含模块上下文）。
  static extractIdentifiers(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  ): {
    name: string;
    id: string;
    placeholder: string;
    labelText: string;
    type: string;
    autocomplete: string;
    moduleContext: string;
    rowContext: string;
  } {
    const fieldContainer = element.closest<HTMLElement>(
      '[data-form-field-id], [data-form-field-name], [data-form-field-i18n-name]'
    );
    const elementDataId = element.getAttribute('data-form-field-id') || '';
    const elementDataName = element.getAttribute('data-form-field-name') || '';
    const elementDataI18nName = element.getAttribute('data-form-field-i18n-name') || '';
    const containerDataId = fieldContainer?.getAttribute('data-form-field-id') || '';
    const containerDataName = fieldContainer?.getAttribute('data-form-field-name') || '';
    const containerDataI18nName = fieldContainer?.getAttribute('data-form-field-i18n-name') || '';

    const name = [
      element.getAttribute('name') || '',
      elementDataName,
      elementDataId,
      containerDataName,
      containerDataId,
    ].filter(Boolean).join(' ');
    const id = [
      element.id || '',
      elementDataId,
      containerDataId,
    ].filter(Boolean).join(' ');
    const placeholder = element.getAttribute('placeholder') || '';
    const type = element.getAttribute('type') || '';
    const autocomplete = element.getAttribute('autocomplete') || '';

    // 查找关联的 label
    let labelText = '';
    if (id) {
      const label = element.id
        ? element.ownerDocument.querySelector(`label[for="${CSS.escape(element.id)}"]`)
        : null;
      if (label) {
        labelText = label.textContent || '';
      }
    }

    if (!labelText && fieldContainer) {
      const label = fieldContainer.querySelector(
        '.ud-formily-item-label label, .ud-formily-item-label, label'
      );
      if (label) {
        labelText = label.textContent || '';
      }
    }

    // 如果没有找到 label[for]，尝试找父级 label
    if (!labelText) {
      const parentLabel = element.closest('label');
      if (parentLabel) {
        labelText = parentLabel.textContent || '';
      }
    }

    // 如果还是没有，查找前面的兄弟节点
    if (!labelText) {
      let prevSibling = element.previousElementSibling;
      while (prevSibling) {
        if (prevSibling.tagName === 'LABEL' || prevSibling.tagName === 'SPAN') {
          const candidate = (prevSibling.textContent || '').replace(/\s+/g, ' ').trim();
          if (isUsableLabelCandidate(candidate)) {
            labelText = candidate;
            break;
          }
        }
        prevSibling = prevSibling.previousElementSibling;
      }
    }

    // 无标准 label 的站点（标题是普通 div）：向前找最多 3 个兄弟，
    // 取第一个含中英文、不含其它输入控件、不是错误/占位提示的短文本作为字段标题。
    if (!labelText) {
      let prevSibling = element.previousElementSibling;
      for (let depth = 0; prevSibling && depth < 3; depth += 1, prevSibling = prevSibling.previousElementSibling) {
        if (isInjectedHelperElement(prevSibling)) continue;
        if (prevSibling.querySelector?.('input, textarea, select')) continue;
        const candidate = (prevSibling.textContent || '').replace(/\s+/g, ' ').trim();
        if (isUsableLabelCandidate(candidate)) {
          labelText = candidate;
          break;
        }
      }
    }

    // 表单项容器结构：<div class=form-item><div>字段名</div><div class=control><input/></div></div>。
    // Moka 实测：input 直接父级是控件壳层，字段名挂在祖父级容器下，所以向上扫两层。
    // 守卫保证不会抓到相邻字段：相邻表单项的子树必含输入控件；包含当前控件的分支直接跳过。
    if (!labelText) {
      let current = element.parentElement;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        for (const child of Array.from(current.children || [])) {
          if (child.contains?.(element)) continue;
          if (isInjectedHelperElement(child)) continue;
          if (child.querySelector?.('input, textarea, select')) continue;
          const candidate = (child.textContent || '').replace(/\s+/g, ' ').trim();
          if (isUsableLabelCandidate(candidate)) {
            labelText = candidate;
            break;
          }
        }
        if (labelText) break;
      }
    }

    if (!labelText) {
      labelText = [element.getAttribute('aria-label') || '', elementDataI18nName, containerDataI18nName]
        .filter(Boolean).join(' ');
    }

    // 选择控件的单项标签通常只有“男/女”“是/否”，真正的字段名在外层分组。
    if (type === 'radio' || type === 'checkbox') {
      const group = element.closest<HTMLElement>(
        '[role="radiogroup"], [role="group"], fieldset, [data-form-field-id], [data-form-field-name], [class*=formItem], [class*=FormItem]'
      );
      const labelledBy = group?.getAttribute('aria-labelledby');
      const groupLabel = (
        group?.getAttribute('aria-label')
        || (labelledBy
          ? labelledBy.split(/\s+/).map(labelId => element.ownerDocument.getElementById(labelId)?.textContent || '').join(' ')
          : '')
        || group?.querySelector(':scope > legend, :scope > label, :scope > [class*=label], :scope > [class*=Label]')?.textContent
        || ''
      ).trim();
      labelText = `${groupLabel} ${labelText}`.trim();
    }

    const moduleContainer = element.closest<HTMLElement>(
      '[data-form-module], [data-section], [data-module], [class*=applyFormModuleWrapper]'
    );
    const moduleContext = FieldMatcher.extractModuleContext(moduleContainer);
    const contextText = `${moduleContext} ${labelText} ${name} ${id}`;

    if (/奖项|荣誉|获奖|award|honou?r/i.test(moduleContext)) {
      labelText = `${labelText} award-context 奖项`;
    }

    if (fieldContainer && /起止时间|就读时间|在校时间|学习时间|date range|start.*end|start_end/i.test(`${labelText} ${name} ${id} ${fieldContainer.textContent || ''}`)) {
      const marked = FieldMatcher.markDateRangeInputs(element, fieldContainer, contextText);
      if (marked) labelText = `${labelText} ${marked}`.trim();
    } else if (!fieldContainer) {
      // 无标识属性的站点（Moka 等）：按文字结构找日期容器——
      // 内层祖先同时满足"文本含起止/就读/在校时间"且只有 2-6 个可见输入控件。
      let current = element.parentElement;
      const body = element.ownerDocument?.body ?? null;
      for (let depth = 0; current && current !== body && depth < 6; depth += 1, current = current.parentElement) {
        const text = (current.textContent || '').replace(/\s+/g, ' ');
        if (!/起止时间|就读时间|在校时间|学习时间|开始时间.*结束时间|入学.*毕业/.test(text)) continue;
        const inputs = current.querySelectorAll(
          'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select'
        );
        if (inputs.length < 2 || inputs.length > 6) continue;
        const marked = FieldMatcher.markDateRangeInputs(element, current, contextText);
        if (marked) labelText = `${labelText} ${marked}`.trim();
        break;
      }
    }

    return {
      name,
      id,
      placeholder,
      labelText,
      type,
      autocomplete,
      moduleContext,
      rowContext: labelText,
    };
  }

  /**
   * 按控件在日期容器内的位置标注入学/毕业/开始/结束时间（含年/月分段标记）。
   * 教育还是工作由两级证据决定：行上下文文字，或祖先模块标题（教育背景/工作经历等）。
   * 返回标注后的 labelText；不属于任何日期语义时返回 null。
   */
  private static markDateRangeInputs(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    container: HTMLElement,
    contextText: string
  ): string | null {
    const fieldsInContainer = Array.from(
      container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select'
      )
    );
    const fieldIndex = fieldsInContainer.indexOf(element);
    if (fieldIndex < 0) return null;

    const section = FieldMatcher.detectSectionFromAncestors(element);
    const isEducationRange = /教育经历|学历类型|学校名称|学院|导师|教育背景/.test(contextText) || section === 'education';
    const isWorkRange = /实习经历|工作经历|公司名称|职位名称|没有实习经历/.test(contextText) || section === 'work';
    if (!isEducationRange && !isWorkRange) return null;

    const fourPartRange = fieldsInContainer.length >= 4;
    const isStart = fourPartRange ? fieldIndex <= 1 : fieldIndex === 0;
    const isEnd = fourPartRange ? fieldIndex >= 2 && fieldIndex <= 3 : fieldIndex === 1;
    const datePart = fourPartRange ? (fieldIndex % 2 === 0 ? ' datepart-year' : ' datepart-month') : '';

    if (isEducationRange && isStart) {
      return `入学时间 educationstart${datePart}`;
    }
    if (isEducationRange && isEnd) {
      return `毕业时间 graduation${datePart}`;
    }
    if (isWorkRange && isStart) {
      return `开始时间 startdate${datePart}`;
    }
    if (isWorkRange && isEnd) {
      return `结束时间 enddate${datePart}`;
    }
    return null;
  }

  /** 从祖先模块标题判断所属板块（教育背景/工作经历/项目经验…），内层优先。 */
  private static detectSectionFromAncestors(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  ): 'education' | 'work' | 'project' | null {
    let current = element.parentElement;
    const body = element.ownerDocument?.body ?? null;
    for (let depth = 0; current && current !== body && depth < 8; depth += 1, current = current.parentElement) {
      const text = (current.textContent || '').replace(/\s+/g, ' ').slice(0, 4000);
      if (/教育背景|教育经历|教育信息/.test(text)) return 'education';
      if (/工作经历|实习经历|工作经验/.test(text)) return 'work';
      if (/项目经验|项目经历|校园经历/.test(text)) return 'project';
    }
    return null;
  }

  private static extractModuleContext(module: HTMLElement | null): string {
    if (!module) return '';

    const stableIdentifiers = [
      module.getAttribute('data-form-module'),
      module.getAttribute('data-section'),
      module.getAttribute('data-module'),
      module.getAttribute('aria-label'),
    ];
    const labelledBy = module.getAttribute('aria-labelledby');
    const labelledText = labelledBy
      ?.split(/\s+/)
      .map(id => module.ownerDocument?.getElementById(id)?.textContent || '')
      .join(' ');
    const headingText = module.querySelector(
      ':scope > legend, :scope > [role="heading"], :scope > h1, :scope > h2, ' +
      ':scope > h3, :scope > h4, :scope > h5, :scope > h6, ' +
      'legend, [role="heading"], h1, h2, h3, h4, h5, h6'
    )?.textContent;

    return [...stableIdentifiers, labelledText, headingText]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 由标识符构建结构化证据。 */
  static buildEvidence(
    identifiers: ReturnType<typeof FieldMatcher.extractIdentifiers>,
    element?: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ): FieldEvidence {
    const inputType = identifiers.type || '';
    return {
      visibleLabel: identifiers.labelText || '',
      placeholder: identifiers.placeholder || '',
      name: identifiers.name || '',
      id: identifiers.id || '',
      autocomplete: identifiers.autocomplete || '',
      moduleContext: identifiers.moduleContext || '',
      rowContext: identifiers.rowContext || identifiers.labelText || '',
      inputType,
      controlKind: element ? detectControlKind(element, inputType) : 'other',
    };
  }

  /**
   * 兼容入口：无资料候选时的纯本地匹配（仅第 5/6 层 + 排除层）。
   * 需要别名/候选参与时请使用 matchField。
   */
  static matchFieldType(
    name: string,
    id: string,
    placeholder: string,
    labelText: string,
    type: string,
    autocomplete: string
  ): { fieldType: FieldType; confidence: number } {
    const evidence = FieldMatcher.buildEvidence({
      name,
      id,
      placeholder,
      labelText,
      type,
      autocomplete,
      moduleContext: '',
      rowContext: labelText,
    });

    const result = matchField(evidence);
    if (result.status === 'matched' && result.coreFieldType) {
      return { fieldType: result.coreFieldType, confidence: 0.9 };
    }
    return { fieldType: FieldType.UNKNOWN, confidence: 0 };
  }
}
