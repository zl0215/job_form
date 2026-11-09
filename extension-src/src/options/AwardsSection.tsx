import React, { useState } from "react";
import type { AwardInfo } from "../shared/types";
import { sectionStyles as styles } from "./sectionStyles";
import { DatePartsInput } from './DatePartsInput.tsx';
import { PresetFieldsEditor } from './CustomProfileEditor.tsx';
import { CoreFieldLabel } from './FieldAliasEditor.tsx';
import { createRecordPresetFields } from '../shared/profilePresets.ts';

interface Props {
  awards: AwardInfo[];
  onChange: (awards: AwardInfo[]) => void;
}

export function AwardsSection({ awards, onChange }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleCollapsed = (id: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const update = (index: number, field: Exclude<keyof AwardInfo, 'customFields'>, value: string) => {
    onChange(awards.map((award, current) => current === index ? { ...award, [field]: value } : award));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= awards.length) return;
    const next = [...awards];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <section className="awards-section">
      <h2 style={{ ...styles.sectionTitle, margin: "22px 0 8px" }}>奖项 / 荣誉</h2>
      <p style={styles.description}>名称为必填项，其他信息可按实际情况填写。</p>
      {awards.length === 0 && <div style={styles.empty}>还没有奖项或荣誉，点击下方按钮添加。</div>}
      {awards.map((award, index) => {
        const isCollapsed = collapsed.has(award.id);
        return (
        <div key={award.id} data-award-id={award.id} className={`profile-record-card${isCollapsed ? ' collapsed' : ''}`} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardIndex}>{`奖项 ${index + 1}${award.name ? ` · ${award.name}` : ''}`}</span>
            <div style={styles.cardActions}>
              <button type="button" onClick={() => toggleCollapsed(award.id)} style={styles.iconButton} aria-expanded={!isCollapsed}>{isCollapsed ? '展开' : '折叠'}</button>
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} style={styles.iconButton}>上移</button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === awards.length - 1} style={styles.iconButton}>下移</button>
              <button type="button" onClick={() => onChange(awards.filter((_, current) => current !== index))} style={styles.removeButton}>删除</button>
            </div>
          </div>
          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="award.name" text="名称" required /></label>
              <input value={award.name} onChange={event => update(index, "name", event.target.value)} style={styles.input} placeholder="请填写奖项名称" aria-invalid={!award.name.trim()} />
              {!award.name.trim() && <div className="field-error">请填写奖项名称</div>}
            </div>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="award.role" text="担任角色" /></label>
              <input value={award.role} onChange={event => update(index, "role", event.target.value)} style={styles.input} placeholder="可留空" />
            </div>
          </div>
          <div style={styles.group}>
            <label style={styles.label}><CoreFieldLabel profileKey="award.date" text="获取时间" /></label>
            <DatePartsInput value={award.date} onChange={value => update(index, "date", value)} />
          </div>
          <div style={styles.group}>
            <label style={styles.label}><CoreFieldLabel profileKey="award.description" text="详细描述" /></label>
            <textarea value={award.description} onChange={event => update(index, "description", event.target.value)} style={styles.textarea} placeholder="可留空" />
          </div>
          <PresetFieldsEditor
            title="奖项详细信息"
            fields={award.customFields || []}
            onChange={customFields => onChange(awards.map((record, current) => current === index ? { ...record, customFields } : record))}
          />
        </div>
      );})}
      <button type="button" onClick={() => onChange([...awards, { id: crypto.randomUUID(), name: "", role: "", date: "", description: "", customFields: createRecordPresetFields('award') }])} style={styles.addButton}>添加奖项 / 荣誉</button>
    </section>
  );
}
