// 永久禁止自动填写的字段规则表（方案 §6 第 1 层 / §21.14）。
// 该表先于用户别名和一切普通规则生效：只要命中，无论控件是否为空、
// 无论用户是否配置了同名别名，都绝不写入。

export interface BlockedFieldEvidence {
  name?: string;
  id?: string;
  placeholder?: string;
  labelText?: string;
  autocomplete?: string;
  type?: string;
}

export interface BlockedFieldMatch {
  category: string;
  label: string;
}

interface BlockedCategory {
  category: string;
  label: string;
  /** 中文关键词：在规范化后的可见文字/标识符中做包含匹配。关键词必须足够特异，避免误伤。 */
  zhKeywords: string[];
  /** 英文复合标识符：按词元切分后，任意连续词元窗口拼接等于该项才命中。 */
  compounds: string[];
  /** 英文单词级命中：任一词元完整等于该项即命中（如 password / captcha / otp）。 */
  singleTokens: string[];
}

const BLOCKED_CATEGORIES: BlockedCategory[] = [
  {
    category: 'referral-code',
    label: '内推码/内推编号',
    zhKeywords: ['内推码', '内推编码', '内部推荐码', '员工内推码', '内推员工编号', '内推编号', '推荐人编号'],
    compounds: ['referralcode', 'employeereferralcode'],
    singleTokens: [],
  },
  {
    category: 'recommendation-code',
    label: '推荐码/推荐编码',
    zhKeywords: ['推荐码', '推荐编码', '推荐编号'],
    compounds: ['recommendcode', 'recommendationcode'],
    singleTokens: [],
  },
  {
    category: 'invitation-code',
    label: '邀请码',
    zhKeywords: ['邀请码', '邀请编号'],
    compounds: ['invitecode', 'invitationcode'],
    singleTokens: [],
  },
  {
    category: 'verification-code',
    label: '验证码',
    zhKeywords: ['验证码', '校验码', '动态码', '动态口令'],
    compounds: ['verifycode', 'verificationcode', 'captcha'],
    singleTokens: ['captcha', 'otp'],
  },
  {
    category: 'password',
    label: '密码',
    zhKeywords: ['密码'],
    compounds: ['confirmpassword', 'newpassword', 'loginpassword', 'passwordconfirm'],
    singleTokens: ['password'],
  },
  {
    category: 'system-number',
    label: '系统编号',
    zhKeywords: ['申请编号', '系统流水号', '候选人编号'],
    compounds: ['applicationid', 'systemid', 'applicationnumber'],
    singleTokens: [],
  },
];

/** 展示噪声归一化：全角/空格/标点剔除，保留中英文语义。 */
function normalizeZhText(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 英文标识符拆词：camelCase / snake_case / kebab-case / 空格统一切分。 */
function splitIdentifierTokens(value: string): string[] {
  return (value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(token => token.toLowerCase());
}

function matchEnglish(evidence: string[], category: BlockedCategory): boolean {
  for (const text of evidence) {
    const tokens = splitIdentifierTokens(text);
    if (tokens.length === 0) continue;

    if (category.singleTokens.some(token => tokens.includes(token))) return true;

    // 连续词元窗口拼接：referralCode → [referral, code] → "referralcode" 命中；
    // subsystemId → [subsystem, id] → 无窗口等于 "systemid"，不会误伤。
    for (let start = 0; start < tokens.length; start++) {
      let joined = '';
      for (let end = start; end < tokens.length; end++) {
        joined += tokens[end];
        if (category.compounds.includes(joined)) return true;
      }
    }
  }
  return false;
}

function matchChinese(evidence: string[], category: BlockedCategory): boolean {
  const normalized = evidence.map(normalizeZhText).filter(Boolean);
  return normalized.some(text => category.zhKeywords.some(keyword => text.includes(keyword)));
}

/**
 * 判断一个网页控件是否属于永久禁止自动填写的字段。
 * 证据范围严格按方案 §21.14：中文标题/占位符 + name/id 内部标识符。
 * 不使用 autocomplete：部分站点会给所有输入框塞统一的 autocomplete 值，
 * 曾导致整表字段被误判为密码框（禁止字段 19 项事故）。
 * 推荐人姓名、推荐人电话等不在本表内——没有对应资料时应返回 unmatched，而不是填本人信息。
 */
export function matchBlockedField(evidence: BlockedFieldEvidence): BlockedFieldMatch | null {
  const inputType = (evidence.type || '').toLowerCase();
  if (inputType === 'password') {
    return { category: 'password', label: '密码输入框' };
  }

  const zhSources = [evidence.labelText, evidence.placeholder, evidence.name, evidence.id]
    .filter((value): value is string => Boolean(value));
  const enSources = [evidence.labelText, evidence.placeholder, evidence.name, evidence.id]
    .filter((value): value is string => Boolean(value));

  for (const category of BLOCKED_CATEGORIES) {
    if (matchChinese(zhSources, category) || matchEnglish(enSources, category)) {
      return { category: category.category, label: category.label };
    }
  }
  return null;
}
