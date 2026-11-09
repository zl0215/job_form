// 离线字段匹配诊断 harness（tsx 运行）。
//
// 目标：用真实字段目录（diagnostics/coverage/field-catalog.json，来自旧工具
// profile.json 的 mappings/pages，只含字段元数据）构造 FieldEvidence，走
// buildProfileAnswerCandidates + matchField 的完整匹配链，按站点统计
// matched / blocked / ambiguous / unmatched，并输出改前/改后对比报告。
//
// 边界（AGENTS.md）：这是后端/离线映射诊断，不是真实页 DOM 提取，也不是
// 已部署扩展的端到端验收。候选资料是占位 UserProfile（固定占位值，绝不读取
// 或打印用户真实答案）。字段标签允许出现，个人答案值不允许出现。
//
// 用法（在 extension-src/ 下执行，保证能解析 tsx）：
//   npx tsx ../diagnostics/coverage/match-diagnostic.ts record baseline
//   npx tsx ../diagnostics/coverage/match-diagnostic.ts record after
//   npx tsx ../diagnostics/coverage/match-diagnostic.ts compare baseline after
//
// 输出（diagnostics/coverage/）：
//   coverage-<tag>.json / coverage-<tag>.md / coverage-comparison-<a>-<b>.md

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { matchField, type FieldEvidence, type FieldMatchResult } from '../../extension-src/src/utils/fieldMatcher.ts';
import { buildProfileAnswerCandidates, type ProfileAnswerCandidate } from '../../extension-src/src/shared/profileAnswerCandidates.ts';
import { buildPlaceholderProfile, countPlaceholderFields } from './placeholderProfile.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CATALOG_PATH = path.join(HERE, 'field-catalog.json');

const RULE_FILES = [
  'extension-src/src/shared/profileFieldRegistry.ts',
  'extension-src/src/shared/blockedFields.ts',
  'extension-src/src/shared/profilePresets.ts',
  'extension-src/src/utils/fieldMatcher.ts',
  'extension-src/src/utils/fieldText.ts',
  'extension-src/src/shared/profileAnswerCandidates.ts',
];

interface CatalogEntry {
  id: string;
  signature?: string;
  domain: string;
  label: string;
  section: string;
  moduleTitle: string;
  type: string;
  required: boolean;
  /** 旧目录原始选项文本可能含用户已选答案，字段目录只保留数量（不参与匹配）。 */
  optionsCount?: number;
  sensitive: boolean;
  duplicateLabel: boolean;
  slot: number | null;
  scopePolicy: string;
  status: string;
  seenCount: number;
  canonicalKey: string | null;
  oldMethod?: string | null;
  pageValuePresent?: boolean | null;
  pageUrl?: string | null;
  sources: string[];
}

interface EntryResult {
  id: string;
  domain: string;
  label: string;
  section: string;
  type: string;
  required: boolean;
  seenCount: number;
  canonicalKey: string | null;
  oldStatus: string;
  labelLength: number;
  shortLabel: boolean;
  status: 'matched' | 'blocked' | 'ambiguous' | 'unmatched';
  fillable: boolean;
  profileKey: string | null;
  candidateId: string | null;
  coreFieldType: string | null;
  reason: string;
  candidates: string[] | null;
}

interface GroupStats {
  total: number;
  matched: number;
  matchedNoValue: number;
  blocked: number;
  ambiguous: number;
  unmatched: number;
  matchedRate: number;
  oldReadyTotal: number;
  oldReadyMissed: number;
}

interface CoverageReport {
  tag: string;
  generatedAt: string;
  kind: 'offline-matching-diagnostic';
  boundary: string;
  ruleFingerprint: Record<string, string>;
  placeholder: {
    note: string;
    candidateCount: number;
    customFieldCount: number;
  };
  catalog: {
    path: string;
    generatedAt: string;
    profileSha256: string;
    profileUpdatedAt: string;
    total: number;
    shortLabelTotal: number;
    targetDomains: string[];
    sources: Record<string, number>;
  };
  totals: GroupStats & { shortLabel: GroupStats };
  byDomain: Record<string, GroupStats & { shortLabel: GroupStats }>;
  byOldStatus: Record<string, GroupStats>;
  matchedByKey: Record<string, number>;
  entries: EntryResult[];
}

