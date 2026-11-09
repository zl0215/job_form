// “记住一次”字段学习（popup「本页字段对照」的纯逻辑层）。
//
// 用户把本页未识别字段映射到某个资料字段后，把网页字段的可见标题追加到当前
// 简历的 profile.fieldAliasOverrides[key].added；下次任意站点出现同名标题时，
// 既有别名匹配层（profileAnswerCandidates + fieldMatcher）会直接命中。
//
// 硬约束：
// - 只学习网页字段的可见标题/占位文字，绝不携带或返回任何资料值；
// - 永久禁止字段（内推码/推荐码/验证码/密码/系统编号）绝不可学习；
// - 敏感字段允许学习（匹配全程在本地完成），但下拉候选必须带敏感标注；
// - 只追加到指定 profile key，绝不改动其它 key（跨模块不误写）。

import type { FieldAliasOverrides, UserProfile } from './types.ts';
import { matchBlockedField } from './blockedFields.ts';
import { buildProfileAnswerCandidates } from './profileAnswerCandidates.ts';
import { normalizeFieldText } from '../utils/fieldText.ts';

/** 学习别名的最大长度（按 Unicode 字符计）；超长标题截断后仍可作为包含匹配的别名。 */
export const LEARNED_ALIAS_MAX_LENGTH = 40;

/** 下拉候选：只含字段身份信息，永远不携带资料值。 */
export interface LearnableProfileField {
  /** 稳定资料 key，写入 fieldAliasOverrides 的键。 */
  key: string;
  label: string;
  /** 所属模块：personal / education / experience / project / award / custom / module.<id>。 */
  scope: string;
  /** 模块中文名（用于下拉展示）。 */
  scopeLabel: string;
  /** 敏感字段仍可学习，但界面必须标注“敏感”。 */
  sensitive: boolean;
}

export type FieldAliasValidationError =
  | 'EMPTY_ALIAS'
  | 'ALIAS_TOO_LONG'
  | 'BLOCKED_FIELD'
  | 'MISSING_PROFILE_KEY';

export interface AliasValidationResult {
  ok: boolean;
  /** 规范化后的别名（ok 时可直接保存）。 */
  alias: string;
  error?: FieldAliasValidationError;
  /** 命中禁止字段时的中文类别名，如“验证码”。 */
  blockedLabel?: string;
}

export interface AddLearnedAliasResult {
  ok: boolean;
  /** 新的别名覆盖对象；输入对象不会被修改。 */
  overrides: FieldAliasOverrides;
  /** 本次是否真的新增了别名。 */
  added: boolean;
  /** 该别名此前已经记住过（此时 added=false）。 */
  alreadyExists: boolean;
  /** 保存后该资料字段的别名数量。 */
  keyAliasCount: number;
  /** 保存后当前简历的别名总数。 */
  totalAliasCount: number;
  error?: FieldAliasValidationError;
  blockedLabel?: string;
}

const WHITESPACE = /[\s\u3000]+/g;

/** 单行标题规范化：连续空白压成一个空格并去首尾空白，保留中英文原始大小写。 */
export function normalizeLearnedAlias(alias: string): string {
  return (alias || '').replace(WHITESPACE, ' ').trim();
}

/** 按 Unicode 码点截断，避免把 emoji / 生僻字截成半个代理对。 */
export function truncateLearnedAlias(alias: string, maxLength = LEARNED_ALIAS_MAX_LENGTH): string {
  const characters = Array.from(alias);
  return characters.length > maxLength ? characters.slice(0, maxLength).join('') : alias;
}

/**
 * 建议的别名文本：优先可见标题，其次 placeholder，最后 name/id 标识符。
 * 返回空字符串表示该字段没有可用于学习的名称。
 */
export function suggestLearnedAlias(parts: {
  label?: string;
  placeholder?: string;
  name?: string;
}): string {
  for (const raw of [parts.label, parts.placeholder, parts.name]) {
    const normalized = normalizeLearnedAlias(raw || '');
    if (normalized) return truncateLearnedAlias(normalized);
  }
  return '';
}

/**
 * 校验一个网页字段标题能否作为学习别名。
 * 禁止字段先于长度校验：验证码/密码等即使标题超长也必须明确拒绝。
 */
export function validateLearnedAlias(alias: string): AliasValidationResult {
  const normalized = normalizeLearnedAlias(alias);
  if (!normalized) return { ok: false, alias: '', error: 'EMPTY_ALIAS' };

  const blocked = matchBlockedField({ labelText: normalized });
  if (blocked) {
    return { ok: false, alias: normalized, error: 'BLOCKED_FIELD', blockedLabel: blocked.label };
  }
  if (Array.from(normalized).length > LEARNED_ALIAS_MAX_LENGTH) {
    return { ok: false, alias: normalized, error: 'ALIAS_TOO_LONG' };
  }
  return { ok: true, alias: normalized };
}

