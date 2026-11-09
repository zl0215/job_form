import type { FieldAliasOverrides, ResumeProfile, ResumeProfileLibrary, UserProfile } from './types.ts';

export type { ResumeProfile, ResumeProfileLibrary } from './types.ts';

export function createEmptyUserProfile(): UserProfile {
  return {
    personal: { name: '', gender: '', birthDate: '', phone: '', email: '' },
    education: [],
    experience: [],
    projects: [],
    awards: [],
    customInformation: [],
    skills: [],
    certifications: [],
  };
}

export function uniqueProfileName(base: string, names: string[]): string {
  const value = base.trim() || '未命名简历';
  if (!names.includes(value)) return value;
  let index = 2;
  while (names.includes(`${value} ${index}`)) index += 1;
  return `${value} ${index}`;
}

function newProfile(name: string, profile: UserProfile, now: string): ResumeProfile {
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    profile: structuredClone(profile),
  };
}

function requireProfile(library: ResumeProfileLibrary, id: string): ResumeProfile {
  const profile = library.profiles.find(item => item.id === id);
  if (!profile) throw new Error('简历不存在');
  return profile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasStrings(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => typeof value[key] === 'string')
    && optional.every(key => value[key] === undefined || typeof value[key] === 'string');
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function isCanonicalObjectArray(value: unknown, fields: string[], allowCustomFields = false): boolean {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && hasStrings(item, fields)
    && (!allowCustomFields || item.customFields === undefined
      || (Array.isArray(item.customFields) && item.customFields.every(isCustomField)))
    && hasOnlyKeys(item, allowCustomFields ? [...fields, 'customFields'] : fields));
}

function isObjectArray(value: unknown, required: string[], optional: string[] = []): boolean {
  return Array.isArray(value)
    && value.every(item => isRecord(item) && hasStrings(item, required, optional));
}

function isCustomField(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasStrings(value, ['id', 'name', 'value', 'type'], ['unit', 'presetKey'])) return false;
  if (!Array.isArray(value.aliases) || !value.aliases.every(alias => typeof alias === 'string')) return false;
  if (value.options !== undefined && (!Array.isArray(value.options) || !value.options.every(option => typeof option === 'string'))) return false;
  return typeof value.allowAI === 'boolean' && typeof value.sensitive === 'boolean';
}

function isCustomInformation(value: unknown): boolean {
  if (!isRecord(value) || !hasStrings(value, ['id', 'name', 'content'], ['moduleName', 'fieldType', 'unit'])) return false;
  if (value.aliases !== undefined && (!Array.isArray(value.aliases) || !value.aliases.every(alias => typeof alias === 'string'))) return false;
  if (value.allowAI !== undefined && typeof value.allowAI !== 'boolean') return false;
  return value.sensitive === undefined || typeof value.sensitive === 'boolean';
}

function isCustomModules(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(module =>
    isRecord(module)
    && hasStrings(module, ['id', 'name'], ['presetKey'])
    && typeof module.repeatable === 'boolean'
    && Array.isArray(module.records)
    && module.records.every(record => isRecord(record)
      && hasStrings(record, ['id'], ['title'])
      && Array.isArray(record.fields)
      && record.fields.every(isCustomField))
  ));
}

/** 字段别名覆盖：key -> { added: string[] }；非法类型一律视为无效。 */
export function isValidFieldAliasOverrides(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return Object.values(value).every(entry => isRecord(entry)
    && Array.isArray(entry.added)
    && entry.added.every(alias => typeof alias === 'string'));
}

/** 深拷贝别名数组并去掉空值/重复项，避免跨简历资料共享引用。 */
function normalizeFieldAliasOverrides(value: unknown): FieldAliasOverrides | undefined {
  if (!isRecord(value)) return undefined;
  const result: FieldAliasOverrides = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || !Array.isArray(entry.added)) continue;
    const added = Array.from(new Set(
      entry.added.filter((alias): alias is string => typeof alias === 'string' && alias.trim() !== '')
        .map(alias => alias.trim()),
    ));
    if (added.length > 0) result[key] = { added };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function isValidUserProfileInput(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.personal)) return false;
  if (!hasStrings(
    value.personal,
    ['name', 'gender', 'birthDate', 'phone', 'email'],
    ['wechat', 'idCard', 'politicalStatus', 'ethnicity', 'hometown', 'currentAddress', 'selfEvaluation'],
  )) return false;
  if (value.personal.customFields !== undefined
    && (!Array.isArray(value.personal.customFields) || !value.personal.customFields.every(isCustomField))) return false;
  if (!isObjectArray(value.education, ['id', 'school', 'major', 'degree', 'startDate', 'endDate'], ['college', 'educationType', 'gpa', 'ranking'])) return false;
  if (!isObjectArray(value.experience, ['id', 'company', 'position'], ['startDate', 'endDate', 'description', 'achievements'])) return false;
  if (!isObjectArray(value.projects, ['id', 'name', 'role'], ['startDate', 'endDate', 'description', 'achievements', 'technologies'])) return false;
  if (value.awards !== undefined && !isObjectArray(value.awards, ['name'], ['id', 'role', 'date', 'description'])) return false;
  for (const records of [value.education, value.experience, value.projects, value.awards || []]) {
    if (!(records as unknown[]).every(record => isRecord(record)
      && (record.customFields === undefined
        || (Array.isArray(record.customFields) && record.customFields.every(isCustomField))))) return false;
  }
  if (!Array.isArray(value.customInformation) || !value.customInformation.every(isCustomInformation)) return false;
  if (!isCustomModules(value.customModules)) return false;
  if (!isValidFieldAliasOverrides(value.fieldAliasOverrides)) return false;
  if (!Array.isArray(value.skills) || !value.skills.every(item => typeof item === 'string')) return false;
  if (!isObjectArray(value.certifications, ['id', 'name', 'issuer', 'date'], ['credentialId'])) return false;
  if (value.resume !== undefined) {
    if (!isRecord(value.resume) || !hasStrings(value.resume, ['fileName', 'fileData', 'fileType', 'uploadDate'], ['parsedText'])) return false;
  }
  return true;
}

