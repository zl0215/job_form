import React, { useState } from 'react';
import type { ProfileCustomField, ProfileCustomModule, ProfileFieldType } from '../shared/types.ts';
import {
  PROFILE_FIELD_TYPE_LABELS,
  aliasesFromText,
  aliasesToText,
  createCustomField,
  createCustomModule,
} from '../shared/profileCustomFields.ts';
import { EXTRA_TEMPLATE_PRESETS, createPresetModule } from '../shared/profilePresets.ts';
import { AliasTextInput, FieldAliasEditor } from './FieldAliasEditor.tsx';
import { DatePartsInput } from './DatePartsInput.tsx';

interface FieldEditorProps {
  title: string;
  description?: string;
  fields: ProfileCustomField[];
  onChange: (fields: ProfileCustomField[]) => void;
}

const FIELD_TYPES = Object.entries(PROFILE_FIELD_TYPE_LABELS) as Array<[ProfileFieldType, string]>;

function FieldValueEditor({ field, onChange }: { field: ProfileCustomField; onChange: (value: string) => void }) {
  if (field.type === 'month') return <DatePartsInput value={field.value} onChange={onChange} />;
  if (field.type === 'date') return <DatePartsInput value={field.value} onChange={onChange} precision="day" />;
  if (field.type === 'year') return <DatePartsInput value={field.value} onChange={onChange} precision="year" />;
  if (field.type === 'date-range') return <DateRangeValueEditor value={field.value} onChange={onChange} />;
  if (field.type === 'boolean') {
    return <select value={field.value} onChange={event => onChange(event.target.value)}><option value="">请选择</option><option value="是">是</option><option value="否">否</option></select>;
  }
  if (field.type === 'single' && field.options?.length) {
    return <select value={field.value} onChange={event => onChange(event.target.value)}><option value="">请选择</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>;
  }
  if (field.type === 'textarea' || field.type === 'multi' || field.type === 'address') {
    return <textarea value={field.value} onChange={event => onChange(event.target.value)} placeholder={field.type === 'multi' ? '多个值用顿号或逗号分隔' : '请输入内容'} rows={2} />;
  }
  return <input type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'} value={field.value} onChange={event => onChange(event.target.value)} placeholder="请输入内容" />;
}

function DateRangeValueEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const parts = value.split(/\s+(?:至|到|~|—|–)\s+/);
  const start = parts[0] || '';
  const end = parts[1] || '';
  const update = (nextStart: string, nextEnd: string) => onChange(nextStart && nextEnd ? `${nextStart} 至 ${nextEnd}` : nextStart || nextEnd);
  return <div className="custom-date-range"><DatePartsInput value={start} onChange={next => update(next, end)} /><span>至</span><DatePartsInput value={end} onChange={next => update(start, next)} allowPresent /></div>;
}

