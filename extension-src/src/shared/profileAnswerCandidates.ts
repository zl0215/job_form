// 统一答案候选（方案 §8.2 / §12.4）。
// 把个人基本字段、预设字段、各经历记录的详细字段、自定义模块与旧版
// customInformation 展平成同一种候选，匹配器不再区分"内置先匹配、
// 自定义只能捡剩下的"。

import type { CustomInformation, ProfileCustomField, UserProfile } from './types.ts';
import { PROFILE_FIELD_REGISTRY, type ProfileFieldDefinition } from './profileFieldRegistry.ts';
import type { FieldAliasOverrides } from './types.ts';

export interface ProfileAnswerCandidate {
  /** 候选唯一 id，custom:* 形式可直接作为 DetectedField.fieldType。 */
  id: string;
  /** 稳定语义 key：注册表 key 或 custom:<id>。 */
  key: string;
  label: string;
  aliases: string[];
  /** 注册表核心字段为 ''（由记录索引管线取值），其余为用户资料值。 */
  value: string;
  scope: string;
  recordIndex?: number;
  sensitive: boolean;
  allowAI: boolean;
  /** 核心字段对应的 FieldType；走 FormFiller 既有取值分支。 */
  coreFieldType?: string;
}

function coreCandidate(
  definition: ProfileFieldDefinition,
  value: string,
): ProfileAnswerCandidate {
  return {
    id: definition.key,
    key: definition.key,
    label: definition.label,
    aliases: definition.aliases,
    value,
    scope: definition.key.split('.')[0],
    sensitive: Boolean(definition.sensitive),
    allowAI: !definition.sensitive,
    ...(definition.fieldType ? { coreFieldType: definition.fieldType } : {}),
  };
}

function customFieldCandidate(
  field: ProfileCustomField,
  scope: string,
  recordIndex?: number,
): ProfileAnswerCandidate {
  const key = field.presetKey || `custom:${field.id}`;
  return {
    id: `custom:${field.id}`,
    key,
    label: field.name,
    aliases: field.aliases || [],
    value: field.value,
    scope,
    recordIndex,
    sensitive: Boolean(field.sensitive),
    allowAI: Boolean(field.allowAI),
  };
}

function legacyInformationCandidate(item: CustomInformation): ProfileAnswerCandidate {
  return {
    id: `custom:${item.id}`,
    key: `custom:${item.id}`,
    label: item.name,
    aliases: item.aliases || [],
    value: item.content,
    scope: 'custom',
    sensitive: Boolean(item.sensitive),
    allowAI: item.allowAI !== false,
  };
}

/** 重复模块中同一 presetKey 的多条记录合并为一个候选：取第一条非空值。 */
function mergedCustomCandidates(
  groups: Array<{ fields: ProfileCustomField[]; recordIndex: number }>,
  scope: string,
): ProfileAnswerCandidate[] {
  const byKey = new Map<string, ProfileAnswerCandidate>();
  const ordered: ProfileAnswerCandidate[] = [];
  for (const group of groups) {
    for (const field of group.fields) {
      if (!field.name.trim() || !field.value.trim()) continue;
      const candidate = customFieldCandidate(field, scope, group.recordIndex);
      const mergeKey = field.presetKey || candidate.id;
      const existing = byKey.get(mergeKey);
      if (!existing) {
        byKey.set(mergeKey, candidate);
        ordered.push(candidate);
      } else if (!existing.value.trim()) {
        byKey.set(mergeKey, candidate);
        ordered.splice(ordered.indexOf(existing), 1, candidate);
      }
    }
  }
  return ordered;
}

export function buildProfileAnswerCandidates(
  profile: UserProfile,
  aliasOverrides?: FieldAliasOverrides,
): ProfileAnswerCandidate[] {
  const candidates: ProfileAnswerCandidate[] = [];
  const seenAliasOwners = new Map<string, string>();

  // 1) 注册表核心字段（个人基本字段直接取值；经历类字段由记录索引管线取值）。
  for (const definition of PROFILE_FIELD_REGISTRY) {
    let value = '';
    if (definition.key.startsWith('personal.')) {
      const directKey = definition.key.slice('personal.'.length) as keyof UserProfile['personal'];
      const direct = profile.personal[directKey];
      value = typeof direct === 'string' ? direct : '';
    } else if (definition.key.startsWith('education.') && !definition.fieldType) {
      // 记录级直取字段（如排名）：取第一条非空记录的值（宁可少填，不做记录猜测）。
      const directKey = definition.key.slice('education.'.length) as keyof (typeof profile.education)[number];
      const record = profile.education.find(item => {
        const direct = item[directKey];
        return typeof direct === 'string' && direct.trim() !== '';
      });
      value = record ? (record[directKey] as string) : '';
    }
    candidates.push(coreCandidate(definition, value));
  }

  // 2) 个人预设/自定义字段。
  for (const field of profile.personal.customFields || []) {
    if (!field.name.trim() || !field.value.trim()) continue;
    candidates.push(customFieldCandidate(field, 'personal'));
  }

  // 3) 各经历记录的预设/自定义字段（同一 presetKey 跨记录合并）。
  const recordGroups: Array<[Array<{ fields: ProfileCustomField[]; recordIndex: number }>, string]> = [
    [profile.education.map((record, index) => ({ fields: record.customFields || [], recordIndex: index })), 'education'],
    [profile.experience.map((record, index) => ({ fields: record.customFields || [], recordIndex: index })), 'experience'],
    [profile.projects.map((record, index) => ({ fields: record.customFields || [], recordIndex: index })), 'project'],
    [profile.awards.map((record, index) => ({ fields: record.customFields || [], recordIndex: index })), 'award'],
  ];
  for (const [groups, scope] of recordGroups) {
    candidates.push(...mergedCustomCandidates(groups, scope));
  }

  // 4) 自定义模块。
  for (const module of profile.customModules || []) {
    const scope = `module.${module.id}`;
    if (module.repeatable) {
      candidates.push(...mergedCustomCandidates(
        module.records.map((record, index) => ({ fields: record.fields, recordIndex: index })),
        scope,
      ));
    } else {
      for (const record of module.records) {
        for (const field of record.fields) {
          if (!field.name.trim() || !field.value.trim()) continue;
          candidates.push(customFieldCandidate(field, scope));
        }
      }
    }
  }

  // 5) 旧版 customInformation（仅兼容）。
  for (const item of profile.customInformation || []) {
    if (!item.name.trim() || !item.content.trim()) continue;
    candidates.push(legacyInformationCandidate(item));
  }

  // 6) 用户为字段配置的别名覆盖（阶段 3 起由设置页维护）：
  //    合并进对应候选的别名列表，不改变稳定 key 与已有值。
  if (aliasOverrides) {
    for (const candidate of candidates) {
      const override = aliasOverrides[candidate.key];
      if (override?.added?.length) {
        candidate.aliases = Array.from(new Set([...candidate.aliases, ...override.added]));
      }
    }
  }

  // 7) 去掉无名称/无值的候选（§21.13：没有值不参与自动填写）。
  return candidates.filter(candidate => candidate.label.trim() && (candidate.value.trim() || candidate.coreFieldType));
}

/** 调试/诊断用：列出候选的规范化名称与别名。 */
export function candidateNames(candidate: ProfileAnswerCandidate): string[] {
  return [candidate.label, ...candidate.aliases];
}