export function normalizeUserProfileData(profile: unknown): UserProfile {
  const source = profile as Partial<UserProfile> & { awards?: unknown[] };
  const personal = (source.personal || {}) as Partial<UserProfile['personal']>;
  const optionalPersonal = (key: keyof UserProfile['personal']): string | undefined =>
    typeof personal[key] === 'string' ? personal[key] : undefined;
  const normalizedPersonal = {
    ...structuredClone(personal),
    name: optionalPersonal('name') || '', gender: optionalPersonal('gender') || '',
    birthDate: optionalPersonal('birthDate') || '', phone: optionalPersonal('phone') || '',
    email: optionalPersonal('email') || '',
  } as UserProfile['personal'];
  const aliasOverrides = isValidFieldAliasOverrides(source.fieldAliasOverrides)
    ? normalizeFieldAliasOverrides(source.fieldAliasOverrides)
    : undefined;
  const normalized: UserProfile = {
    ...structuredClone(source),
    personal: normalizedPersonal,
    ...(aliasOverrides ? { fieldAliasOverrides: aliasOverrides } : {}),
    education: structuredClone(source.education || []),
    experience: (source.experience || []).map(item => ({
      id: item.id, company: item.company, position: item.position,
      startDate: item.startDate || '', endDate: item.endDate || '', description: item.description || '',
      ...(item.customFields ? { customFields: structuredClone(item.customFields) } : {}),
    })),
    projects: (source.projects || []).map(item => ({
      id: item.id, name: item.name, role: item.role,
      startDate: item.startDate || '', endDate: item.endDate || '', description: item.description || '',
      ...(item.customFields ? { customFields: structuredClone(item.customFields) } : {}),
    })),
    awards: (source.awards || []).map(item => {
      const award: Record<string, unknown> = isRecord(item) ? item : {};
      return {
        id: typeof award.id === 'string' ? award.id : '',
        name: typeof award.name === 'string' ? award.name : '',
        role: typeof award.role === 'string' ? award.role : '',
        date: typeof award.date === 'string' ? award.date : '',
        description: typeof award.description === 'string' ? award.description : '',
        ...(Array.isArray(award.customFields) ? { customFields: structuredClone(award.customFields) } : {}),
      };
    }),
    customInformation: structuredClone(source.customInformation || []),
    ...(source.customModules !== undefined
      ? { customModules: structuredClone(source.customModules) }
      : {}),
    skills: structuredClone(source.skills || []),
    certifications: structuredClone(source.certifications || []),
    ...(source.resume ? { resume: structuredClone(source.resume) } : {}),
  };
  // 规范化后的覆盖必须替换原始值（含 undefined：完全无效或为空时移除该键）。
  if (aliasOverrides) normalized.fieldAliasOverrides = aliasOverrides;
  else delete normalized.fieldAliasOverrides;
  return normalized;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

function validateLibrary(value: unknown): ResumeProfileLibrary {
  if (!isRecord(value)) throw new Error('资料库格式无效');
  if (value.schemaVersion !== 1 || !Array.isArray(value.profiles) || value.profiles.length === 0) {
    throw new Error('资料库格式无效');
  }
  const profiles = value.profiles;
  for (const entry of profiles) {
    if (!isRecord(entry)) throw new Error('简历条目格式无效');
    if (typeof entry.id !== 'string' || entry.id.trim() === '') throw new Error('简历 ID 必须是非空字符串');
    if (typeof entry.name !== 'string' || entry.name.trim() === '') throw new Error('简历名称必须是非空字符串');
    if (!isValidTimestamp(entry.createdAt)) throw new Error('简历创建时间必须是有效字符串');
    if (!isValidTimestamp(entry.updatedAt)) throw new Error('简历更新时间必须是有效字符串');
    if (!isValidUserProfileInput(entry.profile)) throw new Error('用户资料格式无效');
  }
  const typedProfiles = profiles as unknown as ResumeProfile[];
  const ids = typedProfiles.map(profile => profile.id);
  const names = typedProfiles.map(profile => profile.name.trim());
  if (new Set(ids).size !== ids.length) throw new Error('简历 ID 重复');
  if (new Set(names).size !== names.length) throw new Error('简历名称重复');
  return value as unknown as ResumeProfileLibrary;
}

export function isCanonicalResumeProfileLibrary(value: unknown): value is ResumeProfileLibrary {
  try {
    const library = validateLibrary(value);
    return library.profiles.every(profile => profile.name === profile.name.trim()
      && isCanonicalObjectArray(profile.profile.experience, ['id', 'company', 'position', 'startDate', 'endDate', 'description'], true)
      && isCanonicalObjectArray(profile.profile.projects, ['id', 'name', 'role', 'startDate', 'endDate', 'description'], true)
      && isCanonicalObjectArray(profile.profile.awards, ['id', 'name', 'role', 'date', 'description'], true))
      && library.profiles.some(profile => profile.id === library.activeProfileId);
  } catch {
    return false;
  }
}

export function normalizeResumeProfileLibrary(value: unknown, legacyProfile?: UserProfile): ResumeProfileLibrary {
  if (value == null) {
    const now = new Date().toISOString();
    const profile = newProfile('默认简历', normalizeUserProfileData(legacyProfile ?? createEmptyUserProfile()), now);
    return { schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] };
  }
  const library = validateLibrary(value);
  const profiles = library.profiles.map(profile => ({
    ...structuredClone(profile),
    name: profile.name.trim(),
    profile: normalizeUserProfileData(profile.profile),
  }));
  const activeProfileId = profiles.some(profile => profile.id === library.activeProfileId)
    ? library.activeProfileId
    : profiles[0].id;
  return { schemaVersion: 1, activeProfileId, profiles };
}

