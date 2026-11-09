// 设置页「数据与同步」中的一次性迁移入口：
// 选择旧版 Python 校招表单助手保存的 profile.json → 本地解析 → 只显示条数摘要
// → 二次确认后覆盖当前活动简历。摘要与提示都不渲染任何个人答案值。
import React, { useRef, useState } from 'react';
import { MessageService } from '../shared/message.ts';
import type { ActiveResumeContext } from '../shared/types.ts';
import {
  convertLegacyProfile,
  LegacyProfileImportError,
  type LegacyImportStats,
} from '../shared/legacyProfileImport.ts';
import { upgradeProfileCustomData } from '../shared/profileCustomFields.ts';
import { prepareProfilePresets } from '../shared/profilePresets.ts';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

interface Props {
  onImported: () => void;
}

interface PendingImport {
  fileName: string;
  stats: LegacyImportStats;
  warnings: string[];
  profile: ReturnType<typeof convertLegacyProfile>['profile'];
}

function Summary({ stats }: { stats: LegacyImportStats }) {
  return (
    <dl className="backup-summary legacy-import-summary">
      <div><dt>个人信息字段</dt><dd>{stats.facts.imported} / {stats.facts.total} 项</dd></div>
      <div><dt>教育经历</dt><dd>{stats.education.imported} 条</dd></div>
      <div><dt>项目经历</dt><dd>{stats.projects.imported} 条</dd></div>
      <div><dt>实习 / 工作经历</dt><dd>{stats.experience.imported} 条</dd></div>
      <div><dt>奖项 / 荣誉</dt><dd>{stats.awards.imported} 条</dd></div>
      <div><dt>证书</dt><dd>{stats.certifications.imported} 条</dd></div>
      <div><dt>家庭成员</dt><dd>{stats.family.imported} 条</dd></div>
      <div><dt>语言能力</dt><dd>{stats.languages.imported} 条</dd></div>
      <div><dt>论文发表</dt><dd>{stats.publications.imported} 条</dd></div>
      <div><dt>技能</dt><dd>{stats.facts.skills} 项</dd></div>
      <div><dt>自定义模块</dt><dd>{stats.customModules.total} 个 / {stats.customModules.records} 条记录</dd></div>
      <div><dt>其他信息</dt><dd>{stats.customInformation} 条</dd></div>
      <div><dt>旧页面字段别名</dt><dd>{stats.aliases.imported} 条 / {stats.aliases.keys} 个字段</dd></div>
      <div><dt>教育重复合并</dt><dd>{stats.education.merged} 条</dd></div>
      <div><dt>需要人工核对</dt><dd>{stats.warnings} 条提示</dd></div>
    </dl>
  );
}

export function LegacyImportSection({ onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const resetFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectFile = async (file?: File) => {
    setPending(null);
    setConfirming(false);
    setNotice(null);
    if (!file) {
      resetFileInput();
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setNotice({ type: 'error', text: '文件超过 20 MiB 上限，未读取。' });
      resetFileInput();
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setNotice({ type: 'error', text: '文件不是有效 JSON，可能不是旧版 profile.json。' });
      resetFileInput();
      return;
    }
    try {
      const result = convertLegacyProfile(raw);
      setPending({
        fileName: file.name,
        stats: result.stats,
        warnings: result.warnings,
        profile: result.profile,
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof LegacyProfileImportError
          ? error.message
          : '解析旧资料失败：文件结构无法识别，当前资料未更改。',
      });
    } finally {
      resetFileInput();
    }
  };

  const importProfile = async () => {
    if (!pending) return;
    setBusy(true);
    setNotice(null);
    try {
      const activeResponse = await MessageService.sendMessage<ActiveResumeContext>({
        type: 'GET_ACTIVE_RESUME_CONTEXT',
      });
      if (!activeResponse.success || !activeResponse.data) {
        setNotice({ type: 'error', text: activeResponse.error || '读取当前活动简历失败，未导入。' });
        return;
      }
      const prepared = prepareProfilePresets(upgradeProfileCustomData(pending.profile));
      const saveResponse = await MessageService.sendMessage({
        type: 'SAVE_USER_PROFILE',
        payload: { profile: prepared, expectedProfileId: activeResponse.data.activeProfileId },
      });
      if (!saveResponse.success) {
        setNotice({
          type: 'error',
          text: `导入失败：${saveResponse.error || '保存被拒绝'}。当前本地资料未更改。`,
        });
        return;
      }
      setPending(null);
      setConfirming(false);
      onImported();
      setNotice({ type: 'success', text: '已导入，可在基本信息/教育经历等页面核对' });
    } catch {
      setNotice({ type: 'error', text: '导入时出错，当前本地资料未更改。' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="data-section legacy-import-section">
      <div className="data-section-heading">
        <div>
          <h2 className="settings-section-title">从旧版校招助手导入（profile.json）</h2>
          <p className="settings-description">
            选择旧版 Python 校招表单助手保存的 profile.json，一次性迁移到当前扩展。
            文件只在本机解析，不上传、不联网；确认导入后会整体覆盖当前活动简历。
          </p>
        </div>
        <div className="data-heading-actions">
          <button
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            选择 profile.json
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            onChange={event => void selectFile(event.target.files?.[0])}
          />
        </div>
      </div>

      <div className="sensitive-warning" role="note">
        profile.json 包含完整个人信息。导入过程不会把它写到页面或发送给任何服务；
        本页只显示条数摘要，不显示具体内容。
      </div>

      {pending && (
        <div className="backup-preview">
          <h3>已读取旧资料：{pending.fileName}</h3>
          <p className="settings-hint">以下为迁移条数摘要，尚未导入。确认后才会覆盖当前活动简历（不能撤销）。</p>
          <Summary stats={pending.stats} />
          {pending.warnings.length > 0 && (
            <div>
              <h4 className="legacy-import-warning-title">需要人工核对 / 数据质量提示（{pending.warnings.length} 条）</h4>
              <ul className="legacy-import-warnings">
                {pending.warnings.map(warning => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          )}
          <div className="sync-actions">
            <button className="btn btn-secondary" onClick={() => setPending(null)} disabled={busy}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => setConfirming(true)} disabled={busy}>
              覆盖并导入
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className={`data-notice data-notice-${notice.type}`} role="status" aria-live="polite">
          {notice.text}
        </div>
      )}

      {confirming && pending && (
        <div className="confirm-layer" role="dialog" aria-modal="true" aria-labelledby="legacy-import-confirm-title">
          <div className="confirm-dialog">
            <h3 id="legacy-import-confirm-title">确认覆盖当前活动简历？</h3>
            <p>
              导入会用旧版资料转换结果整体替换当前活动简历（其他简历不受影响）。
              此操作不能撤销，建议导入前先导出一次本地备份。
            </p>
            <div className="sync-actions">
              <button className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
                取消
              </button>
              <button className="btn btn-primary" onClick={() => void importProfile()} disabled={busy}>
                {busy ? '导入中…' : '确认覆盖并导入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
