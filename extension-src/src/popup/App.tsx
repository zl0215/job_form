import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MessageService } from '../shared/message';
import type {
  Message,
  MessageResponse,
  PageFieldReport,
  PageFieldReportItem,
  ResumeProfileSummary,
  SaveFieldAliasResult,
  UserProfile,
} from '../shared/types';
import type { FormFillResult } from '../content/formFiller.ts';
import { toLearnableProfileFields, type LearnableProfileField } from '../shared/fieldLearning.ts';
import { claimPopupSwitch, createPopupRequestGate, executePopupInitialLoad, executePopupProfileSwitch, isPopupInteractionDisabled, ResumeProfileSelector } from './ResumeProfileSelector';
import { buildSidepanelUrl, openInfoFloatWindow } from '../sidepanel/navigation';

const APPLICATION_RECORDS_PAGE = 'src/application-records/index.html';

function getRuntimeUrl(path: string): string {
  return typeof chrome !== 'undefined' ? chrome.runtime.getURL(path) : path;
}

export async function openApplicationRecordCreateWindow(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('没有可用的当前页面');
  }

  const draftResponse = await MessageService.sendMessage<{ draftId: string }>({
    type: 'CREATE_APPLICATION_RECORD_DRAFT',
    payload: { tabId: tab.id },
  });
  if (!draftResponse.success || !draftResponse.data?.draftId) {
    throw new Error(draftResponse.error || '无法创建投递记录草稿');
  }

  await chrome.windows.create({
    url: getRuntimeUrl(`${APPLICATION_RECORDS_PAGE}?draftId=${encodeURIComponent(draftResponse.data.draftId)}`),
    type: 'popup',
    width: 520,
    height: 760,
    focused: true,
  });
}

export async function openApplicationRecordOptions(): Promise<void> {
  await chrome.tabs.create({
    url: getRuntimeUrl('src/options/index.html?tab=application-records'),
  });
}

/** 合并各 frame 的填充结果；没有任何成功响应时返回 null。 */
export function mergeFillResults(
  responses: Array<MessageResponse<FormFillResult>>,
): FormFillResult | null {
  const successful = responses.filter(
    (response): response is MessageResponse<FormFillResult> & { data: FormFillResult } => (
      response.success && Boolean(response.data)
    ),
  );
  if (successful.length === 0) return null;
  return successful.reduce<FormFillResult>((total, response) => ({
    detected: total.detected + response.data.detected,
    attempted: total.attempted + response.data.attempted,
    filled: total.filled + response.data.filled,
    failed: total.failed + response.data.failed,
    skippedExisting: (total.skippedExisting || 0) + (response.data.skippedExisting || 0),
    skippedBlocked: (total.skippedBlocked || 0) + (response.data.skippedBlocked || 0),
    skippedAmbiguous: (total.skippedAmbiguous || 0) + (response.data.skippedAmbiguous || 0),
    skippedChoices: (total.skippedChoices || 0) + (response.data.skippedChoices || 0),
  }), { detected: 0, attempted: 0, filled: 0, failed: 0 });
}

/** 填充结果的人话摘要（页面内 toast 与弹窗内摘要共用同一套口径）。 */
export function describeFillSummary(result: FormFillResult): string {
  const parts: string[] = [];
  if (result.filled > 0) parts.push(`已填 ${result.filled} 项空白字段`);
  if (result.skippedExisting) parts.push(`跳过已有内容 ${result.skippedExisting} 项`);
  if (result.skippedBlocked) parts.push(`禁止字段 ${result.skippedBlocked} 项`);
  if (result.skippedAmbiguous) parts.push(`无法确定 ${result.skippedAmbiguous} 项`);
  if (result.failed) parts.push(`${result.failed} 项未能写入`);
  if (result.skippedChoices) parts.push(`${result.skippedChoices} 组选项请手动选择`);
  return parts.length ? parts.join('；') : '没有需要重新填充的空白字段';
}

/** 下拉选项展示：label + 模块 + 稳定 key；敏感字段带标注。 */
export function fieldLearningOptionText(field: LearnableProfileField): string {
  return `${field.label}（${field.scopeLabel} · ${field.key}）${field.sensitive ? ' 🔒敏感' : ''}`;
}

