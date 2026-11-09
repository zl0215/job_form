import type {
  CustomInformation,
  ProfileCustomField,
  ProfileCustomModule,
  ProfileFieldType,
  UserProfile,
} from './types.ts';

export const PROFILE_FIELD_TYPE_LABELS: Record<ProfileFieldType, string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字 / 单位',
  year: '年份',
  month: '年月',
  date: '年月日',
  single: '单选值',
  multi: '多选值',
  boolean: '是 / 否',
  url: '网址',
  file: '文件',
  'date-range': '时间范围',
  address: '地址',
};

export function createCustomField(name = '', type: ProfileFieldType = 'text'): ProfileCustomField {
  return {
    id: crypto.randomUUID(),
    name,
    value: '',
    type,
    aliases: [],
    allowAI: true,
    sensitive: false,
  };
}

export function createCustomModule(name = '新模块'): ProfileCustomModule {
  return {
    id: crypto.randomUUID(),
    name,
    repeatable: false,
    records: [{ id: crypto.randomUUID(), fields: [] }],
  };
}

export function collectCustomInformation(profile: UserProfile): CustomInformation[] {
  const legacy = profile.customInformation || [];
  const personal = (profile.personal.customFields || []).map(field => toCustomInformation(field, '个人基本信息'));
  const builtInRecords = [
    ...profile.education.flatMap((record, index) => (record.customFields || []).map(field => toCustomInformation(field, `教育经历 ${record.school || index + 1}`))),
    ...profile.experience.flatMap((record, index) => (record.customFields || []).map(field => toCustomInformation(field, `实习/工作经历 ${record.company || index + 1}`))),
    ...profile.projects.flatMap((record, index) => (record.customFields || []).map(field => toCustomInformation(field, `项目经历 ${record.name || index + 1}`))),
    ...profile.awards.flatMap((record, index) => (record.customFields || []).map(field => toCustomInformation(field, `奖项/荣誉 ${record.name || index + 1}`))),
  ];
  const modules = (profile.customModules || []).flatMap(module =>
    module.records.flatMap((record, recordIndex) =>
      record.fields.map(field => toCustomInformation(
        field,
        module.repeatable ? `${module.name} ${record.title || recordIndex + 1}` : module.name,
      )),
    ),
  );
  return [...legacy, ...personal, ...builtInRecords, ...modules];
}

export function upgradeProfileCustomData(profile: UserProfile): UserProfile {
  if ((profile.customModules || []).length > 0 || (profile.customInformation || []).length === 0) {
    return { ...profile, customModules: profile.customModules || [] };
  }

  return {
    ...profile,
    customInformation: [],
    customModules: [{
      id: 'legacy-custom-information',
      name: '其他信息',
      repeatable: false,
      records: [{
        id: 'legacy-custom-information-record',
        fields: profile.customInformation.map(item => ({
          id: item.id,
          name: item.name,
          value: item.content,
          type: item.fieldType || 'text',
          aliases: item.aliases || [],
          unit: item.unit,
          allowAI: item.allowAI !== false,
          sensitive: Boolean(item.sensitive),
        })),
      }],
    }],
  };
}

export function profileForAI(profile: UserProfile): UserProfile {
  const clone = structuredClone(profile);
  delete clone.personal.idCard;
  clone.personal.customFields = (clone.personal.customFields || [])
    .filter(field => field.allowAI && !field.sensitive && field.value.trim());
  for (const records of [clone.education, clone.experience, clone.projects, clone.awards]) {
    for (const record of records) {
      record.customFields = (record.customFields || [])
        .filter(field => field.allowAI && !field.sensitive && field.value.trim());
    }
  }
  clone.customModules = (clone.customModules || []).map(module => ({
    ...module,
    records: module.records.map(record => ({
      ...record,
      fields: record.fields.filter(field => field.allowAI && !field.sensitive && field.value.trim()),
    })),
  }));
  clone.customInformation = (clone.customInformation || [])
    .filter(field => field.allowAI !== false && !field.sensitive && field.content.trim());
  return clone;
}

export function aliasesFromText(value: string): string[] {
  return Array.from(new Set(
    value.split(/[，,、;；\n]/).map(item => item.trim()).filter(Boolean),
  ));
}

export function aliasesToText(value: string[]): string {
  return value.join('、');
}

function toCustomInformation(field: ProfileCustomField, moduleName: string): CustomInformation {
  return {
    id: field.id,
    name: field.name,
    content: field.value,
    aliases: field.aliases,
    moduleName,
    fieldType: field.type,
    unit: field.unit,
    allowAI: field.allowAI,
    sensitive: field.sensitive,
  };
}
