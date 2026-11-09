// 字段文字规范化与英文词元拆分（方案 §5.2）。
// 所有匹配比较必须经过这里，禁止把多来源文字拼接后直接裸 includes。

const UI_NOISE = /必填|选填|必填项|required|optional/gi;

/** 展示噪声归一化：NFKC、小写、去 UI 噪声、去空白/标点/符号。保留中英文语义。 */
export function normalizeFieldText(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(UI_NOISE, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 英文标识符拆词：camelCase / snake_case / kebab-case / 空格统一切分为小写词元。 */
export function splitIdentifierTokens(value: string): string[] {
  return (value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(token => token.toLowerCase());
}

/** 可见标题是否规范化相等。 */
export function labelEquals(left: string, right: string): boolean {
  const a = normalizeFieldText(left);
  const b = normalizeFieldText(right);
  return a.length > 0 && a === b;
}

/** 中文包含判断：关键词必须至少 2 个字符，避免单字误伤。 */
export function labelContains(haystack: string, needle: string): boolean {
  const h = normalizeFieldText(haystack);
  const n = normalizeFieldText(needle);
  if (n.length < 2) return false;
  return h.includes(n);
}

/** 任意关键词命中。 */
export function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => labelContains(text, keyword));
}

/** 全部关键词命中。 */
export function containsAll(text: string, keywords: string[]): boolean {
  return keywords.every(keyword => labelContains(text, keyword));
}

/**
 * 英文复合标识符匹配：
 * - 多词目标（schoolname / referralcode）：任意连续词元窗口拼接命中；
 * - 多词标识符中的单词元目标：只认首段（nationalityName → nationality），
 *   末段复合词不得抢占（englishName 绝不命中 name，方案 §7.1/§7.4）；
 * - 单词元标识符（id 就是 "gpa"）：仅当 options.singleTokens 显式允许。
 */
export function matchesIdentifier(
  identifier: string,
  targets: string[],
  options: { singleTokens?: boolean } = {},
): string | null {
  const tokens = splitIdentifierTokens(identifier);
  if (tokens.length === 0) return null;

  for (let start = 0; start < tokens.length; start++) {
    let joined = '';
    for (let end = start; end < tokens.length; end++) {
      joined += tokens[end];
      if (!targets.includes(joined)) continue;

      const windowLength = end - start + 1;
      if (windowLength === tokens.length && tokens.length === 1) {
        // 整个标识符就是这一个词元：必须显式允许（裸 name/id/code 永远不命中）。
        return options.singleTokens ? joined : null;
      }
      if (windowLength === 1 && start !== 0) {
        // 非首段的单词元（englishName 的 name 段）不允许单独命中。
        continue;
      }
      return joined;
    }
  }
  return null;
}
