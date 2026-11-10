// 跨浏览器共享纯函数测试：全部使用合成数据，不包含任何真实个人信息。
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  buildShareDocument,
  buildSyncSummary,
  computeSyncDecision,
  createEmptyShareMetadata,
  hasShareBaseline,
  normalizeShareMetadata,
  parseShareDocument,
  serializeShareDocument,
  sha256BusinessData,
  sha256Hex,
  type ShareFileMetadata,
  type ShareLocalInfo,
  type ShareRemoteInfo,
} from './crossBrowserShare.ts';
import { stableStringifyBusinessData } from './sync.ts';
import { createBackupDocument, serializeBackup } from './backup.ts';
import { StorageService } from './storage.ts';
import { CrossBrowserShareSection } from '../options/CrossBrowserShareSection.tsx';
import type { BackupData, Message, MessageResponse, UserProfile } from './types.ts';

(globalThis as typeof globalThis & {
  React?: typeof React;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const syntheticEducation = {
  id: 'edu-1',
  school: '合成大学',
  major: '合成专业',
  degree: '本科',
  startDate: '2018-09',
  endDate: '2022-06',
};

const syntheticProfile: UserProfile = {
  personal: {
    name: '合成姓名甲',
    gender: '男',
    birthDate: '2000-01',
    phone: '13900000001',
    email: 'synthetic@example.com',
  },
  education: [syntheticEducation],
  experience: [{
    id: 'exp-1',
    company: '合成公司',
    position: '合成实习岗位',
    startDate: '2021-07',
    endDate: '2021-09',
    description: '合成经历描述',
  }],
  projects: [{
    id: 'project-1',
    name: '合成项目',
    role: '负责人',
    startDate: '2020-01',
    endDate: '2020-06',
    description: '合成项目描述',
  }],
  awards: [{ id: 'award-1', name: '合成奖项', role: '', date: '2021-01', description: '' }],
  customInformation: [{ id: 'custom-1', name: '合成自定义信息', content: '合成内容' }],
  skills: ['合成技能甲', '合成技能乙'],
  certifications: [{ id: 'cert-1', name: '合成证书', issuer: '合成机构', date: '2022-01' }],
  resume: {
    fileName: 'synthetic-resume.pdf',
    fileData: 'data:application/pdf;base64,QUJD',
    fileType: 'pdf',
    uploadDate: '2026-01-01T00:00:00.000Z',
  },
};

const secondProfile: UserProfile = {
  ...syntheticProfile,
  education: [syntheticEducation, { ...syntheticEducation, id: 'edu-2' }],
};

const sampleData: BackupData = {
  resumeProfileLibrary: {
    schemaVersion: 1,
    activeProfileId: 'profile-1',
    profiles: [
      {
        id: 'profile-1',
        name: '默认简历',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        profile: syntheticProfile,
      },
      {
        id: 'profile-2',
        name: '第二份简历',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        profile: secondProfile,
      },
    ],
  },
  llmConfig: {
    provider: 'deepseek' as never,
    apiKey: 'sk-synthetic-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'synthetic-model',
  },
  settings: { locale: 'zh-CN', theme: 'light' },
  applicationRecords: [{
    id: 'record-1',
    companyName: '合成投递公司',
    jobTitle: '合成岗位',
    sourceSite: 'synthetic.example.com',
    sourceUrl: 'https://synthetic.example.com/job/1',
    status: '已投递',
    notes: '合成备注',
    appliedAt: '2026-01-04',
    location: '合成城市',
    createdAt: '2026-01-04T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
  }],
};

const summary = buildSyncSummary(sampleData);

const SHARE_SAVED_AT = '2026-02-01T08:00:00.000Z';

function shareJson(data: BackupData = sampleData) {
  return serializeShareDocument(buildShareDocument(data, {
    extensionVersion: '1.2.0',
    savedAt: SHARE_SAVED_AT,
  }));
}

test('buildShareDocument 生成 BackupDocument v2 并附加 savedAt/来源版本', () => {
  const document = buildShareDocument(sampleData, {
    extensionVersion: '1.2.0',
    savedAt: SHARE_SAVED_AT,
  });
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.exportedAt, SHARE_SAVED_AT);
  assert.equal(document.savedAt, SHARE_SAVED_AT);
  assert.equal(document.sourceExtensionVersion, '1.2.0');
  assert.equal(document.source.extensionVersion, '1.2.0');
  assert.equal(document.data.resumeProfileLibrary.profiles.length, 2);
  // 共享文件不包含 WebDAV 凭据（本地导入时保留各自浏览器已有配置）。
  assert.equal(document.webdavConfig, undefined);
  assert.equal(Object.hasOwn(document, 'webdavConfig'), false);
});

test('serialize → parse 往返保留业务数据、savedAt 与来源版本', async () => {
  const parsed = parseShareDocument(shareJson());
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.document.savedAt, SHARE_SAVED_AT);
  assert.equal(parsed.document.sourceExtensionVersion, '1.2.0');
  assert.equal(parsed.document.webdavConfig, undefined);
  // 共享文件写入后回读的哈希必须与本地一致，否则同步基线无法建立。
  assert.equal(await sha256BusinessData(parsed.data), await sha256BusinessData(sampleData));
  assert.deepEqual(parsed.summary, summary);
});

