// 面板消息协议 + 工具栏图标 fallback 顺序的单测（background 在 import 时读取 chrome.*，
// 因此先注入 chrome mock，再按带时间戳的 URL 动态导入，避免模块缓存串扰）。

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message, MessageResponse } from '../shared/types.ts';

type FrameResponder = (message: Message, frameId: number) => MessageResponse | undefined;

interface MockOptions {
  frameIds?: number[];
  respond?: FrameResponder;
  sendMessageError?: boolean;
  executeScriptError?: boolean;
}

function installChromeMock(options: MockOptions = {}) {
  const calls = {
    sendMessage: [] as Array<{ message: Message; options?: chrome.tabs.MessageSendOptions }>,
    executeScript: [] as Array<chrome.scripting.ScriptInjection<unknown[], unknown>>,
    createdTabs: [] as string[],
    openedOptions: 0,
    frameScanMessages: 0,
  };
  let sendMessageError = options.sendMessageError === true;
  const actionListeners: Array<(tab: chrome.tabs.Tab) => void> = [];
  const frameIds = options.frameIds ?? [0];

  const chromeMock: Record<string, any> = {
    runtime: {
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      getManifest: () => ({ version: '1.1.0-test' }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      openOptionsPage: async () => {
        calls.openedOptions += 1;
      },
      sendMessage: async () => ({ success: false, error: 'not mocked' }),
    },
    action: {
      onClicked: {
        addListener: (listener: (tab: chrome.tabs.Tab) => void) => {
          actionListeners.push(listener);
        },
      },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
    tabs: {
      get: async (tabId: number) => ({ id: tabId, url: 'https://example.com/apply' }),
      query: async () => [],
      sendMessage: async (
        tabId: number,
        message: Message,
        sendOptions?: chrome.tabs.MessageSendOptions,
      ) => {
        calls.sendMessage.push({ message, options: sendOptions });
        if (sendMessageError) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (message.type === 'PANEL_FRAME_SCAN') calls.frameScanMessages += 1;
        const frameId = Number(sendOptions?.frameId ?? 0);
        return options.respond?.(message, frameId);
      },
      create: async (createProperties: chrome.tabs.CreateProperties) => {
        calls.createdTabs.push(createProperties.url || '');
        return { id: 99 } as chrome.tabs.Tab;
      },
    },
    scripting: {
      executeScript: async (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => {
        calls.executeScript.push(injection);
        if (options.executeScriptError) throw new Error('Cannot access contents of the page');
        return frameIds.map(frameId => ({ frameId, result: true }));
      },
    },
  };

  (globalThis as { chrome?: unknown }).chrome = chromeMock;
  return {
    calls,
    actionListeners,
    setSendMessageError: (value: boolean) => {
      sendMessageError = value;
    },
  };
}

async function importBackground() {
  const moduleUrl = new URL(`../background/index.ts?panel=${Date.now()}-${Math.random()}`, import.meta.url).href;
  return import(moduleUrl) as Promise<{
    handleMessage: (message: Message, sender: chrome.runtime.MessageSender) => Promise<MessageResponse<any>>;
  }>;
}

function panelField(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    frameId: 0,
    label: '姓名',
    section: 'personal',
    sectionName: '基本信息',
    type: 'text',
    status: 'blank',
    blank: true,
    currentValuePresent: false,
    plannedValue: '张三',
    profileLabel: '姓名',
    sensitive: false,
    writable: true,
    ...overrides,
  };
}

test('PANEL_SCAN 汇总各 frame 字段并统一加 frame 前缀与 frameId', async () => {
  const mock = installChromeMock({
    frameIds: [0, 3],
    respond: (message, frameId) => {
      if (message.type !== 'PANEL_FRAME_SCAN') return { success: false };
      if (frameId === 0) {
        return {
          success: true,
          data: {
            frameId: 0,
            detected: 2,
            blockedCount: 1,
            fields: [panelField('f0'), panelField('f1', { status: 'filled', blank: false, writable: false })],
            unmatched: [{ id: 'u0', frameId: 0, label: '备注', section: 'other', sectionName: '其它表单', type: 'textarea', reason: '未识别', blank: true }],
          },
        };
      }
      return {
        success: true,
        data: {
          frameId: 3,
          detected: 1,
          blockedCount: 0,
          fields: [panelField('f0', { label: '嵌入页字段' })],
          unmatched: [],
        },
      };
    },
  });
  const background = await importBackground();
  const response = await background.handleMessage(
    { type: 'PANEL_SCAN' } as Message,
    { tab: { id: 7 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
  );

  assert.equal(response.success, true, response.error);
  const data = response.data!;
  assert.deepEqual(data.fields.map((field: { id: string }) => field.id), [
    'frame-0:f0',
    'frame-0:f1',
    'frame-3:f0',
  ]);
  assert.deepEqual(data.fields.map((field: { frameId: number }) => field.frameId), [0, 0, 3]);
  assert.equal(data.detected, 3);
  assert.equal(data.blockedCount, 1);
  assert.equal(data.unmatched[0].id, 'frame-0:u0');
  assert.equal(data.frames.length, 2);
  assert.equal(mock.calls.frameScanMessages, 2);
});

test('PANEL_SCAN 在浏览器内置页面返回可读错误', async () => {
  installChromeMock();
  const background = await importBackground();
  // 覆盖 tabs.get 返回受限 URL。
  (globalThis as { chrome?: any }).chrome.tabs.get = async (tabId: number) => ({
    id: tabId,
    url: 'chrome://extensions/',
  });

  const response = await background.handleMessage(
    { type: 'PANEL_SCAN' } as Message,
    { tab: { id: 7 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
  );
  assert.equal(response.success, false);
  assert.match(response.error || '', /内置页面|扩展商店/);
});

test('PANEL_FILL_SELECTED 按 frameId 拆分发送，并汇总各 frame 结果与 id 前缀', async () => {
  const mock = installChromeMock({
    frameIds: [0, 3],
    respond: (message, frameId) => {
      if (message.type !== 'PANEL_FRAME_FILL') return { success: false };
      if (frameId === 0) {
        return {
          success: true,
          data: {
            frameId: 0,
            results: [
              { localId: 'f0', outcome: 'filled' },
              { localId: 'f1', outcome: 'skipped-existing' },
            ],
            attempted: 1,
            filled: 1,
            failed: 0,
            skippedExisting: 1,
            skippedBlocked: 0,
            skippedAmbiguous: 0,
            urlBefore: 'https://example.com/apply',
            urlAfter: 'https://example.com/apply',
            urlChanged: false,
            undoAvailable: true,
            autoAddedRows: 0,
          },
        };
      }
      return {
        success: true,
        data: {
          frameId: 3,
          results: [{ localId: 'f0', outcome: 'failed', message: '写入被回滚' }],
          attempted: 1,
          filled: 0,
          failed: 1,
          skippedExisting: 0,
          skippedBlocked: 0,
          skippedAmbiguous: 0,
          urlBefore: 'https://example.com/frame',
          urlAfter: 'https://example.com/frame-2',
          urlChanged: true,
          undoAvailable: false,
          autoAddedRows: 2,
        },
      };
    },
  });
  const background = await importBackground();
  const response = await background.handleMessage(
    {
      type: 'PANEL_FILL_SELECTED',
      payload: {
        fieldIds: ['frame-0:f0', 'frame-0:f1', 'frame-3:f0'],
        options: { allowAutoAddRows: true },
      },
    } as Message,
    { tab: { id: 7 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
  );

  assert.equal(response.success, true, response.error);
  const data = response.data!;
  assert.equal(data.filled, 1);
  assert.equal(data.failed, 1);
  assert.equal(data.skippedExisting, 1);
  assert.equal(data.autoAddedRows, 2);
  assert.equal(data.urlChanged, true);
  assert.equal(data.undoAvailable, true);
  assert.equal(data.notFound, 0);
  assert.deepEqual(data.results.map((item: { fieldId: string }) => item.fieldId), [
    'frame-0:f0',
    'frame-0:f1',
    'frame-3:f0',
  ]);
  assert.deepEqual(data.frames.map((frame: { frameId: number }) => frame.frameId), [0, 3]);

  const frameFillCalls = mock.calls.sendMessage.filter(call => call.message.type === 'PANEL_FRAME_FILL');
  assert.equal(frameFillCalls.length, 2);
  assert.deepEqual(
    frameFillCalls.map(call => (call.message as { payload: { localIds: string[]; allowAutoAddRows: boolean } }).payload),
    [
      { localIds: ['f0', 'f1'], allowAutoAddRows: true },
      { localIds: ['f0'], allowAutoAddRows: true },
    ],
  );
});

test('PANEL_FILL_SELECTED 对未响应的 frame / 无效 id 报告 not-found，而不是静默丢失', async () => {
  installChromeMock({
    frameIds: [0],
    respond: (message) => {
      if (message.type !== 'PANEL_FRAME_FILL') return { success: false };
      return {
        success: true,
        data: {
          frameId: 0,
          results: [],
          attempted: 0,
          filled: 0,
          failed: 0,
          skippedExisting: 0,
          skippedBlocked: 0,
          skippedAmbiguous: 0,
          urlBefore: '',
          urlAfter: '',
          urlChanged: false,
          undoAvailable: false,
          autoAddedRows: 0,
        },
      };
    },
  });
  const background = await importBackground();
  const response = await background.handleMessage(
    {
      type: 'PANEL_FILL_SELECTED',
      payload: { fieldIds: ['frame-0:f0', 'frame-9:f9', 'not-a-field-id'] },
    } as Message,
    { tab: { id: 7 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
  );

  assert.equal(response.success, true, response.error);
  const notFound = response.data!.results.filter((item: { outcome: string }) => item.outcome === 'not-found');
  assert.equal(notFound.length, 2);
  assert.equal(response.data!.notFound, 2);
});

test('PANEL_FILL_SELECTED 拒绝空选择与超量选择', async () => {
  installChromeMock();
  const background = await importBackground();
  const empty = await background.handleMessage(
    { type: 'PANEL_FILL_SELECTED', payload: { fieldIds: [] } } as Message,
    { tab: { id: 7 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
  );
  assert.equal(empty.success, false);
  assert.match(empty.error || '', /没有勾选/);

  const tooMany = await background.handleMessage(
    {
      type: 'PANEL_FILL_SELECTED',
      payload: { fieldIds: Array.from({ length: 301 }, (_, index) => `frame-0:f${index}`) },
    } as Message,
    { tab: { id: 7 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
  );
  assert.equal(tooMany.success, false);
  assert.match(tooMany.error || '', /最多填充/);
});

test('PANEL_UNDO 汇总各 frame 撤销结果并回填 fieldId', async () => {
  installChromeMock({
    frameIds: [0, 3],
    respond: (message, frameId) => {
      if (message.type !== 'PANEL_FRAME_UNDO') return { success: false };
      if (frameId === 0) {
        return {
          success: true,
          data: {
            frameId: 0,
            restored: 1,
            skipped: 0,
            failed: 0,
            entries: [{ localId: 'f0', outcome: 'restored' }],
          },
        };
      }
      return {
        success: true,
        data: {
          frameId: 3,
          restored: 0,
          skipped: 1,
          failed: 0,
          entries: [{ localId: 'f2', outcome: 'skipped', message: '节点已脱离文档' }],
        },
      };
    },
  });
  const background = await importBackground();
  const response = await background.handleMessage(
    { type: 'PANEL_UNDO' } as Message,
    { tab: { id: 7 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
  );

  assert.equal(response.success, true, response.error);
  assert.equal(response.data!.restored, 1);
  assert.equal(response.data!.skipped, 1);
  assert.deepEqual(
    response.data!.entries.map((entry: { fieldId?: string }) => entry.fieldId),
    ['frame-0:f0', 'frame-3:f2'],
  );
  assert.equal(response.data!.frames.length, 2);
});

test('PANEL_OPEN_POPUP 在新标签打开扩展页面（保留投递记录/多简历入口）', async () => {
  const mock = installChromeMock();
  const background = await importBackground();
  const response = await background.handleMessage(
    { type: 'PANEL_OPEN_POPUP' } as Message,
    { tab: { id: 7 } as chrome.tabs.Tab } as chrome.runtime.MessageSender,
  );
  assert.equal(response.success, true, response.error);
  assert.deepEqual(mock.calls.createdTabs, ['chrome-extension://test/src/popup/index.html']);
});

test('工具栏图标：已注入时直接通知内容脚本切换面板', async () => {
  const mock = installChromeMock({
    respond: message => (message.type === 'PANEL_TOGGLE' ? { success: true, data: { visible: true } } : undefined),
  });
  await importBackground();
  const listener = mock.actionListeners[0];
  assert.ok(listener, '应注册 chrome.action.onClicked 监听器');

  listener({ id: 7, url: 'https://example.com/apply' } as chrome.tabs.Tab);
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(mock.calls.executeScript.length, 0);
  assert.equal(mock.calls.openedOptions, 0);
  const toggles = mock.calls.sendMessage.filter(call => call.message.type === 'PANEL_TOGGLE');
  assert.equal(toggles.length, 1);
  assert.equal(toggles[0].options?.frameId, 0);
});

test('工具栏图标：内容脚本未注入时先注入 content.js 再重试；仍失败回退选项页', async () => {
  const mock = installChromeMock({
    respond: message => (message.type === 'PANEL_TOGGLE' ? { success: true, data: { visible: true } } : undefined),
  });
  mock.setSendMessageError(true);
  await importBackground();
  const listener = mock.actionListeners[0];

  // 首次 sendMessage 失败 → 注入 → 重试成功。
  await (async () => {
    let failedOnce = false;
    (globalThis as { chrome?: any }).chrome.tabs.sendMessage = async () => {
      if (!failedOnce) {
        failedOnce = true;
        throw new Error('Receiving end does not exist');
      }
      return { success: true, data: { visible: true } };
    };
    listener({ id: 7, url: 'https://example.com/apply' } as chrome.tabs.Tab);
    await new Promise(resolve => setTimeout(resolve, 20));
  })();

  assert.equal(mock.calls.executeScript.length, 1);
  const injection = mock.calls.executeScript[0];
  assert.deepEqual(injection.files, ['content.js']);
  assert.deepEqual(injection.target, { tabId: 7, frameIds: [0] });
  assert.equal(mock.calls.openedOptions, 0);
});

test('工具栏图标：受限页面/注入失败时回退打开选项页（不静默失败）', async () => {
  const mock = installChromeMock({ executeScriptError: true });
  mock.setSendMessageError(true);
  await importBackground();
  const listener = mock.actionListeners[0];

  listener({ id: 7, url: 'https://example.com/apply' } as chrome.tabs.Tab);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(mock.calls.openedOptions, 1, '注入失败后应打开选项页');

  listener({ id: 7, url: 'chrome://extensions/' } as chrome.tabs.Tab);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(mock.calls.openedOptions, 2, '受限页面应直接回退选项页');
  assert.equal(mock.calls.executeScript.length, 1);
});
