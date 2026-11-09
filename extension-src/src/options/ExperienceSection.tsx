import React, { useState } from 'react';
import type { ExperienceInfo, ProjectInfo } from '../shared/types';
import { sectionStyles as styles } from './sectionStyles';
import { DatePartsInput } from './DatePartsInput.tsx';
import { PresetFieldsEditor } from './CustomProfileEditor.tsx';
import { CoreFieldLabel } from './FieldAliasEditor.tsx';
import { createRecordPresetFields } from '../shared/profilePresets.ts';

interface Props {
  experience: ExperienceInfo[];
  projects: ProjectInfo[];
  onChangeExperience: (items: ExperienceInfo[]) => void;
  onChangeProjects: (items: ProjectInfo[]) => void;
}

/**
 * 实习经历、项目/校园经历与技能的编辑界面。
 * 与教育经历一致，顺序决定自动填充取用哪一条。
 */
export function ExperienceSection({
  experience,
  projects,
  onChangeExperience,
  onChangeProjects,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleCollapsed = (id: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const updateExp = (index: number, field: Exclude<keyof ExperienceInfo, 'customFields'>, value: string) => {
    const next = [...experience];
    next[index] = { ...next[index], [field]: value };
    onChangeExperience(next);
  };

  const moveExp = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= experience.length) return;
    const next = [...experience];
    [next[index], next[target]] = [next[target], next[index]];
    onChangeExperience(next);
  };

  const updateProj = (index: number, field: Exclude<keyof ProjectInfo, 'customFields'>, value: string) => {
    const next = [...projects];
    next[index] = { ...next[index], [field]: value };
    onChangeProjects(next);
  };

  const moveProj = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= projects.length) return;
    const next = [...projects];
    [next[index], next[target]] = [next[target], next[index]];
    onChangeProjects(next);
  };

  return (
    <div>
      <h2 style={styles.sectionTitle}>实习 / 工作经历</h2>
      <p style={styles.description}>
        自动填充时默认使用第一条，请把最相关的经历排在最前。
      </p>

      {experience.length === 0 && (
        <div style={styles.empty}>还没有实习经历，点击下方按钮添加，或在「简历上传」中导入。</div>
      )}

      {experience.map((item, index) => {
        const recordId = item.id || `experience-${index}`;
        const isCollapsed = collapsed.has(recordId);
        return (
        <div key={recordId} className={`profile-record-card${isCollapsed ? ' collapsed' : ''}`} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardIndex}>
              {`${index === 0 ? '主要经历' : `经历 ${index + 1}`}${item.company ? ` · ${item.company}` : ''}`}
            </span>
            <div style={styles.cardActions}>
              <button type="button" onClick={() => toggleCollapsed(recordId)} style={styles.iconButton} aria-expanded={!isCollapsed}>{isCollapsed ? '展开' : '折叠'}</button>
              <button onClick={() => moveExp(index, -1)} disabled={index === 0} style={styles.iconButton}>上移</button>
              <button onClick={() => moveExp(index, 1)} disabled={index === experience.length - 1} style={styles.iconButton}>下移</button>
              <button
                onClick={() => onChangeExperience(experience.filter((_, i) => i !== index))}
                style={styles.removeButton}
              >
                删除
              </button>
            </div>
          </div>

          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="experience.company" text="公司 / 机构" /></label>
              <input
                type="text"
                value={item.company || ''}
                onChange={e => updateExp(index, 'company', e.target.value)}
                style={styles.input}
                placeholder="如 科大讯飞"
              />
            </div>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="experience.position" text="岗位" /></label>
              <input
                type="text"
                value={item.position || ''}
                onChange={e => updateExp(index, 'position', e.target.value)}
                style={styles.input}
                placeholder="如 AI产品经理"
              />
            </div>
          </div>

          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="experience.startDate" text="开始时间" /></label>
              <DatePartsInput
                value={item.startDate || ''}
                onChange={value => updateExp(index, 'startDate', value)}
              />
            </div>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="experience.endDate" text="结束时间" /></label>
              <DatePartsInput
                value={item.endDate || ''}
                onChange={value => updateExp(index, 'endDate', value)}
                allowPresent
              />
            </div>
          </div>

          <div style={styles.group}>
            <label style={styles.label}><CoreFieldLabel profileKey="experience.description" text="工作内容" /></label>
            <textarea
              value={item.description || ''}
              onChange={e => updateExp(index, 'description', e.target.value)}
              style={{ ...styles.textarea, minHeight: '60px' }}
              placeholder="职责与成果，网申中的实习描述会用到这段内容"
            />
          </div>
          <PresetFieldsEditor
            title="工作经历详细信息"
            fields={item.customFields || []}
            onChange={customFields => onChangeExperience(experience.map((record, current) => current === index ? { ...record, customFields } : record))}
          />
        </div>
      );})}

      <button
        onClick={() =>
          onChangeExperience([
            ...experience,
            {
              id: crypto.randomUUID(),
              company: '',
              position: '',
              startDate: '',
              endDate: '',
              description: '',
              customFields: createRecordPresetFields('experience'),
            },
          ])
        }
        style={styles.addButton}
      >
        添加实习 / 工作经历
      </button>

      <h2 style={{ ...styles.sectionTitle, margin: '22px 0 8px' }}>项目经历</h2>
      <p style={styles.description}>
        课程、科研、竞赛、开源等项目放在这里；校园任职与社团经历已在下方常用模块中单独提供。
      </p>

      {projects.length === 0 && (
        <div style={styles.empty}>还没有项目经历，点击下方按钮添加。</div>
      )}

      {projects.map((item, index) => {
        const recordId = item.id || `project-${index}`;
        const isCollapsed = collapsed.has(recordId);
        return (
        <div key={recordId} className={`profile-record-card${isCollapsed ? ' collapsed' : ''}`} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardIndex}>{`项目 ${index + 1}${item.name ? ` · ${item.name}` : ''}`}</span>
            <div style={styles.cardActions}>
              <button type="button" onClick={() => toggleCollapsed(recordId)} style={styles.iconButton} aria-expanded={!isCollapsed}>{isCollapsed ? '展开' : '折叠'}</button>
              <button onClick={() => moveProj(index, -1)} disabled={index === 0} style={styles.iconButton}>上移</button>
              <button onClick={() => moveProj(index, 1)} disabled={index === projects.length - 1} style={styles.iconButton}>下移</button>
              <button
                onClick={() => onChangeProjects(projects.filter((_, i) => i !== index))}
                style={styles.removeButton}
              >
                删除
              </button>
            </div>
          </div>

          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="project.name" text="项目名称" /></label>
              <input
                type="text"
                value={item.name || ''}
                onChange={e => updateProj(index, 'name', e.target.value)}
                style={styles.input}
                placeholder="如 院学生会"
              />
            </div>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="project.role" text="担任角色" /></label>
              <input
                type="text"
                value={item.role || ''}
                onChange={e => updateProj(index, 'role', e.target.value)}
                style={styles.input}
                placeholder="如 部长"
              />
            </div>
          </div>

          <div style={styles.row}>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="project.startDate" text="开始时间" /></label>
              <DatePartsInput
                value={item.startDate || ''}
                onChange={value => updateProj(index, 'startDate', value)}
              />
            </div>
            <div style={styles.group}>
              <label style={styles.label}><CoreFieldLabel profileKey="project.endDate" text="结束时间" /></label>
              <DatePartsInput
                value={item.endDate || ''}
                onChange={value => updateProj(index, 'endDate', value)}
                allowPresent
              />
            </div>
          </div>

          <div style={styles.group}>
            <label style={styles.label}><CoreFieldLabel profileKey="project.description" text="项目描述" /></label>
            <textarea
              value={item.description || ''}
              onChange={e => updateProj(index, 'description', e.target.value)}
              style={{ ...styles.textarea, minHeight: '60px' }}
              placeholder="做了什么、取得什么结果"
            />
          </div>
          <PresetFieldsEditor
            title="项目经历详细信息"
            fields={item.customFields || []}
            onChange={customFields => onChangeProjects(projects.map((record, current) => current === index ? { ...record, customFields } : record))}
          />
        </div>
      );})}

      <button
        onClick={() =>
          onChangeProjects([
            ...projects,
            {
              id: crypto.randomUUID(),
              name: '',
              role: '',
              startDate: '',
              endDate: '',
              description: '',
              customFields: createRecordPresetFields('project'),
            },
          ])
        }
        style={styles.addButton}
      >
        添加项目经历
      </button>
    </div>
  );
}