test('parse 摘要包含各模块条数且只含计数/时间/布尔值', () => {
  const parsed = parseShareDocument(shareJson());
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.summary, {
    profileCount: 2,
    educationCount: 3,
    experienceCount: 2,
    projectCount: 2,
    awardCount: 2,
    certificationCount: 2,
    skillCount: 4,
    customInformationCount: 2,
    applicationRecordCount: 1,
    hasResumeFile: true,
    hasLLMConfig: true,
    hasApiKey: true,
    latestUpdatedAt: '2026-01-03T00:00:00.000Z',
  });
  for (const value of Object.values(parsed.summary)) {
    assert.ok(value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string');
  }
  const serialized = JSON.stringify(parsed.summary);
  for (const personalValue of [
    '合成姓名甲',
    '13900000001',
    'synthetic@example.com',
    '合成大学',
    '合成公司',
    '合成项目',
    '合成技能甲',
    '合成投递公司',
    'sk-synthetic-key',
  ]) {
    assert.equal(serialized.includes(personalValue), false, `摘要不应包含资料值：${personalValue}`);
  }
});

for (const [name, raw, code] of [
  ['空字符串', '', 'EMPTY_FILE'],
  ['只有空白', '   \n\t  ', 'EMPTY_FILE'],
  ['损坏的 JSON', '{"schemaVersion":2,', 'INVALID_JSON'],
  ['根节点为数组', '[]', 'INVALID_ROOT'],
  ['缺少 schemaVersion', '{}', 'MISSING_SCHEMA_VERSION'],
  ['未来版本', JSON.stringify({ schemaVersion: 3 }), 'UNSUPPORTED_FUTURE_VERSION'],
] as const) {
  test(`parseShareDocument 拒绝${name}`, () => {
    const parsed = parseShareDocument(raw);
    assert.equal(parsed.success, false);
    if (parsed.success) return;
    assert.equal(parsed.error.code, code);
    assert.equal(typeof parsed.error.message, 'string');
    assert.ok(parsed.error.message.length > 0);
  });
}

test('parse 兼容 v1 备份文档（剪贴板跨版本粘贴）', () => {
  const v1Json = JSON.stringify({
    schemaVersion: 1,
    exportedAt: '2025-12-01T00:00:00.000Z',
    source: { extensionVersion: '1.0.0' },
    data: {
      userProfile: syntheticProfile,
      llmConfig: sampleData.llmConfig,
      settings: sampleData.settings,
    },
  });
  const parsed = parseShareDocument(v1Json);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.document.schemaVersion, 2);
  assert.equal(parsed.summary.profileCount, 1);
  assert.equal(parsed.summary.educationCount, 1);
  // 旧备份没有 savedAt：回退到 exportedAt。
  assert.equal(parsed.document.savedAt, '2025-12-01T00:00:00.000Z');
  assert.equal(parsed.document.sourceExtensionVersion, '1.0.0');
});

test('parse 对缺少 savedAt/sourceExtensionVersion 的纯备份文档回退到备份字段', () => {
  const backupJson = serializeBackup(createBackupDocument(
    sampleData,
    '1.1.0',
    '2026-01-05T00:00:00.000Z',
  ));
  const parsed = parseShareDocument(backupJson);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.document.savedAt, '2026-01-05T00:00:00.000Z');
  assert.equal(parsed.document.sourceExtensionVersion, '1.1.0');
});