function sha256File(relativePath: string): string {
  const full = path.join(REPO_ROOT, relativePath);
  try {
    return createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 16);
  } catch {
    return 'missing';
  }
}

function ruleFingerprint(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const relative of RULE_FILES) result[relative] = sha256File(relative);
  return result;
}

function loadCatalog(): { entries: CatalogEntry[]; meta: Record<string, unknown>; targetDomains: string[] } {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`字段目录不存在：${CATALOG_PATH}\n先运行：python diagnostics/coverage/extract_field_catalog.py`);
  }
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as {
    meta: Record<string, unknown>;
    targetDomains?: string[];
    entries: CatalogEntry[];
  };
  return { entries: raw.entries, meta: raw.meta, targetDomains: raw.targetDomains || [] };
}

function controlKindOf(type: string): FieldEvidence['controlKind'] {
  switch (type) {
    case 'long_text':
      return 'textarea';
    case 'combobox':
    case 'select':
    case 'picker':
      return 'custom-select';
    case 'radio':
    case 'custom_radio':
      return 'radio';
    case 'checkbox':
    case 'custom_checkbox':
      return 'checkbox';
    case 'date':
    case 'month':
      return 'date';
    case 'text':
      return 'input';
    default:
      return 'other';
  }
}

/** 用目录里的字段元数据构造结构化证据（无 name/id/placeholder 时为纯标签+模块证据）。 */
function evidenceOf(entry: CatalogEntry): FieldEvidence {
  return {
    visibleLabel: entry.label,
    placeholder: '',
    name: '',
    id: '',
    autocomplete: '',
    moduleContext: entry.moduleTitle || entry.section || '',
    rowContext: '',
    inputType: entry.type === 'text' ? 'text' : '',
    controlKind: controlKindOf(entry.type),
  };
}

function charLength(text: string): number {
  return Array.from(text || '').length;
}

/** 与 formDetector 相同的可填值判定：候选 id / coreFieldType / 同 key 有值候选。 */
function isFillable(result: FieldMatchResult, candidates: ProfileAnswerCandidate[]): boolean {
  if (result.status !== 'matched') return false;
  if (result.coreFieldType) return true;
  if (result.candidateId && candidates.some(candidate => candidate.id === result.candidateId)) return true;
  if (result.profileKey && candidates.some(candidate => candidate.key === result.profileKey && candidate.value.trim())) return true;
  return false;
}

function emptyStats(): GroupStats {
  return {
    total: 0,
    matched: 0,
    matchedNoValue: 0,
    blocked: 0,
    ambiguous: 0,
    unmatched: 0,
    matchedRate: 0,
    oldReadyTotal: 0,
    oldReadyMissed: 0,
  };
}

function finalize(stats: GroupStats): GroupStats {
  stats.matchedRate = stats.total > 0 ? stats.matched / stats.total : 0;
  return stats;
}

function accumulate(stats: GroupStats, result: EntryResult): void {
  stats.total += 1;
  if (result.oldStatus === 'ready') stats.oldReadyTotal += 1;
  switch (result.status) {
    case 'matched':
      if (result.fillable) stats.matched += 1;
      else stats.matchedNoValue += 1;
      break;
    case 'blocked':
      stats.blocked += 1;
      break;
    case 'ambiguous':
      stats.ambiguous += 1;
      break;
    default:
      stats.unmatched += 1;
  }
  if (result.oldStatus === 'ready' && result.status !== 'matched' && result.status !== 'blocked') {
    stats.oldReadyMissed += 1;
  }
}