export function CustomFieldsEditor({ title, description, fields, onChange }: FieldEditorProps) {
  const update = (index: number, next: Partial<ProfileCustomField>) => onChange(fields.map((item, current) => current === index ? { ...item, ...next } : item));
  return (
    <section className="custom-fields-editor">
      <div className="module-heading compact">
        <div><h3>{title}</h3>{description && <p>{description}</p>}</div>
        <button type="button" className="btn btn-secondary" onClick={() => onChange([...fields, createCustomField()])}>添加字段</button>
      </div>
      {fields.length === 0 && <div className="module-empty compact-empty">暂无自定义字段，需要时可继续添加。</div>}
      <div className="custom-field-list">
        {fields.map((item, index) => (
          <article className={`custom-field-card type-${item.type}`} key={item.id}>
            <div className="custom-field-grid">
              <label><span>字段名称</span><input value={item.name} onChange={event => update(index, { name: event.target.value })} placeholder="如 身高" /></label>
              <label><span>字段类型</span><select value={item.type} onChange={event => update(index, { type: event.target.value as ProfileFieldType })}>{FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="field-value"><span>字段值</span><FieldValueEditor field={item} onChange={value => update(index, { value })} /></label>
              <label><span>单位</span><input value={item.unit || ''} onChange={event => update(index, { unit: event.target.value })} placeholder="可选" /></label>
              <label className="field-aliases"><span>匹配别名</span><AliasTextInput value={item.aliases} onCommit={aliases => update(index, { aliases })} placeholder="顿号分隔" /></label>
              {(item.type === 'single' || item.type === 'multi') && <label className="field-options"><span>候选值</span><AliasTextInput value={item.options || []} onCommit={options => update(index, { options })} placeholder="多个值用顿号分隔" /></label>}
            </div>
            <div className="custom-field-footer">
              <label><input type="checkbox" checked={item.allowAI} onChange={event => update(index, { allowAI: event.target.checked })} />允许发送给 AI 匹配</label>
              <label><input type="checkbox" checked={item.sensitive} onChange={event => update(index, { sensitive: event.target.checked, allowAI: event.target.checked ? false : item.allowAI })} />敏感信息（仅本地匹配）</label>
              <button type="button" className="text-danger" onClick={() => onChange(fields.filter((_, current) => current !== index))}>删除字段</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PresetFieldsEditor({ title, description, fields, onChange }: FieldEditorProps) {
  const presets = fields.filter(item => Boolean(item.presetKey));
  const custom = fields.filter(item => !item.presetKey);
  const updatePreset = (id: string, value: string) => onChange(fields.map(item => item.id === id ? { ...item, value } : item));
  if (presets.length === 0) return <CustomFieldsEditor title={title} description={description} fields={custom} onChange={onChange} />;
  return (
    <section className="preset-fields-editor">
      <div className="preset-fields-heading"><div><h3>{title}</h3>{description && <p>{description}</p>}</div><button type="button" className="btn btn-secondary compact-add" onClick={() => onChange([...fields, createCustomField()])}>添加字段</button></div>
      <div className="preset-fields-grid">
        {presets.map(item => (
          <label className={`preset-field preset-${item.type}`} key={item.id}>
            <span>
              {item.name}{item.unit ? `（${item.unit}）` : ''}{item.sensitive ? ' 🔒' : ''}
              {item.presetKey && <FieldAliasEditor profileKey={item.presetKey} systemAliases={item.aliases} />}
            </span>
            <FieldValueEditor field={item} onChange={value => updatePreset(item.id, value)} />
          </label>
        ))}
      </div>
      {custom.length > 0 && <CustomFieldsEditor title="另外添加的字段" fields={custom} onChange={next => onChange([...presets, ...next])} />}
    </section>
  );
}

function recordSummary(module: ProfileCustomModule, recordIndex: number): string {
  const record = module.records[recordIndex];
  const firstValue = record.fields.find(field => field.value.trim())?.value.trim();
  return record.title?.trim() || firstValue || `记录 ${recordIndex + 1}`;
}

export function CommonModulesEditor({ modules, onChange }: { modules: ProfileCustomModule[]; onChange: (modules: ProfileCustomModule[]) => void }) {
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(() => new Set());
  const [collapsedRecords, setCollapsedRecords] = useState<Set<string>>(() => new Set());
  const updateModule = (index: number, next: Partial<ProfileCustomModule>) => onChange(modules.map((item, current) => current === index ? { ...item, ...next } : item));
  const updateFields = (moduleIndex: number, recordIndex: number, fields: ProfileCustomField[]) => {
    const module = modules[moduleIndex];
    updateModule(moduleIndex, { records: module.records.map((record, current) => current === recordIndex ? { ...record, fields } : record) });
  };
  const toggleModule = (id: string) => setCollapsedModules(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleRecord = (id: string) => setCollapsedRecords(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <>
      {modules.map((module, moduleIndex) => {
        const moduleCollapsed = collapsedModules.has(module.id);
        return <section className="profile-module common-profile-module" data-common-module={module.presetKey} key={module.id}>
          <div className="common-module-heading">
            <div><h2>{module.name}</h2><p>按实际情况填写；留空的字段不会参与自动填充。</p></div>
            <button type="button" className="collapse-button" onClick={() => toggleModule(module.id)}>{moduleCollapsed ? '展开' : '折叠'}</button>
          </div>
          {!moduleCollapsed && <>
            {module.records.map((record, recordIndex) => module.repeatable ? (
              <article className={`common-record-card profile-record-card${collapsedRecords.has(record.id) ? ' collapsed' : ''}`} key={record.id}>
                <div className="common-record-header">
                  <strong>{recordSummary(module, recordIndex)}</strong>
                  <div>
                    <button type="button" className="collapse-button" onClick={() => toggleRecord(record.id)}>{collapsedRecords.has(record.id) ? '展开' : '折叠'}</button>
                    {module.records.length > 1 && <button type="button" className="text-danger" onClick={() => updateModule(moduleIndex, { records: module.records.filter((_, current) => current !== recordIndex) })}>删除本条</button>}
                  </div>
                </div>
                <div className="custom-record-title"><input value={record.title || ''} onChange={event => updateModule(moduleIndex, { records: module.records.map((item, current) => current === recordIndex ? { ...item, title: event.target.value } : item) })} placeholder={`记录 ${recordIndex + 1} 的标题（可选）`} /></div>
                <PresetFieldsEditor title={`记录 ${recordIndex + 1}`} fields={record.fields} onChange={fields => updateFields(moduleIndex, recordIndex, fields)} />
              </article>
            ) : (
              <PresetFieldsEditor key={record.id} title="填写内容" fields={record.fields} onChange={fields => updateFields(moduleIndex, recordIndex, fields)} />
            ))}
            {module.repeatable && <button type="button" className="btn btn-secondary compact-add-record" onClick={() => updateModule(moduleIndex, { records: [...module.records, { id: crypto.randomUUID(), fields: module.records[0]?.fields.map(item => ({ ...item, id: crypto.randomUUID(), value: '' })) || [] }] })}>添加一条记录</button>}
          </>}
        </section>;
      })}
    </>
  );
}

export function CustomModulesEditor({ modules, onChange }: { modules: ProfileCustomModule[]; onChange: (modules: ProfileCustomModule[]) => void }) {
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(() => new Set());
  const updateModule = (index: number, next: Partial<ProfileCustomModule>) => onChange(modules.map((item, current) => current === index ? { ...item, ...next } : item));
  const updateFields = (moduleIndex: number, recordIndex: number, fields: ProfileCustomField[]) => {
    const module = modules[moduleIndex];
    updateModule(moduleIndex, { records: module.records.map((record, current) => current === recordIndex ? { ...record, fields } : record) });
  };
  const toggleModule = (id: string) => setCollapsedModules(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <section className="profile-module custom-modules">
      <div className="module-heading">
        <div><h2>自定义模块</h2><p>这里默认留空；需要额外资料时，可以选用模板或创建自己的模块。</p></div>
        <div className="module-add-actions">
          <select defaultValue="" onChange={event => { const preset = EXTRA_TEMPLATE_PRESETS.find(item => item.key === event.target.value); if (preset) onChange([...modules, createPresetModule(preset)]); event.target.value = ''; }} aria-label="添加模块模板">
            <option value="">添加模块模板…</option>{EXTRA_TEMPLATE_PRESETS.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
          </select>
          <button type="button" className="btn btn-secondary" onClick={() => onChange([...modules, createCustomModule()])}>新建空白模块</button>
        </div>
      </div>
      {modules.length === 0 && <div className="module-empty">还没有自定义模块，需要时再添加即可。</div>}
      {modules.map((module, moduleIndex) => (
        <article className="custom-module-card" key={module.id}>
          <div className="custom-module-header">
            <strong>{module.name || '未命名模块'}</strong><span>{module.records.length} 条记录</span>
            <button type="button" className="collapse-button module-collapse" onClick={() => toggleModule(module.id)}>{collapsedModules.has(module.id) ? '展开' : '折叠'}</button>
          </div>
          {!collapsedModules.has(module.id) && <div className="custom-module-body">
            <div className="custom-module-settings">
              <label><span>模块名称</span><input value={module.name} onChange={event => updateModule(moduleIndex, { name: event.target.value })} /></label>
              <label className="inline-check"><input type="checkbox" checked={module.repeatable} onChange={event => updateModule(moduleIndex, { repeatable: event.target.checked })} />允许添加多条记录</label>
              <button type="button" className="text-danger" onClick={() => onChange(modules.filter((_, current) => current !== moduleIndex))}>删除模块</button>
            </div>
            {module.records.map((record, recordIndex) => (
              <div className="custom-record" key={record.id}>
                {module.repeatable && <div className="custom-record-title"><input value={record.title || ''} onChange={event => updateModule(moduleIndex, { records: module.records.map((item, current) => current === recordIndex ? { ...item, title: event.target.value } : item) })} placeholder={`记录 ${recordIndex + 1} 的标题（可选）`} />{module.records.length > 1 && <button type="button" className="text-danger" onClick={() => updateModule(moduleIndex, { records: module.records.filter((_, current) => current !== recordIndex) })}>删除本条</button>}</div>}
                <PresetFieldsEditor title={module.repeatable ? `记录 ${recordIndex + 1}` : '模块字段'} fields={record.fields} onChange={fields => updateFields(moduleIndex, recordIndex, fields)} />
              </div>
            ))}
            {module.repeatable && <button type="button" className="btn btn-secondary compact-add-record" onClick={() => updateModule(moduleIndex, { records: [...module.records, { id: crypto.randomUUID(), fields: module.records[0]?.fields.map(item => ({ ...item, id: crypto.randomUUID(), value: '' })) || [] }] })}>添加一条记录</button>}
          </div>}
        </article>
      ))}
    </section>
  );
}
