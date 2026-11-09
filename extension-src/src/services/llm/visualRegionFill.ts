import type {
  UserProfile,
  VisualRegionControlCandidate,
  VisualRegionFillMapping,
  VisualRegionFillMappingResult,
  VisualRegionFillPayload,
} from '../../shared/types.ts';

export function parseVisualRegionFillResponse(raw: string): VisualRegionFillMappingResult {
  const normalized = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error('视觉补填结果不是合法 JSON');
  }

  const mappings = Array.isArray((parsed as { mappings?: unknown })?.mappings)
    ? (parsed as { mappings: unknown[] }).mappings
        .filter(isVisualRegionFillMapping)
        .map(mapping => ({
          controlId: mapping.controlId.trim(),
          fieldMeaning: mapping.fieldMeaning.trim(),
          matchedProfilePath: mapping.matchedProfilePath.trim(),
          value: mapping.value.trim(),
        }))
    : [];

  return { mappings };
}

export function validateVisualRegionMappings(
  mappings: VisualRegionFillMappingResult['mappings'],
  payload: VisualRegionFillPayload,
  profile: UserProfile,
): VisualRegionFillMappingResult['mappings'] {
  const controls = new Map<string, VisualRegionControlCandidate>(
    payload.controls.map(control => [control.controlId, control]),
  );

  return mappings.filter((mapping): mapping is VisualRegionFillMapping => {
    const control = controls.get(mapping.controlId);
    if (!control) return false;
    if (!mapping.value.trim()) return false;

    const profileValue = getProfileValue(profile, mapping.matchedProfilePath);
    if (typeof profileValue !== 'string' || !valueDerivesFromProfile(profileValue, mapping.value)) return false;

    return control.options.length === 0 || control.options.some(option => valuesEquivalent(option, mapping.value));
  });
}

function valueDerivesFromProfile(source: string, target: string): boolean {
  if (source.trim() === target.trim()) return true;
  const match = source.match(/((?:19|20)\d{2})(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?/);
  if (!match) return false;
  const candidates = new Set<string>([match[1]]);
  if (match[2]) {
    const month = String(Number(match[2]));
    candidates.add(month);
    candidates.add(month.padStart(2, '0'));
    candidates.add(`${month}月`);
    candidates.add(`${month.padStart(2, '0')}月`);
  }
  if (match[3]) {
    const day = String(Number(match[3]));
    candidates.add(day);
    candidates.add(day.padStart(2, '0'));
    candidates.add(`${day}日`);
    candidates.add(`${day.padStart(2, '0')}日`);
  }
  return candidates.has(target.trim());
}

function valuesEquivalent(left: string, right: string): boolean {
  const normalize = (value: string) => value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^0+(?=\d)/, '')
    .replace(/[年月日号\s._/-]/g, '');
  return normalize(left) === normalize(right);
}

function getProfileValue(profile: UserProfile, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (current === null || current === undefined) return undefined;
      const key = /^\d+$/.test(segment) ? Number(segment) : segment;
      return (current as Record<string, unknown> | unknown[])[key as never];
    }, profile);
}

function isVisualRegionFillMapping(value: unknown): value is VisualRegionFillMapping {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.controlId === 'string'
    && typeof candidate.fieldMeaning === 'string'
    && typeof candidate.matchedProfilePath === 'string'
    && typeof candidate.value === 'string'
  );
}