function runDiagnostic(tag: string): CoverageReport {
  const { entries, meta, targetDomains } = loadCatalog();
  const profile = buildPlaceholderProfile();
  const candidates = buildProfileAnswerCandidates(profile);

  const results: EntryResult[] = [];
  const totals = emptyStats();
  const shortTotals = emptyStats();
  const byDomain: Record<string, GroupStats & { shortLabel: GroupStats }> = {};
  const byOldStatus: Record<string, GroupStats> = {};
  const matchedByKey: Record<string, number> = {};
  const sources: Record<string, number> = {};

  for (const entry of entries) {
    const result = matchField(evidenceOf(entry), { candidates });
    const labelLength = charLength(entry.label);
    const shortLabel = labelLength > 0 && labelLength <= 30;
    const sourceKey = entry.sources.join('+');
    sources[sourceKey] = (sources[sourceKey] || 0) + 1;
    const status: EntryResult['status'] = result.status;
    const entryResult: EntryResult = {
      id: entry.id,
      domain: entry.domain,
      label: entry.label,
      section: entry.section || entry.moduleTitle || '',
      type: entry.type || '',
      required: Boolean(entry.required),
      seenCount: entry.seenCount || 0,
      canonicalKey: entry.canonicalKey || null,
      oldStatus: entry.status || '',
      labelLength,
      shortLabel,
      status,
      fillable: isFillable(result, candidates),
      profileKey: result.profileKey || null,
      candidateId: result.candidateId || null,
      coreFieldType: result.coreFieldType || null,
      reason: result.reason,
      candidates: result.candidates || null,
    };
    results.push(entryResult);
    accumulate(totals, entryResult);
    if (shortLabel) accumulate(shortTotals, entryResult);

    const domainBucket = (byDomain[entry.domain] = byDomain[entry.domain] || {
      ...emptyStats(),
      shortLabel: emptyStats(),
    });
    accumulate(domainBucket, entryResult);
    if (shortLabel) accumulate(domainBucket.shortLabel, entryResult);

    const statusBucket = (byOldStatus[entry.status || '-'] = byOldStatus[entry.status || '-'] || emptyStats());
    accumulate(statusBucket, entryResult);

    if (entryResult.status === 'matched' && entryResult.fillable) {
      const key = entryResult.profileKey || entryResult.candidateId || 'unknown';
      matchedByKey[key] = (matchedByKey[key] || 0) + 1;
    }
  }

  finalize(totals);
  finalize(shortTotals);
  for (const bucket of Object.values(byDomain)) {
    finalize(bucket);
    finalize(bucket.shortLabel);
  }
  for (const bucket of Object.values(byOldStatus)) finalize(bucket);

  const sortedByDomain: Record<string, GroupStats & { shortLabel: GroupStats }> = {};
  for (const domain of Object.keys(byDomain).sort()) sortedByDomain[domain] = byDomain[domain];

  return {
    tag,
    generatedAt: new Date().toISOString(),
    kind: 'offline-matching-diagnostic',
    boundary:
      '离线映射诊断：字段证据来自旧工具目录的 label/section/type 元数据（无 name/id/placeholder），' +
      '候选资料为固定占位 UserProfile；不是真实页 DOM 提取，不是已部署扩展的端到端验收。',
    ruleFingerprint: ruleFingerprint(),
    placeholder: {
      note: '占位资料：所有注册表/预设/模块字段填固定占位值（每个候选唯一），不读取真实资料。',
      candidateCount: candidates.length,
      customFieldCount: countPlaceholderFields(profile),
    },
    catalog: {
      path: CATALOG_PATH,
      generatedAt: String(meta.generatedAt || ''),
      profileSha256: String(meta.profileSha256 || ''),
      profileUpdatedAt: String(meta.updatedAt || ''),
      total: entries.length,
      shortLabelTotal: results.filter(result => result.shortLabel).length,
      targetDomains,
      sources,
    },
    totals: { ...totals, shortLabel: shortTotals },
    byDomain: sortedByDomain,
    byOldStatus,
    matchedByKey,
    entries: results,
  };
}

// —— Markdown 报告 ——

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function statsRow(name: string, stats: GroupStats): string {
  return `| ${name} | ${stats.total} | ${stats.matched} | ${pct(stats.matchedRate)} | ${stats.blocked} | ${stats.ambiguous} | ${stats.unmatched} | ${stats.matchedNoValue} | ${stats.oldReadyTotal} | ${stats.oldReadyMissed} |`;
}

function shortLabel(entry: EntryResult): boolean {
  return entry.shortLabel;
}

