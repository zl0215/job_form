// 消息层测试：SAVE_FIELD_ALIAS 持久化到活动简历；GET_PAGE_FIELD_REPORT 汇总 content 响应。
// background 模块在 import 时访问 chrome.*，因此先注入最小 chrome mock 再动态导入。
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message, MessageResponse, ResumeProfileLibrary, SaveFieldAliasResult, UserProfile } from '../shared/types.ts';
import { createEmptyUserProfile, normalizeResumeProfileLibrary } from '../shared/resumeProfiles.ts';
import { STORAGE_KEYS } from '../shared/storage.ts';
import { buildProfileAnswerCandidates } from '../shared/profileAnswerCandidates.ts';

const store = new Map<string, unknown>();

function readKeys(keys: unknown): Record<string, unknown> {
  if (typeof keys === 'string') {
    return store.has(keys) ? { [keys]: store.get(keys) } : {};
  }
  if (Array.isArray(keys)) {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key === 'string' && store.has(key)) result[key] = store.get(key);
    }
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of store.entries()) result[key] = value;
  return result;
}

const chromeMock: Record<string, any> = {
  runtime: {
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    getManifest: () => ({ version: '1.0.0' }),
  },
  storage: {
    local: {
      get: async (keys: unknown) => readKeys(keys),
      set: async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) store.set(key, value);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      },
    },
  },
  tabs: {
    get: async (tabId: number) => ({ id: tabId, url: 'https://example.com/apply' }),
    query: async () => [],
    sendMessage: async () => ({ success: false, error: 'not mocked' }),
  },
  scripting: {
    executeScript: async () => [{ frameId: 0 }],
  },
};

(globalThis as { chrome?: unknown }).chrome = chromeMock;

const { handleMessage } = await import('../background/index.ts');

function activeProfileFixture(): UserProfile {
  const profile = createEmptyUserProfile();
  profile.personal.name = '测试用户';
  profile.personal.phone = '13800138000';
  return profile;
}

function seedActiveProfile(profile: UserProfile = activeProfileFixture()): ResumeProfileLibrary {
  const library = normalizeResumeProfileLibrary(undefined, profile);
  store.set(STORAGE_KEYS.RESUME_PROFILE_LIBRARY, library);
  return library;
}

function storedActiveProfile(): UserProfile {
  const library = store.get(STORAGE_KEYS.RESUME_PROFILE_LIBRARY) as ResumeProfileLibrary;
  const active = library.profiles.find(item => item.id === library.activeProfileId);
  assert.ok(active, '活动简历应当存在');
  return active.profile;
}

function message<T>(current: Message): Promise<MessageResponse<T>> {
  return handleMessage(current, {} as chrome.runtime.MessageSender) as Promise<MessageResponse<T>>;
}

test('SAVE_FIELD_ALIAS 把别名写入活动简历的 fieldAliasOverrides 并持久化', async () => {
  store.clear();
  seedActiveProfile();

  const response = await message<SaveFieldAliasResult>({
    type: 'SAVE_FIELD_ALIAS',
    payload: { profileKey: 'personal.phone', alias: '备用联络通道' },
  });

  assert.equal(response.success, true, response.error);
  const data = response.data!;
  assert.equal(data.saved, true);
  assert.equal(data.profileKey, 'personal.phone');
  assert.equal(data.alias, '备用联络通道');
  assert.equal(data.alreadyExists, false);
  assert.equal(data.keyAliasCount, 1);
  assert.equal(data.totalAliasCount, 1);

  const persisted = storedActiveProfile();
  assert.deepEqual(persisted.fieldAliasOverrides?.['personal.phone']?.added, ['备用联络通道']);
  assert.equal(persisted.fieldAliasOverrides?.['education.school'], undefined);
});

test('SAVE_FIELD_ALIAS 重复保存同一别名不重复写入', async () => {
  store.clear();
  seedActiveProfile();

  await message<SaveFieldAliasResult>({
    type: 'SAVE_FIELD_ALIAS',
    payload: { profileKey: 'personal.phone', alias: '备用联络通道' },
  });
  const second = await message<SaveFieldAliasResult>({
    type: 'SAVE_FIELD_ALIAS',
    payload: { profileKey: 'personal.phone', alias: '  备用 联络通道 ' },
  });

  assert.equal(second.success, true, second.error);
  assert.equal(second.data!.alreadyExists, true);
  assert.equal(second.data!.keyAliasCount, 1);
  assert.equal(second.data!.totalAliasCount, 1);
  assert.deepEqual(storedActiveProfile().fieldAliasOverrides?.['personal.phone']?.added, ['备用联络通道']);
});