export interface FieldLearningPanelProps {
  report: PageFieldReport;
  learnableFields: LearnableProfileField[];
  selections: Record<string, string>;
  savingItemId: string;
  hint: string;
  error: string;
  refilling: boolean;
  refillSummary: string;
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onSelect: (itemId: string, profileKey: string) => void;
  onSave: (item: PageFieldReportItem) => void;
  onRefill: () => void;
}

/**
 * popup「本页字段对照」折叠区（纯展示组件，便于静态渲染测试）。
 * 没有未识别字段时整块不渲染——不会出现空面板。
 */
export function FieldLearningPanel(props: FieldLearningPanelProps): React.ReactElement | null {
  const { report } = props;
  if (report.unmatched.length === 0) return null;

  return (
    <section className="field-report" aria-label="本页字段对照">
      <button
        type="button"
        className="field-report-toggle"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <span className="field-report-title">本页字段对照</span>
        <span className="field-report-badge">{report.unmatched.length} 个未识别</span>
      </button>

      {props.open && (
        <div className="field-report-body">
          <p className="field-report-note">
            选择网页字段对应的资料字段并记住，下次遇到同名网页字段会自动填写。只记网页字段名，不会上传任何资料内容。
          </p>

          {props.hint && (
            <p className="field-report-feedback field-report-feedback-success" role="status">{props.hint}</p>
          )}
          {props.error && (
            <p className="field-report-feedback field-report-feedback-error" role="alert">{props.error}</p>
          )}

          <ul className="field-learning-list">
            {report.unmatched.map(item => {
              const selectedKey = props.selections[item.id] || '';
              const selectedField = props.learnableFields.find(field => field.key === selectedKey);
              const saving = props.savingItemId === item.id;

              return (
                <li className="field-learning-item" key={item.id}>
                  <div className="field-learning-head">
                    <span className="field-learning-name" title={item.module || item.label}>
                      {item.label}
                    </span>
                    <span className="field-learning-section">{item.section}</span>
                  </div>

                  <div className="field-learning-meta">
                    <span className="field-learning-type">{item.type}</span>
                    <span className="field-learning-reason" title={item.reason}>{item.reason}</span>
                  </div>

                  {item.options.length > 0 && (
                    <p className="field-learning-options">
                      页面选项：{item.options.slice(0, 8).join(' / ')}
                    </p>
                  )}

                  {item.learnable ? (
                    <div className="field-learning-controls">
                      <select
                        aria-label={`为“${item.label}”选择对应的资料字段`}
                        value={selectedKey}
                        disabled={props.disabled || saving}
                        onChange={event => props.onSelect(item.id, event.target.value)}
                      >
                        <option value="">选择对应资料字段…</option>
                        {props.learnableFields.map(field => (
                          <option key={field.key} value={field.key}>
                            {fieldLearningOptionText(field)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="button button-primary field-learning-save"
                        disabled={props.disabled || saving || !selectedKey}
                        onClick={() => props.onSave(item)}
                      >
                        {saving ? '保存中...' : '记住并填充'}
                      </button>
                    </div>
                  ) : (
                    <p className="field-learning-unlearnable">
                      该字段没有可用的名称，无法记住（禁止字段永远不会被学习）。
                    </p>
                  )}

                  {selectedField?.sensitive && (
                    <p className="field-learning-sensitive">
                      🔒 {selectedField.label} 属于敏感资料，匹配只在本机完成，不会上传。
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="field-report-footer">
            {report.matched > 0 && (
              <details className="field-report-recognized">
                <summary>已自动识别 {report.matched} 个字段</summary>
                <ul>
                  {report.matchedFields.slice(0, 20).map((field, index) => (
                    <li key={`${field.label}-${index}`}>
                      <span className="field-report-recognized-label">{field.label}</span>
                      <span className="field-report-recognized-target">
                        已自动识别{field.targetLabel ? `：${field.targetLabel}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {report.blockedCount > 0 && (
              <p className="field-report-blocked">
                另有 {report.blockedCount} 个禁止字段（如内推码、验证码、密码）永远不会学习和填写。
              </p>
            )}

            <button
              type="button"
              className="button button-secondary field-report-refill"
              disabled={props.disabled || props.refilling}
              onClick={props.onRefill}
            >
              {props.refilling ? '正在重新填充...' : '重新填充空白字段'}
            </button>
            {props.refillSummary && (
              <p className="field-report-refill-summary" role="status">{props.refillSummary}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [resumeProfiles, setResumeProfiles] = useState<ResumeProfileSummary | null>(null);
  const [switching, setSwitching] = useState(false);
  const [profileSwitchError, setProfileSwitchError] = useState('');
  const [popupLoadError, setPopupLoadError] = useState('');
  const switchPendingRef = useRef(false);
  const requestGateRef = useRef(createPopupRequestGate());
  const [loading, setLoading] = useState(typeof window !== 'undefined');
  const [filling, setFilling] = useState(false);
  const [openingView, setOpeningView] = useState(false);
  const [openingApplicationCreate, setOpeningApplicationCreate] = useState(false);
  const [openingApplicationRecords, setOpeningApplicationRecords] = useState(false);
  const [detectedFields, setDetectedFields] = useState(0);
  const [copyReportState, setCopyReportState] = useState<'idle' | 'copied' | 'empty' | 'error'>('idle');

  // 本页字段对照（“记住一次”）状态
  const [pageReport, setPageReport] = useState<PageFieldReport | null>(null);
  const [fieldLearningOpen, setFieldLearningOpen] = useState(true);
  const [learnSelections, setLearnSelections] = useState<Record<string, string>>({});
  const [savingFieldItemId, setSavingFieldItemId] = useState('');
  const [learningHint, setLearningHint] = useState('');
  const [learningError, setLearningError] = useState('');
  const [refillingBlank, setRefillingBlank] = useState(false);
  const [refillSummary, setRefillSummary] = useState('');

  const learnableFields = useMemo(
    () => (profile ? toLearnableProfileFields(profile) : []),
    [profile],
  );

  const fetchProfile = async (): Promise<UserProfile> => {
    const response = await MessageService.sendMessage<UserProfile>({ type: 'GET_USER_PROFILE' });
    if (!response.success || !response.data) throw new Error(response.error || '加载个人信息失败');
    return response.data;
  };

  const fetchResumeProfiles = async (): Promise<ResumeProfileSummary> => {
    const response = await MessageService.sendMessage<ResumeProfileSummary>({ type: 'GET_RESUME_PROFILES' });
    if (!response.success || !response.data) throw new Error(response.error || '加载简历列表失败');
    return response.data;
  };

  /** 读取本页字段对照；失败时清空报告（不显示空面板）。 */
  const loadPageFieldReport = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('没有可用的当前页面');

      const response = await MessageService.sendMessage<PageFieldReport>({
        type: 'GET_PAGE_FIELD_REPORT',
        payload: { tabId: tab.id },
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || '读取本页字段失败');
      }

      const report = response.data;
      setPageReport(report);
      setLearnSelections(current => {
        const available = new Set(report.unmatched.map(item => item.id));
        const next: Record<string, string> = {};
        for (const [itemId, profileKey] of Object.entries(current)) {
          if (available.has(itemId)) next[itemId] = profileKey;
        }
        return next;
      });
    } catch (error) {
      console.warn('读取本页字段对照失败:', error);
      setPageReport(null);
      setLearnSelections({});
    }
  };

  useEffect(() => {
    const gate = createPopupRequestGate();
    requestGateRef.current = gate;
    const token = gate.begin();
    setPopupLoadError('');
    void executePopupInitialLoad({
      loadSummary: fetchResumeProfiles,
      loadProfile: fetchProfile,
      commitSummary: setResumeProfiles,
      commitProfile: setProfile,
      showError: setPopupLoadError,
      isCurrent: () => gate.isCurrent(token),
    }).finally(() => { if (gate.isCurrent(token)) setLoading(false); });
    void detectFields();
    void loadPageFieldReport();
    return () => {
      gate.unmount();
      switchPendingRef.current = false;
    };
  }, []);

  const resetFieldLearningState = () => {
    setPageReport(null);
    setLearnSelections({});
    setLearningHint('');
    setLearningError('');
    setRefillSummary('');
  };

  const handleProfileSwitch = async (nextId: string) => {
    if (!resumeProfiles || nextId === resumeProfiles.activeProfileId || !claimPopupSwitch(switchPendingRef)) return;
    const previousId = resumeProfiles.activeProfileId;
    const gate = requestGateRef.current;
    const token = gate.begin();
    const isCurrent = () => gate.isCurrent(token);
    setSwitching(true);
    setProfileSwitchError('');
    resetFieldLearningState();
    setResumeProfiles(current => current ? { ...current, activeProfileId: nextId } : current);

    await executePopupProfileSwitch(nextId, previousId, {
      switchProfile: targetId => MessageService.sendMessage<ResumeProfileSummary>({
        type: 'SWITCH_RESUME_PROFILE',
        payload: { id: targetId },
      }),
      loadSummary: fetchResumeProfiles,
      loadProfile: fetchProfile,
      commitSummary: setResumeProfiles,
      commitProfile: setProfile,
      rollback: id => setResumeProfiles(current => current ? { ...current, activeProfileId: id } : current),
      showError: setProfileSwitchError,
      isCurrent,
    });

    if (isCurrent()) {
      switchPendingRef.current = false;
      setSwitching(false);
      void loadPageFieldReport();
    }
  };

  const detectFields = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const responses = await sendMessageToAllFrames<{ count: number }>(tab.id, {
        type: 'DETECT_FIELDS'
      });
      setDetectedFields(responses.reduce(
        (sum, response) => sum + (response.success ? response.data?.count || 0 : 0),
        0,
      ));
    } catch (error) {
      console.error('Failed to detect fields:', error);
    }
  };

  const handleCopyFillReport = async () => {
    try {
      const response = await chrome.storage.local.get('jahFillReport');
      const report = response?.jahFillReport;
      if (!report) {
        setCopyReportState('empty');
        return;
      }
      await navigator.clipboard.writeText(JSON.stringify(report, null, 1));
      setCopyReportState('copied');
    } catch {
      setCopyReportState('error');
    } finally {
      window.setTimeout(() => setCopyReportState('idle'), 2400);
    }
  };

  const requestPageFill = async (): Promise<Array<MessageResponse<FormFillResult>>> => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) throw new Error('没有可用的当前页面');
    return sendMessageToAllFrames<FormFillResult>(tab.id, { type: 'FILL_FORM' });
  };

  /** 重新填充空白字段（只填空白，不覆盖已有内容，不提交）。 */
  const refillBlankFields = async (): Promise<FormFillResult | null> => {
    const responses = await requestPageFill();
    return mergeFillResults(responses);
  };

  const handleFillForm = async () => {
    if (!profile) {
      alert('请先设置个人信息！');
      openOptions();
      return;
    }

    setFilling(true);

    try {
      const responses = await requestPageFill();
      const result = mergeFillResults(responses);

      if (result) {
        // 与页面内提示保持一致：如实汇报成功、跳过已有内容、禁止字段与写入失败。
        const skipNotes = [
          result.skippedExisting ? `跳过已有内容 ${result.skippedExisting} 项` : '',
          result.skippedBlocked ? `禁止字段 ${result.skippedBlocked} 项` : '',
          result.skippedAmbiguous ? `无法确定 ${result.skippedAmbiguous} 项` : '',
        ].filter(Boolean).join('，');
        const skipSuffix = skipNotes ? `（${skipNotes}）` : '';
        if (result.filled === 0) {
          alert((result.detected === 0
            ? '未检测到可填充字段。该页面可能使用受限 iframe、封闭 Shadow DOM 或非标准控件。'
            : `检测到 ${result.detected} 个字段，但没有任何一项真正写入成功。`) + skipSuffix);
        } else if (result.failed > 0) {
          alert(`成功填入 ${result.filled} 项，${result.failed} 项未能写入，请人工核对。${skipSuffix}`);
        } else {
          alert(`成功填入 ${result.filled} 项。${skipSuffix}`);
        }
      } else {
        const error = responses.find(response => response.error)?.error;
        alert('填充失败：' + (error || '当前页面不允许扩展访问'));
      }
    } catch (error) {
      console.error('Fill form error:', error);
      alert('填充表单时出错');
    } finally {
      setFilling(false);
      setLearningHint('');
      setLearningError('');
      setRefillSummary('');
      void loadPageFieldReport();
    }
  };

  /** “记住并填充”：保存别名到当前活动简历，随后立即重填空白字段。 */
  const handleLearnField = async (item: PageFieldReportItem) => {
    const profileKey = learnSelections[item.id];
    if (!profileKey || !item.suggestedAlias || savingFieldItemId) return;

    setSavingFieldItemId(item.id);
    setLearningHint('');
    setLearningError('');
    setRefillSummary('');

    try {
      const response = await MessageService.sendMessage<SaveFieldAliasResult>({
        type: 'SAVE_FIELD_ALIAS',
        payload: { profileKey, alias: item.suggestedAlias },
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || '保存字段对照失败');
      }

      const saved = response.data;
      const target = learnableFields.find(field => field.key === profileKey);
      const targetLabel = target ? `“${target.label}”` : '所选资料字段';
      setLearningHint(saved.alreadyExists
        ? `“${saved.alias}”之前已经记住过，下次遇到同名字段会自动填写`
        : `已记住：${item.label} → ${targetLabel}，下次自动填写`);

      setLearnSelections(current => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });

      try {
        setProfile(await fetchProfile());
      } catch (error) {
        console.warn('刷新资料失败:', error);
      }

      const result = await refillBlankFields();
      if (result) setRefillSummary(describeFillSummary(result));
      await loadPageFieldReport();
    } catch (error) {
      setLearningError(error instanceof Error ? error.message : '保存字段对照失败');
    } finally {
      setSavingFieldItemId('');
    }
  };

  const handleRefillBlankFields = async () => {
    setRefillingBlank(true);
    setLearningError('');
    setLearningHint('');
    setRefillSummary('');
    try {
      const result = await refillBlankFields();
      setRefillSummary(result
        ? describeFillSummary(result)
        : '当前页面没有返回填充结果，请刷新页面后重试');
      await loadPageFieldReport();
    } catch (error) {
      setLearningError(error instanceof Error ? error.message : '重新填充失败');
    } finally {
      setRefillingBlank(false);
    }
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const handleOpenApplicationRecordCreate = async () => {
    setOpeningApplicationCreate(true);
    try {
      await openApplicationRecordCreateWindow();
      window.close();
    } catch (error) {
      alert(error instanceof Error ? error.message : '打开新建投递记录失败');
      setOpeningApplicationCreate(false);
    }
  };

  const handleOpenApplicationRecords = async () => {
    setOpeningApplicationRecords(true);
    try {
      await openApplicationRecordOptions();
      window.close();
    } catch (error) {
      alert(error instanceof Error ? error.message : '打开投递记录失败');
      setOpeningApplicationRecords(false);
    }
  };

  const handleOpenSidePanel = async () => {
    setOpeningView(true);
    try {
      const opened = await openNativeSidePanel();
      if (!opened) {
        // 原生侧边栏不可用（旧版浏览器 / API 缺失 / 手势失效）时回退到浮动小窗
        await openInfoFloatWindow();
      }
      window.close();
    } catch {
      // 原生侧边栏调用抛错时同样回退，避免用户点击后毫无反应
      try {
        await openInfoFloatWindow();
        window.close();
      } catch (fallbackError) {
        alert(fallbackError instanceof Error ? fallbackError.message : '打开信息窗口失败');
        setOpeningView(false);
      }
    }
  };

  // 尝试打开 Chrome 原生侧边栏；成功返回 true，不支持或未开启时返回 false。
  const openNativeSidePanel = async (): Promise<boolean> => {
    const sidePanel = (chrome as typeof chrome & { sidePanel?: chrome.sidePanel.SidePanel }).sidePanel;
    if (!sidePanel?.open || !sidePanel.setOptions) {
      return false;
    }

    const currentWindow = await chrome.windows.getCurrent();
    const windowId = currentWindow.id;
    if (typeof windowId !== 'number') {
      return false;
    }

    // 把目标窗口写进 path，侧边栏页面据此把字段写回正确的网页窗口
    await sidePanel.setOptions({
      path: buildSidepanelUrl({ targetWindowId: windowId }),
      enabled: true,
    });
    // open() 必须紧贴用户手势调用栈，前面的 await 已尽量精简
    await sidePanel.open({ windowId });
    return true;
  };

  const sendMessageToAllFrames = async <T,>(
    tabId: number,
    message: Message,
  ): Promise<Array<MessageResponse<T>>> => {
    const discoverFrames = async (): Promise<number[]> => {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => true,
        });
        return Array.from(new Set(results.map(result => result.frameId)));
      } catch {
        return [0];
      }
    };

    const send = async (frameIds: number[]) => Promise.all(
      frameIds.map(frameId => MessageService.sendMessageToTab<T>(tabId, message, { frameId })),
    );

    let frameIds = await discoverFrames();
    let responses = await send(frameIds);
    const hasReceiver = responses.some(response => response.success);
    const missingReceiver = responses.some(response => (
      /Receiving end does not exist|Could not establish connection/i.test(response.error || '')
    ));

    if (!hasReceiver && missingReceiver) {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js'],
      });
      await new Promise(resolve => setTimeout(resolve, 300));
      frameIds = await discoverFrames();
      responses = await send(frameIds);
    }

    return responses;
  };

  const interactionDisabled = isPopupInteractionDisabled({
    switching,
    filling,
    aiScanning: false,
    startingAIRegion: false,
  });

  if (loading) {
    return (
      <div className="popup-shell">
        <div className="popup-loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div className="popup-brand-row">
          <img
            className="popup-brand-mark"
            src={getRuntimeUrl('icons/icon128.png')}
            alt=""
            aria-hidden="true"
          />
          <div>
            <h1>校招表单助手</h1>
            <p>本地识别 · 只填空白 · 不提交</p>
          </div>
        </div>
        <div className="popup-record-actions">
          <button
            type="button"
            className="header-action-button"
            onClick={() => void handleOpenApplicationRecordCreate()}
            disabled={openingApplicationCreate || openingApplicationRecords}
          >
            {openingApplicationCreate ? '打开中...' : '新建投递记录'}
          </button>
          <button
            type="button"
            className="header-action-button header-action-button-secondary"
            onClick={() => void handleOpenApplicationRecords()}
            disabled={openingApplicationCreate || openingApplicationRecords}
          >
            {openingApplicationRecords ? '打开中...' : '打开投递记录'}
          </button>
        </div>
      </header>

      <div className="popup-content">
        {popupLoadError && <p className="resume-profile-selector-error" role="alert">{popupLoadError}</p>}
        {resumeProfiles && (
          <>
            <ResumeProfileSelector
              profiles={resumeProfiles.profiles}
              activeProfileId={resumeProfiles.activeProfileId}
              disabled={interactionDisabled}
              onSwitch={id => void handleProfileSwitch(id)}
            />
            {profileSwitchError && <p className="resume-profile-selector-error" role="alert">{profileSwitchError}</p>}
          </>
        )}
        {profile ? (
          <div className="profile-section">
            <div className="popup-metrics-strip">
              <div className="popup-metric">
                <div className="popup-metric-value">{detectedFields}</div>
                <div className="popup-metric-label">可填字段</div>
              </div>
              <div className="popup-metric">
                <div className="popup-metric-value">{profile.education.length}</div>
                <div className="popup-metric-label">教育经历</div>
              </div>
              <div className="popup-metric">
                <div className="popup-metric-value">{profile.experience.length}</div>
                <div className="popup-metric-label">工作经历</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="popup-empty-state">
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <p className="empty-title">尚未设置个人信息</p>
            <p className="empty-subtitle">完成资料设置后即可开始自动填充</p>
          </div>
        )}

        <div className="popup-actions">
          <button
            onClick={handleFillForm}
            disabled={!profile || interactionDisabled}
            className="button button-primary popup-primary-action"
          >
            {filling ? '填充中...' : '快速填充'}
          </button>

          {/* AI 扫描填充 / AI 框选补填入口按合规要求关闭：本版本只做本地确定性填充。 */}

          <div className="popup-support-actions">
            <button
              onClick={() => void handleOpenSidePanel()}
              disabled={openingView}
              className="button button-secondary"
            >
              {openingView ? '正在打开...' : '打开信息窗口'}
            </button>

            <button
              onClick={() => void handleCopyFillReport()}
              className="button button-quiet popup-settings-action"
            >
              {copyReportState === 'copied' ? '已复制诊断' : copyReportState === 'empty' ? '没有诊断记录' : '复制填充诊断'}
            </button>

            <button onClick={openOptions} className="button button-quiet popup-settings-action">
              设置个人信息
            </button>
          </div>
        </div>

        {profile && pageReport && (
          <FieldLearningPanel
            report={pageReport}
            learnableFields={learnableFields}
            selections={learnSelections}
            savingItemId={savingFieldItemId}
            hint={learningHint}
            error={learningError}
            refilling={refillingBlank}
            refillSummary={refillSummary}
            disabled={interactionDisabled || refillingBlank}
            open={fieldLearningOpen}
            onToggle={() => setFieldLearningOpen(current => !current)}
            onSelect={(itemId, profileKey) => setLearnSelections(current => ({
              ...current,
              [itemId]: profileKey,
            }))}
            onSave={item => void handleLearnField(item)}
            onRefill={() => void handleRefillBlankFields()}
          />
        )}

        {detectedFields === 0 && profile && (
          <div className="popup-hint">
            当前页面未检测到可填充的表单字段
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