function renderReport(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(`# 真实网申字段离线匹配覆盖率报告（${report.tag}）`);
  lines.push('');
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push(`- 类型：${report.kind}（**${report.boundary}**）`);
  lines.push(`- 字段目录：\`${report.catalog.path}\`（${report.catalog.total} 条；其中 ≤30 字短标签 ${report.catalog.shortLabelTotal} 条）`);
  lines.push(`- 目录来源 profile.json updatedAt：${report.catalog.profileUpdatedAt}；SHA-256：\`${report.catalog.profileSha256.slice(0, 16)}…\``);
  lines.push(`- 占位候选：${report.placeholder.candidateCount} 个（自定义字段 ${report.placeholder.customFieldCount} 个；${report.placeholder.note}）`);
  lines.push('- 规则指纹（sha256 前 16 位）：');
  for (const [file, hash] of Object.entries(report.ruleFingerprint)) {
    lines.push(`  - \`${file}\` → \`${hash}\``);
  }
  lines.push('');
  lines.push('> 本报告只有字段标签与计数，不包含任何个人答案值。覆盖率 = matched / 字段总数；');
  lines.push('> blocked 表示按安全规则永久禁止填写（不算缺口）；ambiguous 表示规则冲突；');
  lines.push('> unmatched 表示规则缺口。旧工具 ready 但新引擎未命中（oldReadyMissed）是最高优先级回归。');
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| 分组 | 字段数 | matched | 覆盖率 | blocked | ambiguous | unmatched | 命中但无值 | 旧ready总数 | 旧ready未命中 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  lines.push(statsRow('全部字段', report.totals));
  lines.push(statsRow('短标签(≤30字)', report.totals.shortLabel));
  lines.push('');
  lines.push('## 按站点');
  lines.push('');
  lines.push('| 站点 | 字段数 | matched | 覆盖率 | blocked | ambiguous | unmatched | 命中但无值 | 旧ready总数 | 旧ready未命中 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [domain, stats] of Object.entries(report.byDomain)) {
    lines.push(statsRow(domain, stats));
  }
  lines.push('');
  lines.push('## 按旧工具状态');
  lines.push('');
  lines.push('| 旧状态 | 字段数 | matched | 覆盖率 | blocked | ambiguous | unmatched | 命中但无值 | 旧ready总数 | 旧ready未命中 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [status, stats] of Object.entries(report.byOldStatus)) {
    lines.push(statsRow(status, stats));
  }
  lines.push('');
  lines.push('## 命中分布（按资料 key）');
  lines.push('');
  lines.push('| 资料 key | 命中字段数 |');
  lines.push('| --- | --- |');
  for (const [key, count] of Object.entries(report.matchedByKey).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${key} | ${count} |`);
  }
  lines.push('');

  const unmatchedShort = report.entries.filter(entry => entry.status === 'unmatched' && shortLabel(entry));
  lines.push(`## 未命中字段清单（短标签，共 ${unmatchedShort.length} 条；按站点分组）`);
  lines.push('');
  const domains = Object.keys(report.byDomain);
  for (const domain of domains) {
    const items = unmatchedShort.filter(entry => entry.domain === domain);
    if (items.length === 0) continue;
    lines.push(`### ${domain}（${items.length}）`);
    lines.push('');
    for (const entry of items) {
      const canonical = entry.canonicalKey ? ` canon=${entry.canonicalKey}` : '';
      lines.push(`- \`${entry.label}\` | section=${entry.section || '-'} | type=${entry.type || '-'} | required=${entry.required} | seen=${entry.seenCount} | old=${entry.oldStatus || '-'}${canonical}`);
    }
    lines.push('');
  }

  const ambiguous = report.entries.filter(entry => entry.status === 'ambiguous');
  lines.push(`## 冲突字段（ambiguous，共 ${ambiguous.length} 条）`);
  lines.push('');
  for (const entry of ambiguous) {
    lines.push(`- ${entry.domain} \`${entry.label}\` | section=${entry.section || '-'} | type=${entry.type || '-'} | 候选=${(entry.candidates || []).join('、')} | ${entry.reason}`);
  }
  lines.push('');

  const oldReadyMisses = report.entries.filter(
    entry => entry.oldStatus === 'ready' && entry.status !== 'matched' && entry.status !== 'blocked',
  );
  lines.push(`## 旧工具 ready 但新引擎未命中（回归，共 ${oldReadyMisses.length} 条）`);
  lines.push('');
  for (const entry of oldReadyMisses) {
    const canonical = entry.canonicalKey ? ` canon=${entry.canonicalKey}` : '';
    lines.push(`- ${entry.domain} \`${entry.label}\` | section=${entry.section || '-'} | type=${entry.type || '-'} | 新状态=${entry.status}${canonical}`);
  }
  lines.push('');

  const blocked = report.entries.filter(entry => entry.status === 'blocked');
  lines.push(`## 安全禁止字段（blocked，共 ${blocked.length} 条；这些必须保持禁止）`);
  lines.push('');
  for (const entry of blocked) {
    lines.push(`- ${entry.domain} \`${entry.label}\` | section=${entry.section || '-'} | ${entry.reason}`);
  }
  lines.push('');
  return lines.join('\n');
}

function writeReport(report: CoverageReport): void {
  const jsonPath = path.join(HERE, `coverage-${report.tag}.json`);
  const mdPath = path.join(HERE, `coverage-${report.tag}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 1) + '\n', 'utf-8');
  fs.writeFileSync(mdPath, renderReport(report) + '\n', 'utf-8');
  console.log(`[diagnostic] tag=${report.tag} entries=${report.catalog.total} matched=${report.totals.matched} (${pct(report.totals.matchedRate)}) blocked=${report.totals.blocked} ambiguous=${report.totals.ambiguous} unmatched=${report.totals.unmatched}`);
  console.log(`[diagnostic] wrote ${jsonPath}`);
  console.log(`[diagnostic] wrote ${mdPath}`);
}

// —— 改前/改后对比 ——

function renderComparison(before: CoverageReport, after: CoverageReport): string {
  const lines: string[] = [];
  const rateDelta = after.totals.matchedRate - before.totals.matchedRate;
  const countDelta = after.totals.matched - before.totals.matched;
  lines.push(`# 匹配覆盖率对比：${before.tag} → ${after.tag}`);
  lines.push('');
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 类型：${after.kind}（**${after.boundary}**）`);
  lines.push(`- 字段目录：\`${after.catalog.path}\`（${after.catalog.total} 条）`);
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| 指标 | 改前 | 改后 | 变化 |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(`| matched | ${before.totals.matched} | ${after.totals.matched} | ${countDelta >= 0 ? '+' : ''}${countDelta} |`);
  lines.push(`| 覆盖率 | ${pct(before.totals.matchedRate)} | ${pct(after.totals.matchedRate)} | ${rateDelta >= 0 ? '+' : ''}${(rateDelta * 100).toFixed(1)}pp |`);
  lines.push(`| blocked | ${before.totals.blocked} | ${after.totals.blocked} | ${after.totals.blocked - before.totals.blocked} |`);
  lines.push(`| ambiguous | ${before.totals.ambiguous} | ${after.totals.ambiguous} | ${after.totals.ambiguous - before.totals.ambiguous} |`);
  lines.push(`| unmatched | ${before.totals.unmatched} | ${after.totals.unmatched} | ${after.totals.unmatched - before.totals.unmatched} |`);
  lines.push(`| 旧ready未命中 | ${before.totals.oldReadyMissed} | ${after.totals.oldReadyMissed} | ${after.totals.oldReadyMissed - before.totals.oldReadyMissed} |`);
  lines.push('');
  lines.push('## 按站点');
  lines.push('');
  lines.push('| 站点 | 字段数 | 改前 matched | 改前覆盖 | 改后 matched | 改后覆盖 | 变化(pp) |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  const domains = Array.from(new Set([...Object.keys(before.byDomain), ...Object.keys(after.byDomain)])).sort();
  for (const domain of domains) {
    const a = before.byDomain[domain];
    const b = after.byDomain[domain];
    if (!a || !b) continue;
    const delta = (b.matchedRate - a.matchedRate) * 100;
    lines.push(`| ${domain} | ${b.total} | ${a.matched} | ${pct(a.matchedRate)} | ${b.matched} | ${pct(b.matchedRate)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} |`);
  }
  lines.push('');

  const beforeById = new Map(before.entries.map(entry => [entry.id, entry]));
  const afterById = new Map(after.entries.map(entry => [entry.id, entry]));
  const newlyMatched: EntryResult[] = [];
  const regressions: EntryResult[] = [];
  const newlyAmbiguous: EntryResult[] = [];
  const newlyBlocked: EntryResult[] = [];
  for (const [id, afterEntry] of afterById) {
    const beforeEntry = beforeById.get(id);
    if (!beforeEntry) continue;
    if (beforeEntry.status !== 'matched' && afterEntry.status === 'matched') newlyMatched.push(afterEntry);
    if (beforeEntry.status === 'matched' && afterEntry.status !== 'matched') regressions.push(afterEntry);
    if (beforeEntry.status !== 'ambiguous' && afterEntry.status === 'ambiguous') newlyAmbiguous.push(afterEntry);
    if (beforeEntry.status !== 'blocked' && afterEntry.status === 'blocked') newlyBlocked.push(afterEntry);
  }

  lines.push(`## 新命中字段（${newlyMatched.length} 条）`);
  lines.push('');
  for (const entry of newlyMatched.sort((a, b) => a.domain.localeCompare(b.domain) || a.label.localeCompare(b.label))) {
    lines.push(`- ${entry.domain} \`${entry.label}\` | section=${entry.section || '-'} | type=${entry.type || '-'} | → key=${entry.profileKey || entry.candidateId || '-'} | old=${entry.oldStatus || '-'}`);
  }
  lines.push('');
  lines.push(`## 回归（改前命中、改后未命中，${regressions.length} 条；应为 0）`);
  lines.push('');
  for (const entry of regressions) {
    lines.push(`- ${entry.domain} \`${entry.label}\` | section=${entry.section || '-'} | 改后状态=${entry.status} | ${entry.reason}`);
  }
  lines.push('');
  lines.push(`## 新增冲突（${newlyAmbiguous.length} 条；应尽量为 0，冲突必须人工复核）`);
  lines.push('');
  for (const entry of newlyAmbiguous) {
    lines.push(`- ${entry.domain} \`${entry.label}\` | candidates=${(entry.candidates || []).join('、')} | ${entry.reason}`);
  }
  lines.push('');
  lines.push(`## 新增禁止（${newlyBlocked.length} 条；安全策略收紧，人工确认合理）`);
  lines.push('');
  for (const entry of newlyBlocked) {
    lines.push(`- ${entry.domain} \`${entry.label}\` | ${entry.reason}`);
  }
  lines.push('');
  lines.push('## 规则指纹变化');
  lines.push('');
  lines.push('| 文件 | 改前 | 改后 |');
  lines.push('| --- | --- | --- |');
  for (const file of Object.keys(after.ruleFingerprint)) {
    const a = before.ruleFingerprint[file] || '-';
    const b = after.ruleFingerprint[file] || '-';
    lines.push(`| \`${file}\` | \`${a}\` | \`${b}\` |`);
  }
  lines.push('');
  return lines.join('\n');
}

function compare(beforeTag: string, afterTag: string): void {
  const beforePath = path.join(HERE, `coverage-${beforeTag}.json`);
  const afterPath = path.join(HERE, `coverage-${afterTag}.json`);
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) {
    throw new Error(`缺少报告：${beforePath} 或 ${afterPath}。先分别运行 record。`);
  }
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf-8')) as CoverageReport;
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf-8')) as CoverageReport;
  const outputPath = path.join(HERE, `coverage-comparison-${beforeTag}-${afterTag}.md`);
  fs.writeFileSync(outputPath, renderComparison(before, after) + '\n', 'utf-8');
  const delta = after.totals.matched - before.totals.matched;
  console.log(`[compare] ${beforeTag} → ${afterTag}: matched ${before.totals.matched} → ${after.totals.matched} (${delta >= 0 ? '+' : ''}${delta}), rate ${pct(before.totals.matchedRate)} → ${pct(after.totals.matchedRate)}`);
  console.log(`[compare] wrote ${outputPath}`);
}

function main(): void {
  const [mode, argA, argB] = process.argv.slice(2);
  if (mode === 'record') {
    const tag = argA || 'current';
    writeReport(runDiagnostic(tag));
    return;
  }
  if (mode === 'compare') {
    if (!argA || !argB) throw new Error('用法：compare <beforeTag> <afterTag>');
    compare(argA, argB);
    return;
  }
  throw new Error(
    '用法：\n  npx tsx ../diagnostics/coverage/match-diagnostic.ts record <tag>\n  npx tsx ../diagnostics/coverage/match-diagnostic.ts compare <beforeTag> <afterTag>',
  );
}

main();
