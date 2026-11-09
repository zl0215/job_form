import type { CustomInformation, DetectedField } from '../shared/types.ts';
import type { UnmatchedField } from './formDetector.ts';

function normalizeFieldText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/必填|选填|required|optional/gi, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function matchCustomInformationFields(
  fields: UnmatchedField[],
  customInformation: CustomInformation[],
): DetectedField[] {
  const candidates = customInformation
    .filter(item => item.name.trim() && item.content.trim())
    .map(item => ({
      item,
      normalizedNames: [item.name, ...(item.aliases || [])]
        .map(normalizeFieldText)
        .filter(name => name.length >= 2),
      normalizedModule: normalizeFieldText(item.moduleName || ''),
    }))
    .filter(candidate => candidate.normalizedNames.length > 0);

  return fields.flatMap(field => {
    const identifiers = field.identifiers;
    const label = normalizeFieldText(identifiers.labelText);
    const searchable = normalizeFieldText([
      identifiers.name,
      identifiers.id,
      identifiers.placeholder,
      identifiers.labelText,
      identifiers.autocomplete,
    ].join(' '));

    const match = candidates
      .map(candidate => {
        const matchedName = candidate.normalizedNames
          .filter(name => label === name || searchable.includes(name) || (name.length >= 4 && name.includes(label) && label.length >= 2))
          .sort((left, right) => right.length - left.length)[0] || '';
        const exactLabel = label === matchedName;
        const included = Boolean(matchedName) && searchable.includes(matchedName);
        const reverseIncluded = Boolean(matchedName) && matchedName.length >= 4
          && matchedName.includes(label)
          && label.length >= 2;
        const moduleBonus = candidate.normalizedModule && searchable.includes(candidate.normalizedModule) ? 0.04 : 0;
        return {
          ...candidate,
          matchedName,
          score: Math.min(1, (exactLabel ? 1 : included ? 0.92 : reverseIncluded ? 0.8 : 0) + moduleBonus),
        };
      })
      .filter(candidate => candidate.score > 0)
      .sort((left, right) => right.score - left.score || right.matchedName.length - left.matchedName.length)[0];

    if (!match) return [];

    return [{
      element: field.element,
      fieldType: `custom:${match.item.id}`,
      confidence: match.score,
      profileValue: match.item.content,
    }];
  });
}