test('sha256Hex 与标准 SHA-256 向量一致', async () => {
  assert.equal(
    await sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.match(await sha256Hex('校招表单助手'), /^[0-9a-f]{64}$/);
});

test('sha256BusinessData 与 WebDAV 业务哈希一致且与对象键顺序无关', async () => {
  const reordered = {
    applicationRecords: sampleData.applicationRecords,
    settings: { theme: 'light', locale: 'zh-CN' },
    llmConfig: {
      model: 'synthetic-model',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-synthetic-key',
      provider: 'deepseek' as never,
    },
    resumeProfileLibrary: sampleData.resumeProfileLibrary,
  } as BackupData;
  assert.equal(
    await sha256BusinessData(reordered),
    await sha256BusinessData(sampleData),
  );
  assert.equal(
    await sha256BusinessData(sampleData),
    await sha256Hex(stableStringifyBusinessData(sampleData)),
  );
  assert.notEqual(
    await sha256BusinessData({
      ...sampleData,
      settings: { ...sampleData.settings, theme: 'dark' },
    }),
    await sha256BusinessData(sampleData),
  );
});

test('normalizeShareMetadata 清洗非法值', () => {
  assert.deepEqual(normalizeShareMetadata(undefined), createEmptyShareMetadata());
  assert.deepEqual(normalizeShareMetadata('garbage'), createEmptyShareMetadata());
  assert.deepEqual(
    normalizeShareMetadata({
      fileLabel: '  ',
      lastSyncedAt: 'not-a-date',
      lastLocalHash: 'abc',
      lastRemoteHash: 42,
      permissionState: 'weird',
    }),
    createEmptyShareMetadata(),
  );
  const localHash = 'a'.repeat(64);
  const remoteHash = 'b'.repeat(64);
  assert.deepEqual(
    normalizeShareMetadata({
      fileLabel: SHARE_SAVED_AT,
      lastSyncedAt: SHARE_SAVED_AT,
      lastLocalHash: localHash,
      lastRemoteHash: remoteHash,
      lastRemoteSavedAt: SHARE_SAVED_AT,
      permissionState: 'granted',
    }),
    {
      fileLabel: SHARE_SAVED_AT,
      lastSyncedAt: SHARE_SAVED_AT,
      lastLocalHash: localHash,
      lastRemoteHash: remoteHash,
      lastRemoteSavedAt: SHARE_SAVED_AT,
      permissionState: 'granted',
    },
  );
});

test('hasShareBaseline 只在本地/远端哈希都齐全时为真', () => {
  assert.equal(hasShareBaseline(null), false);
  assert.equal(hasShareBaseline(createEmptyShareMetadata('share.json', 'granted')), false);
  assert.equal(hasShareBaseline({
    ...createEmptyShareMetadata('share.json', 'granted'),
    lastLocalHash: 'a'.repeat(64),
  }), false);
  assert.equal(hasShareBaseline({
    ...createEmptyShareMetadata('share.json', 'granted'),
    lastLocalHash: 'a'.repeat(64),
    lastRemoteHash: 'b'.repeat(64),
  }), true);
});

// —— 决策矩阵 ——
const LOCAL_OLD = 'a'.repeat(64);
const LOCAL_NEW = 'b'.repeat(64);
const REMOTE_OLD = 'c'.repeat(64);
const REMOTE_NEW = 'd'.repeat(64);
const REMOTE_SAVED_AT = '2026-01-04T00:00:00.000Z';

function baselineMetadata(overrides: Partial<ShareFileMetadata> = {}): ShareFileMetadata {
  return {
    ...createEmptyShareMetadata('campus-form-agent-share.json', 'granted'),
    lastSyncedAt: '2026-01-05T00:00:00.000Z',
    lastLocalHash: LOCAL_OLD,
    lastRemoteHash: REMOTE_OLD,
    lastRemoteSavedAt: REMOTE_SAVED_AT,
    ...overrides,
  };
}

function localInfo(hash: string): ShareLocalInfo {
  return { hash, updatedAt: '2026-01-06T00:00:00.000Z', summary };
}

function remoteInfo(overrides: Partial<ShareRemoteInfo> = {}): ShareRemoteInfo {
  return {
    exists: true,
    hash: REMOTE_OLD,
    savedAt: REMOTE_SAVED_AT,
    summary,
    ...overrides,
  };
}

const decisionCases: Array<{
  name: string;
  meta: ShareFileMetadata | null;
  local: ShareLocalInfo;
  remote: ShareRemoteInfo;
  action: string;
  reason: string;
}> = [
  {
    name: '首次绑定、共享文件不存在 → 写入本地',
    meta: null,
    local: localInfo(LOCAL_NEW),
    remote: remoteInfo({ exists: false, hash: null, savedAt: null, summary: null }),
    action: 'upload',
    reason: 'first-write',
  },
  {
    name: '首次绑定、共享文件为空 → 写入本地',
    meta: createEmptyShareMetadata('campus-form-agent-share.json', 'granted'),
    local: localInfo(LOCAL_NEW),
    remote: remoteInfo({ hash: null, savedAt: null, summary: null }),
    action: 'upload',
    reason: 'first-write',
  },
  {
    name: '首次绑定、双方内容一致 → 无操作',
    meta: null,
    local: localInfo(LOCAL_NEW),
    remote: remoteInfo({ hash: LOCAL_NEW }),
    action: 'noop',
    reason: 'identical-content',
  },
  {
    name: '首次绑定、内容不同 → 冲突（不覆盖任何一方）',
    meta: createEmptyShareMetadata('campus-form-agent-share.json', 'granted'),
    local: localInfo(LOCAL_NEW),
    remote: remoteInfo({ hash: REMOTE_NEW }),
    action: 'conflict',
    reason: 'first-bind',
  },
  {
    name: '已建立基线、双方未变 → 无操作',
    meta: baselineMetadata(),
    local: localInfo(LOCAL_OLD),
    remote: remoteInfo(),
    action: 'noop',
    reason: 'in-sync',
  },
  {
    name: '仅本地变化 → 写入共享文件',
    meta: baselineMetadata(),
    local: localInfo(LOCAL_NEW),
    remote: remoteInfo(),
    action: 'upload',
    reason: 'local-changed',
  },
  {
    name: '仅共享文件变化 → 下载到本地',
    meta: baselineMetadata(),
    local: localInfo(LOCAL_OLD),
    remote: remoteInfo({ hash: REMOTE_NEW }),
    action: 'download',
    reason: 'remote-changed',
  },
  {
    name: '双方都变化 → 冲突',
    meta: baselineMetadata(),
    local: localInfo(LOCAL_NEW),
    remote: remoteInfo({ hash: REMOTE_NEW }),
    action: 'conflict',
    reason: 'both-changed',
  },
  {
    name: '已同步过的共享文件被删除 → 冲突、不自动重建',
    meta: baselineMetadata(),
    local: localInfo(LOCAL_NEW),
    remote: remoteInfo({ exists: false, hash: null, savedAt: null, summary: null }),
    action: 'conflict',
    reason: 'remote-file-missing',
  },
  {
    name: '已同步过的共享文件被清空 → 冲突',
    meta: baselineMetadata(),
    local: localInfo(LOCAL_OLD),
    remote: remoteInfo({ hash: null, savedAt: null, summary: null }),
    action: 'conflict',
    reason: 'remote-file-empty',
  },
  {
    name: '只有 lastSyncedAt、没有基线哈希 → 删除文件视为冲突',
    meta: baselineMetadata({ lastLocalHash: null, lastRemoteHash: null }),
    local: localInfo(LOCAL_OLD),
    remote: remoteInfo({ exists: false, hash: null, savedAt: null, summary: null }),
    action: 'conflict',
    reason: 'remote-file-missing',
  },
];

for (const decisionCase of decisionCases) {
  test(`computeSyncDecision：${decisionCase.name}`, () => {
    const decision = computeSyncDecision(decisionCase.meta, decisionCase.local, decisionCase.remote);
    assert.equal(decision.action, decisionCase.action);
    assert.equal(decision.reason, decisionCase.reason);
    assert.equal(typeof decision.message, 'string');
    assert.ok(decision.message.length > 0);
    // 决策消息只描述方向，不包含任何资料值。
    for (const personalValue of ['合成姓名甲', '13900000001', '合成大学']) {
      assert.equal(decision.message.includes(personalValue), false);
    }
  });
}

test('computeSyncDecision 内容相同时优先 noop（即使旧基线不同）', () => {
  const decision = computeSyncDecision(
    baselineMetadata({ lastLocalHash: LOCAL_OLD, lastRemoteHash: REMOTE_OLD }),
    localInfo(REMOTE_NEW),
    remoteInfo({ hash: REMOTE_NEW }),
  );
  assert.equal(decision.action, 'noop');
  assert.equal(decision.reason, 'identical-content');
});

test('computeSyncDecision 空内容判定不受空白影响', () => {
  const parsedEmpty = parseShareDocument('  \n ');
  assert.equal(parsedEmpty.success, false);
  if (!parsedEmpty.success) assert.equal(parsedEmpty.error.code, 'EMPTY_FILE');
});

// —— 新增后台消息 EXPORT_BACKUP_JSON（返回 JSON 字符串，不触发下载） ——
function installChromeMock() {
  const chromeMock: Record<string, unknown> = {
    runtime: {
      onMessage: { addListener: () => undefined },
      onInstalled: { addListener: () => undefined },
      getManifest: () => ({ version: '1.2.0-test' }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      openOptionsPage: async () => undefined,
    },
    action: { onClicked: { addListener: () => undefined } },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      },
    },
    tabs: {
      query: async () => [],
      get: async () => ({}),
      sendMessage: async () => ({ success: false }),
      create: async () => ({ id: 1 }),
    },
    scripting: { executeScript: async () => [] },
  };
  (globalThis as { chrome?: unknown }).chrome = chromeMock;
}