/** 用户可读的保存失败原因。 */
export function describeFieldAliasError(
  error: FieldAliasValidationError | undefined,
  blockedLabel?: string,
): string {
  switch (error) {
    case 'EMPTY_ALIAS':
      return '页面字段标题为空，无法记住';
    case 'ALIAS_TOO_LONG':
      return `页面字段标题过长（最多 ${LEARNED_ALIAS_MAX_LENGTH} 个字符），无法记住`;
    case 'BLOCKED_FIELD':
      return `“${blockedLabel || '该字段'}”属于禁止自动填写的字段，不能记住`;
    case 'MISSING_PROFILE_KEY':
      return '请选择要对应的资料字段';
    default:
      return '字段对照保存失败';
  }
}

function cloneOverrides(overrides?: FieldAliasOverrides): FieldAliasOverrides {
  const result: FieldAliasOverrides = {};
  for (const [key, entry] of Object.entries(overrides || {})) {
    if (!entry || !Array.isArray(entry.added)) continue;
    result[key] = { added: [...entry.added] };
  }
  return result;
}

/** 读取某个资料字段已学习的别名（返回副本）。 */
export function learnedAliasesForKey(
  overrides: FieldAliasOverrides | undefined,
  profileKey: string,
): string[] {
  return [...(overrides?.[profileKey]?.added || [])];
}

/** 当前简历学习过的别名总数。 */
export function countLearnedAliases(overrides?: FieldAliasOverrides): number {
  return Object.values(overrides || {}).reduce(
    (total, entry) => total + (entry?.added?.length || 0),
    0,
  );
}

/**
 * 把网页字段标题追加到指定资料 key 的 added 列表。
 * - 去重按 normalizeFieldText 比较（大小写/空白/标点差异视为同一别名）；
 * - 只写 profileKey 这一个 key，其它 key 原样保留；
 * - 不改动入参对象（返回深拷贝后的新对象，便于测试与并发安全）。
 */
export function addLearnedAlias(
  overrides: FieldAliasOverrides | undefined,
  profileKey: string,
  alias: string,
): AddLearnedAliasResult {
  const key = (profileKey || '').trim();
  const next = cloneOverrides(overrides);
  if (!key) {
    return {
      ok: false,
      overrides: next,
      added: false,
      alreadyExists: false,
      keyAliasCount: 0,
      totalAliasCount: countLearnedAliases(next),
      error: 'MISSING_PROFILE_KEY',
    };
  }

  const validation = validateLearnedAlias(alias);
  const baseKeyCount = next[key]?.added.length || 0;
  if (!validation.ok) {
    return {
      ok: false,
      overrides: next,
      added: false,
      alreadyExists: false,
      keyAliasCount: baseKeyCount,
      totalAliasCount: countLearnedAliases(next),
      error: validation.error,
      blockedLabel: validation.blockedLabel,
    };
  }

  const existing = next[key]?.added || [];
  const normalizedTarget = normalizeFieldText(validation.alias);
  const alreadyExists = existing.some(item => normalizeFieldText(item) === normalizedTarget);
  if (alreadyExists) {
    return {
      ok: true,
      overrides: next,
      added: false,
      alreadyExists: true,
      keyAliasCount: existing.length,
      totalAliasCount: countLearnedAliases(next),
    };
  }

  next[key] = { added: [...existing, validation.alias] };
  return {
    ok: true,
    overrides: next,
    added: true,
    alreadyExists: false,
    keyAliasCount: existing.length + 1,
    totalAliasCount: countLearnedAliases(next),
  };
}

function scopeLabelFor(profile: UserProfile, scope: string): string {
  switch (scope) {
    case 'personal':
      return '个人基本';
    case 'education':
      return '教育经历';
    case 'experience':
      return '实习/工作经历';
    case 'project':
      return '项目经历';
    case 'award':
      return '奖项/荣誉';
    case 'custom':
      return '其他信息';
    default: {
      if (scope.startsWith('module.')) {
        const moduleId = scope.slice('module.'.length);
        const module = (profile.customModules || []).find(item => item.id === moduleId);
        return module?.name?.trim() || '自定义模块';
      }
      return scope || '资料';
    }
  }
}

/**
 * 本页未识别字段的下拉候选：来自 buildProfileAnswerCandidates（按当前资料），
 * 只保留字段身份信息（key / label / scope / sensitive），不把资料值带到界面。
 */
export function toLearnableProfileFields(profile: UserProfile): LearnableProfileField[] {
  const seen = new Set<string>();
  const fields: LearnableProfileField[] = [];
  for (const candidate of buildProfileAnswerCandidates(profile, profile.fieldAliasOverrides)) {
    if (!candidate.key || seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    fields.push({
      key: candidate.key,
      label: candidate.label,
      scope: candidate.scope,
      scopeLabel: scopeLabelFor(profile, candidate.scope),
      sensitive: candidate.sensitive,
    });
  }
  return fields;
}

/** 校验 profileKey 是否仍指向当前资料里的字段（防止保存陈旧/伪造的 key）。 */
export function isKnownProfileField(profile: UserProfile, profileKey: string): boolean {
  const key = (profileKey || '').trim();
  return Boolean(key) && toLearnableProfileFields(profile).some(field => field.key === key);
}