export function createResumeProfile(library: ResumeProfileLibrary, nameOrNow: string, legacyNow?: string): ResumeProfileLibrary {
  const now = legacyNow ?? nameOrNow;
  const trimmed = legacyNow ? nameOrNow.trim() : uniqueProfileName('未命名简历', library.profiles.map(item => item.name));
  if (!trimmed) throw new Error('简历名称不能为空');
  if (legacyNow && library.profiles.some(profile => profile.name === trimmed)) throw new Error('简历名称已存在');
  const profile = newProfile(
    trimmed,
    createEmptyUserProfile(),
    now,
  );
  return { ...library, activeProfileId: profile.id, profiles: [...library.profiles, profile] };
}

export function duplicateResumeProfile(library: ResumeProfileLibrary, id: string, now: string): ResumeProfileLibrary {
  const source = requireProfile(library, id);
  const profile = newProfile(
    uniqueProfileName(`${source.name} - 副本`, library.profiles.map(item => item.name)),
    source.profile,
    now,
  );
  return { ...library, activeProfileId: profile.id, profiles: [...library.profiles, profile] };
}

export function renameResumeProfile(library: ResumeProfileLibrary, id: string, name: string, now: string): ResumeProfileLibrary {
  requireProfile(library, id);
  const trimmed = name.trim();
  if (!trimmed) throw new Error('简历名称不能为空');
  if (library.profiles.some(profile => profile.id !== id && profile.name === trimmed)) {
    throw new Error('简历名称已存在');
  }
  return {
    ...library,
    profiles: library.profiles.map(profile => profile.id === id ? { ...profile, name: trimmed, updatedAt: now } : profile),
  };
}

export function deleteResumeProfile(library: ResumeProfileLibrary, id: string): ResumeProfileLibrary {
  requireProfile(library, id);
  if (library.profiles.length === 1) throw new Error('至少保留一套简历');
  const deletedIndex = library.profiles.findIndex(profile => profile.id === id);
  const profiles = library.profiles.filter(profile => profile.id !== id);
  const fallback = profiles[deletedIndex] ?? profiles[deletedIndex - 1] ?? profiles[0];
  return {
    ...library,
    profiles,
    activeProfileId: library.activeProfileId === id ? fallback.id : library.activeProfileId,
  };
}

export function switchResumeProfile(library: ResumeProfileLibrary, id: string): ResumeProfileLibrary {
  requireProfile(library, id);
  return { ...library, activeProfileId: id };
}

export function updateActiveUserProfile(library: ResumeProfileLibrary, profile: UserProfile, now: string): ResumeProfileLibrary {
  requireProfile(library, library.activeProfileId);
  return {
    ...library,
    profiles: library.profiles.map(item => item.id === library.activeProfileId
      ? { ...item, profile: normalizeUserProfileData(profile), updatedAt: now }
      : item),
  };
}