test('EXPORT_BACKUP_JSON 返回 JSON 字符串；共享文件模式不携带 WebDAV 凭据', async () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const originalGetBackupData = StorageService.getBackupData;
  const originalGetWebDAVConfig = StorageService.getWebDAVConfig;
  installChromeMock();
  StorageService.getBackupData = async () => structuredClone(sampleData);
  StorageService.getWebDAVConfig = async () => ({
    enabled: true,
    serverUrl: 'https://dav.example.com/',
    username: 'synthetic-user',
    password: 'synthetic-webdav-password',
  });
  try {
    const moduleUrl = new URL(
      `../background/index.ts?share=${Date.now()}-${Math.random()}`,
      import.meta.url,
    ).href;
    const background = await import(moduleUrl) as {
      handleMessage: (
        message: Message,
        sender: chrome.runtime.MessageSender,
      ) => Promise<MessageResponse>;
    };
    const sender = {} as chrome.runtime.MessageSender;

    const shareResponse = await background.handleMessage(
      { type: 'EXPORT_BACKUP_JSON', payload: { includeWebDAVConfig: false } },
      sender,
    );
    assert.equal(shareResponse.success, true);
    const sharePayload = shareResponse.data as { json?: unknown; filename?: unknown } | undefined;
    assert.equal(typeof sharePayload?.json, 'string');
    // 不返回下载文件名：复制到剪贴板而不是触发下载。
    assert.equal(sharePayload?.filename, undefined);
    const shareJson = String(sharePayload?.json ?? '');
    assert.equal(shareJson.includes('synthetic-webdav-password'), false);
    const parsedShare = parseShareDocument(shareJson);
    assert.equal(parsedShare.success, true);
    if (!parsedShare.success) return;
    assert.equal(parsedShare.document.webdavConfig, undefined);
    assert.equal(parsedShare.document.source.extensionVersion, '1.2.0-test');
    assert.equal(parsedShare.summary.profileCount, 2);

    const clipboardResponse = await background.handleMessage({ type: 'EXPORT_BACKUP_JSON' }, sender);
    assert.equal(clipboardResponse.success, true);
    const clipboardJson = String(
      (clipboardResponse.data as { json?: unknown } | undefined)?.json ?? '',
    );
    // 剪贴板路径与“导出完整数据”一致：包含 WebDAV 配置，便于另一个浏览器恢复同步设置。
    assert.equal(clipboardJson.includes('synthetic-webdav-password'), true);
    assert.equal(parseShareDocument(clipboardJson).success, true);
  } finally {
    StorageService.getBackupData = originalGetBackupData;
    StorageService.getWebDAVConfig = originalGetWebDAVConfig;
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }
});

// —— 设置页区块渲染冒烟：非 Chromium（无 FSA）只保留剪贴板方式 ——
test('不支持 FSA 的浏览器显示剪贴板方式，共享文件区块给出不可用说明', async () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = undefined;
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CrossBrowserShareSection, { onDataChanged: () => undefined }),
      );
    });
    const root = renderer.root;
    const text = root
      .findAll(node => typeof node.type === 'string')
      .flatMap(node => node.children)
      .filter((child): child is string => typeof child === 'string')
      .join(' ');
    assert.match(text, /快速共享（剪贴板）/);
    assert.match(text, /粘贴导入/);
    assert.match(text, /共享文件（自动同步，推荐）/);
    assert.match(text, /当前浏览器不支持 File System Access API/);
    const buttons = root.findAllByType('button').flatMap(button => button.children);
    assert.ok(buttons.includes('复制整套资料'));
    assert.ok(!buttons.includes('新建共享文件'));
    assert.ok(!buttons.includes('选择已有共享文件'));
  } finally {
    if (renderer) await act(async () => renderer?.unmount());
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});