test('SAVE_FIELD_ALIAS 拒绝禁止字段：不写库并返回可读原因', async () => {
  store.clear();
  seedActiveProfile();

  for (const alias of ['验证码', '确认密码', '内推码']) {
    const response = await message<SaveFieldAliasResult>({
      type: 'SAVE_FIELD_ALIAS',
      payload: { profileKey: 'personal.phone', alias },
    });
    assert.equal(response.success, false, alias);
    assert.match(response.error || '', /禁止自动填写/, alias);
  }

  const persisted = storedActiveProfile();
  assert.equal(persisted.fieldAliasOverrides, undefined);
});

test('SAVE_FIELD_ALIAS 拒绝不存在的资料 key，且校验发生在写库前', async () => {
  store.clear();
  seedActiveProfile();

  const response = await message<SaveFieldAliasResult>({
    type: 'SAVE_FIELD_ALIAS',
    payload: { profileKey: 'no.such.key', alias: '备用联络通道' },
  });
  assert.equal(response.success, false);
  assert.match(response.error || '', /资料字段不存在/);
  assert.equal(storedActiveProfile().fieldAliasOverrides, undefined);
});

test('SAVE_FIELD_ALIAS 保存后别名进入候选别名列表（下次自动命中）', async () => {
  store.clear();
  seedActiveProfile();

  await message<SaveFieldAliasResult>({
    type: 'SAVE_FIELD_ALIAS',
    payload: { profileKey: 'personal.phone', alias: '备用联络通道' },
  });

  const profile = storedActiveProfile();
  const candidate = buildProfileAnswerCandidates(profile, profile.fieldAliasOverrides)
    .find(item => item.key === 'personal.phone');
  assert.ok(candidate);
  assert.ok(candidate.aliases.includes('备用联络通道'));
  // 其它模块的候选不受影响
  const school = buildProfileAnswerCandidates(profile, profile.fieldAliasOverrides)
    .find(item => item.key === 'education.school');
  assert.ok(school);
  assert.equal(school.aliases.includes('备用联络通道'), false);
});

test('GET_PAGE_FIELD_REPORT 汇总各 frame 报告并加 frameId 前缀', async () => {
  store.clear();
  const frameReport = {
    detected: 3,
    matched: 1,
    unmatched: [{
      id: '0',
      label: '备用联络通道',
      suggestedAlias: '备用联络通道',
      section: '基本信息',
      module: '',
      type: 'text',
      options: [],
      reason: '没有唯一可靠规则',
      blank: true,
      learnable: true,
    }],
    matchedFields: [{ label: '姓名', targetLabel: '姓名' }],
    blocked: [],
    blockedCount: 0,
  };
  chromeMock.tabs.get = async (tabId: number) => ({ id: tabId, url: 'https://example.com/apply' });
  chromeMock.scripting.executeScript = async () => [{ frameId: 0 }];
  chromeMock.tabs.sendMessage = async () => ({ success: true, data: frameReport });

  const response = await message<{
    detected: number;
    matched: number;
    unmatched: Array<{ id: string; label: string }>;
    blockedCount: number;
    frames: Array<{ frameId: number }>;
  }>({ type: 'GET_PAGE_FIELD_REPORT', payload: { tabId: 9 } });

  assert.equal(response.success, true, response.error);
  assert.equal(response.data!.detected, 3);
  assert.equal(response.data!.matched, 1);
  assert.equal(response.data!.unmatched[0].id, '0:0');
  assert.equal(response.data!.unmatched[0].label, '备用联络通道');
  assert.equal(response.data!.blockedCount, 0);
  assert.equal(response.data!.frames[0].frameId, 0);
});

test('GET_PAGE_FIELD_REPORT 在 content 无响应时返回可读错误', async () => {
  store.clear();
  chromeMock.tabs.get = async (tabId: number) => ({ id: tabId, url: 'https://example.com/apply' });
  chromeMock.scripting.executeScript = async () => [{ frameId: 0 }];
  chromeMock.tabs.sendMessage = async () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };

  const response = await message<unknown>({ type: 'GET_PAGE_FIELD_REPORT', payload: { tabId: 9 } });
  assert.equal(response.success, false);
  assert.match(response.error || '', /无法读取当前页面的表单字段/);
});

test('GET_PAGE_FIELD_REPORT 拒绝浏览器内置页面', async () => {
  store.clear();
  chromeMock.tabs.get = async (tabId: number) => ({ id: tabId, url: 'chrome://extensions' });
  chromeMock.tabs.sendMessage = async () => ({ success: false, error: 'should not be called' });

  const response = await message<unknown>({ type: 'GET_PAGE_FIELD_REPORT', payload: { tabId: 9 } });
  assert.equal(response.success, false);
  assert.match(response.error || '', /浏览器内置页面/);
});
