import React, { createContext, useContext, useState } from 'react';
import type { FieldAliasOverrides } from '../shared/types.ts';
import { aliasesFromText, aliasesToText } from '../shared/profileCustomFields.ts';
import { PROFILE_FIELD_REGISTRY } from '../shared/profileFieldRegistry.ts';
import { normalizeFieldText } from '../utils/fieldText.ts';

// 字段别名编辑器（方案 §8.3 / §12.14）：
// - 系统别名只读展示，第一版不允许删除；
// - "我的别名"按稳定 profileKey 保存到 profile.fieldAliasOverrides，不改变字段值；
// - 敏感字段仅本地匹配的语义不受影响（🔒 继续由字段自身标记表达）。

interface AliasOverridesContextValue {
  overrides: FieldAliasOverrides;
  update: (key: string, added: string[]) => void;
}

export const FieldAliasOverridesContext = createContext<AliasOverridesContextValue | null>(null);

const REGISTRY_ALIASES = new Map(PROFILE_FIELD_REGISTRY.map(def => [def.key, def.aliases]));

export function systemAliasesForKey(key: string): string[] {
  return REGISTRY_ALIASES.get(key) || [];
}

interface FieldAliasEditorProps {
  profileKey: string;
  /** 缺省时按注册表 key 取系统别名；预设字段请传入字段自身的别名。 */
  systemAliases?: string[];
}

export function FieldAliasEditor({ profileKey, systemAliases }: FieldAliasEditorProps): React.ReactElement | null {
  const context = useContext(FieldAliasOverridesContext);
  const [open, setOpen] = useState(false);

  if (!context) return null;
  const system = systemAliases ?? systemAliasesForKey(profileKey);
  const added = context.overrides[profileKey]?.added || [];

  const warnings: string[] = (() => {
    const messages: string[] = [];
    const normalize = (value: string) => normalizeFieldText(value);
    const systemSet = new Set(system.map(normalize));
    const duplicatedSystem = added.filter(alias => systemSet.has(normalize(alias)));
    if (duplicatedSystem.length > 0) {
      messages.push(`与系统别名重复（可删除）：${duplicatedSystem.join('、')}`);
    }
    const seen = new Set<string>();
    const duplicatedUser: string[] = [];
    for (const alias of added) {
      const normalized = normalize(alias);
      if (seen.has(normalized)) duplicatedUser.push(alias);
      else seen.add(normalized);
    }
    if (duplicatedUser.length > 0) {
      messages.push(`我的别名内部重复：${duplicatedUser.join('、')}`);
    }
    const hasCrossKeyConflict = Object.entries(context.overrides)
      .some(([key, entry]) => key !== profileKey
        && (entry?.added || []).some(alias => added.some(item => normalize(item) === normalize(alias))));
    if (hasCrossKeyConflict) {
      messages.push('该别名同时配置给了其它字段；网页标题同时命中时会跳过，不会乱填。');
    }
    return messages;
  })();

  return (
    <span className="alias-editor" data-profile-key={profileKey}>
      <button
        type="button"
        className={added.length > 0 ? 'alias-toggle has-alias' : 'alias-toggle'}
        title="编辑匹配别名"
        aria-expanded={open}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(current => !current);
        }}
      >
        别名{added.length > 0 ? ` ${added.length}` : ''}
      </button>
      {open && (
        <span
          className="alias-panel"
          role="group"
          aria-label={`字段别名：${profileKey}`}
          onClick={event => {
            // 面板嵌在 label 内：阻止 label 的默认聚焦行为，避免点击别名面板时焦点跳到字段输入框。
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="alias-system">
            <b>系统别名</b>
            <span>{system.length > 0 ? aliasesToText(system) : '无'}</span>
          </div>
          <label className="alias-user">
            <b>我的别名</b>
            <AliasTextInput
              value={added}
              placeholder="用顿号分隔多个别名，如 出生国家、证件国家"
              onCommit={aliases => context.update(profileKey, aliases)}
            />
          </label>
          {warnings.map(warning => <div className="alias-warn" key={warning}>{warning}</div>)}
        </span>
      )}
    </span>
  );
}

/**
 * 别名文本输入：自由编辑草稿，失焦/回车时才解析保存。
 * 之前"每次按键立即解析"会吞掉刚输入的顿号（末尾分隔符被清掉），
 * 用户只能被迫用斜杠连接，导致整条别名匹配不上——这是实际发生过的 bug。
 */
export function AliasTextInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string[];
  onCommit: (aliases: string[]) => void;
  placeholder?: string;
}): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      value={draft ?? aliasesToText(value)}
      placeholder={placeholder}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        }
      }}
      onBlur={() => {
        if (draft === null) return;
        const parsed = aliasesFromText(draft);
        setDraft(null);
        onCommit(parsed);
      }}
    />
  );
}

/** 核心字段标签 + 别名入口的紧凑组合。 */
export function CoreFieldLabel({
  profileKey,
  text,
  required,
  systemAliases,
}: {
  profileKey: string;
  text: string;
  required?: boolean;
  systemAliases?: string[];
}): React.ReactElement {
  return (
    <span className="core-field-label">
      <span className="core-field-title">{text}{required ? ' *' : ''}</span>
      <FieldAliasEditor profileKey={profileKey} systemAliases={systemAliases} />
    </span>
  );
}
