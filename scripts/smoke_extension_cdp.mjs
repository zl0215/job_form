#!/usr/bin/env node
// 隔离浏览器冒烟测试：用临时 user-data-dir 启动 Microsoft Edge，加载 extension-src/dist，
// 通过 CDP 检查：
//   1) 扩展被浏览器加载（MV3 service worker 目标出现，manifest name/version 与 dist 一致）；
//   2) service worker 已注册（registration scope 指向 chrome-extension://<id>/）；
//   3) options / popup 页面可打开，标题非空，无未捕获异常（Runtime.exceptionThrown）。
//
// 安全边界：
//   - 只使用系统临时目录下的新建 user-data-dir，绝不读取/写入用户默认 Edge 配置；
//   - 不连接、不重启用户正在运行的 Edge；
//   - 不访问任何真实招聘页，不填写/提交表单；本冒烟不代表真实页端到端验收；
//   - 结束后按 PID 树关闭自己启动的临时 Edge 实例，并删除临时配置目录（--keep-temp 可保留）。
//
// 用法：
//   node scripts/smoke_extension_cdp.mjs                    # 自动：先 headless，扩展未加载则退回隔离的非 headless
//   node scripts/smoke_extension_cdp.mjs --mode headless    # 只用 headless
//   node scripts/smoke_extension_cdp.mjs --mode headed      # 只用隔离的非 headless 窗口
//   node scripts/smoke_extension_cdp.mjs --dist <dir> --browser <msedge.exe> --keep-temp
//
// 输出：stdout 为 JSON 结果；stderr 为人类可读进度。退出码：0 = 通过；1 = 失败/超时。
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const DEFAULT_EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEFAULT_DIST = join(repoRoot, 'extension-src', 'dist');
const TEMP_PREFIX = 'cfa-extension-smoke-';

// ---------- 参数 ----------
const options = {
  mode: 'auto',
  dist: DEFAULT_DIST,
  browser: process.env.EDGE_PATH || DEFAULT_EDGE,
  keepTemp: false,
  launchTimeoutMs: 30000,
  discoveryTimeoutMs: 20000,
  pageTimeoutMs: 20000,
  commandTimeoutMs: 15000,
};
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i];
  if (arg === '--mode') options.mode = String(rawArgs[++i] || '').toLowerCase();
  else if (arg === '--dist') options.dist = resolve(rawArgs[++i] || '');
  else if (arg === '--browser') options.browser = resolve(rawArgs[++i] || '');
  else if (arg === '--keep-temp') options.keepTemp = true;
  else if (arg === '--launch-timeout') options.launchTimeoutMs = Number(rawArgs[++i]);
  else if (arg === '--timeout') {
    const value = Number(rawArgs[++i]);
    options.launchTimeoutMs = value;
    options.discoveryTimeoutMs = value;
    options.pageTimeoutMs = value;
  } else if (arg === '--help' || arg === '-h') {
    console.log('用法: node scripts/smoke_extension_cdp.mjs [--mode auto|headless|headed] [--dist <dir>] [--browser <msedge.exe>] [--timeout <ms>] [--keep-temp]');
    process.exit(0);
  } else {
    fatal(`未知参数: ${arg}`);
  }
}
if (!['auto', 'headless', 'headed'].includes(options.mode)) fatal(`--mode 只支持 auto|headless|headed，收到: ${options.mode}`);
if (!Number.isFinite(options.launchTimeoutMs) || options.launchTimeoutMs <= 0) options.launchTimeoutMs = 30000;
if (!Number.isFinite(options.discoveryTimeoutMs) || options.discoveryTimeoutMs <= 0) options.discoveryTimeoutMs = 20000;
if (!Number.isFinite(options.pageTimeoutMs) || options.pageTimeoutMs <= 0) options.pageTimeoutMs = 20000;
if (!Number.isFinite(options.commandTimeoutMs) || options.commandTimeoutMs <= 0) options.commandTimeoutMs = 15000;

// ---------- 工具 ----------
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const startedAt = Date.now();

function log(message) {
  process.stderr.write(`[smoke] ${message}\n`);
}

function fatal(message, extra = {}) {
  const payload = { ok: false, errorCode: 'INVALID_ARGUMENT', error: message, ...extra, generatedAt: new Date().toISOString() };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(1);
}

function errorMessage(error) {
  if (!error) return 'unknown error';
  return error.stack ? `${error.name || 'Error'}: ${error.message}` : String(error.message ?? error);
}

// 读取 dist manifest（容忍编辑器可能写入的 UTF-8 BOM）。
function readDistManifest() {
  return JSON.parse(readFileSync(join(options.dist, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
}

// Chromium 对未打包扩展的 ID：绝对路径（Windows 为 UTF-16LE 字节）SHA-256，
// 取前 32 个十六进制字符，每个 nibble 映射 a-p。仅作交叉校验/兜底。
function computeExtensionIdFromPath(absolutePath) {
  const digest = createHash('sha256').update(absolutePath, 'utf16le').digest();
  return digest
    .subarray(0, 16)
    .toString('hex')
    .split('')
    .map(nibble => String.fromCharCode(97 + parseInt(nibble, 16)))
    .join('');
}

// ---------- 最小 CDP 客户端（支持 flat session） ----------
class CdpConnection {
  constructor(webSocketUrl, { commandTimeoutMs }) {
    this.url = webSocketUrl;
    this.commandTimeoutMs = commandTimeoutMs;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      this.socket.onopen = resolvePromise;
      this.socket.onerror = () => rejectPromise(new Error(`无法连接 CDP WebSocket: ${this.url}`));
    });
    this.socket.onmessage = event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method} 失败: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners) {
        try {
          listener(message);
        } catch {
          // 监听器异常不影响主流程
        }
      }
    };
    this.socket.onclose = () => {
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP 连接已关闭（${pending.method}）`));
      }
      this.pending.clear();
    };
  }

  send(method, params = {}, sessionId = undefined) {
    if (this.closed) return Promise.reject(new Error(`CDP 连接已关闭，无法发送 ${method}`));
    const id = ++this.sequence;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`CDP 命令超时: ${method}`));
      }, this.commandTimeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer, method });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.socket.send(JSON.stringify(payload));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForEvent(predicate, timeoutMs) {
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        unsubscribe();
        rejectPromise(new Error('等待 CDP 事件超时'));
      }, timeoutMs);
      const unsubscribe = this.onEvent(event => {
        let matched = false;
        try {
          matched = predicate(event);
        } catch {
          matched = false;
        }
        if (!matched) return;
        clearTimeout(timer);
        unsubscribe();
        resolvePromise(event);
      });
    });
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
  }
}

async function evaluateInSession(connection, sessionId, expression) {
  const result = await connection.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true, userGesture: false },
    sessionId,
  );
  if (result.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      JSON.stringify(result.exceptionDetails);
    throw new Error(`页面执行异常: ${description}`);
  }
  return result.result?.value;
}

function attachTarget(connection, targetId) {
  return connection.send('Target.attachToTarget', { targetId, flatten: true }).then(result => {
    if (!result?.sessionId) throw new Error(`Target.attachToTarget 未返回 sessionId: ${targetId}`);
    return result.sessionId;
  });
}

// ---------- 浏览器进程管理 ----------
function buildLaunchArgs(mode, profileDir, distDir) {
  const args = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${distDir}`,
    `--disable-extensions-except=${distDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    // 允许 CDP Extensions domain 作为 --load-extension 不被支持时的兜底发现手段
    '--enable-unsafe-extension-debugging',
    '--window-size=1024,768',
  ];
  if (mode === 'headless') args.push('--headless=new', '--disable-gpu');
  args.push('about:blank');
  return args;
}

function launchBrowser(mode, tempRoot) {
  const profileDir = join(tempRoot, 'edge-profile');
  mkdirSync(profileDir, { recursive: true });
  if (!profileDir.startsWith(tmpdir())) {
    throw new Error(`拒绝使用非系统临时目录作为 user-data-dir: ${profileDir}`);
  }
  const args = buildLaunchArgs(mode, profileDir, options.dist);
  log(`启动临时 Edge (${mode}) user-data-dir=${profileDir}`);
  const child = spawn(options.browser, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  const stderrLines = [];
  const stdoutLines = [];
  child.stderr.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      stderrLines.push(line.trim());
      if (stderrLines.length > 200) stderrLines.shift();
    }
  });
  child.stdout.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      stdoutLines.push(line.trim());
      if (stdoutLines.length > 50) stdoutLines.shift();
    }
  });
  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });
  child.on('error', error => {
    exited = exited || { code: -1, signal: null, spawnError: errorMessage(error) };
  });
  return { child, profileDir, stderrLines, stdoutLines, getExited: () => exited };
}

async function waitForDevToolsPort(launched) {
  const portFile = join(launched.profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + options.launchTimeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const lines = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      if (lines.length >= 2 && /^\d+$/.test(lines[0].trim()) && lines[1].trim().startsWith('/devtools/')) {
        return {
          port: Number(lines[0].trim()),
          browserWebSocketPath: lines[1].trim(),
        };
      }
    }
    const exited = launched.getExited();
    if (exited) {
      throw new Error(
        `Edge 启动后提前退出（code=${exited.code}, signal=${exited.signal}）${exited.spawnError ? `: ${exited.spawnError}` : ''}\nstderr: ${launched.stderrLines.slice(-8).join(' | ')}`,
      );
    }
    await sleep(200);
  }
  throw new Error(`等待 DevToolsActivePort 超时（${options.launchTimeoutMs}ms）\nstderr: ${launched.stderrLines.slice(-8).join(' | ')}`);
}

function killBrowser(launched) {
  const pid = launched.child?.pid;
  if (!pid) return;
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } catch {
    // ignore
  }
  try {
    launched.child.kill();
  } catch {
    // ignore
  }
}

async function waitForChildExit(launched, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (launched.getExited()) return true;
    await sleep(100);
  }
  return false;
}

async function removeTempRoot(tempRoot) {
  if (options.keepTemp) {
    log(`保留临时目录: ${tempRoot}`);
    return { removed: false, kept: true, path: tempRoot };
  }
  const normalized = resolve(tempRoot);
  if (!normalized.startsWith(resolve(tmpdir())) || !normalized.includes(TEMP_PREFIX)) {
    log(`拒绝删除非冒烟临时目录: ${normalized}`);
    return { removed: false, kept: true, path: normalized, reason: '路径校验未通过' };
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(normalized, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
      if (!existsSync(normalized)) return { removed: true, kept: false, path: normalized };
    } catch {
      // Edge 子进程可能仍占用文件，稍后重试
    }
    await sleep(300);
  }
  log(`警告: 临时目录未能完全删除: ${normalized}`);
  return { removed: false, kept: true, path: normalized, reason: '文件占用，删除失败' };
}

// ---------- 扩展发现 ----------
const SW_INFO_EXPRESSION = `(() => {
  const manifest = chrome.runtime.getManifest();
  return {
    runtimeId: chrome.runtime.id,
    name: manifest.name,
    version: manifest.version,
    manifestVersion: manifest.manifest_version,
    scope: (self.registration && self.registration.scope) || null,
    serviceWorkerState: (self.serviceWorker && self.serviceWorker.state) || null,
    scriptURL: self.location.href,
  };
})()`;

// 兜底验证：打开扩展自身页面，从页面上下文读取 manifest 并列出后台 service worker 上下文。
async function probeExtensionViaPage(connection, extensionId) {
  const created = await connection.send('Target.createTarget', { url: `chrome-extension://${extensionId}/src/options/index.html` });
  const targetId = created.targetId;
  let sessionId = null;
  try {
    sessionId = await attachTarget(connection, targetId);
    await connection.send('Runtime.enable', {}, sessionId);
    const deadline = Date.now() + Math.min(options.pageTimeoutMs, 15000);
    let pageInfo = null;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        pageInfo = await evaluateInSession(
          connection,
          sessionId,
          `(async () => {
            const manifest = chrome.runtime.getManifest();
            const contexts = typeof chrome.runtime.getContexts === 'function' ? await chrome.runtime.getContexts({}) : null;
            return {
              runtimeId: chrome.runtime.id,
              name: manifest.name,
              version: manifest.version,
              manifestVersion: manifest.manifest_version,
              extensionBaseUrl: chrome.runtime.getURL(''),
              title: document.title || '',
              readyState: document.readyState,
              contexts: contexts ? contexts.map(context => ({
                contextType: context.contextType,
                documentOrigin: context.documentOrigin || null,
                documentUrl: context.documentUrl || null,
              })) : null,
            };
          })()`,
        );
        break;
      } catch (error) {
        lastError = error;
        await sleep(200);
      }
    }
    if (!pageInfo) {
      if (lastError) log(`扩展页面兜底验证未能读取上下文: ${errorMessage(lastError)}`);
      return null;
    }
    return {
      discovery: 'extension-page-contexts',
      info: {
        runtimeId: pageInfo.runtimeId,
        name: pageInfo.name,
        version: pageInfo.version,
        manifestVersion: pageInfo.manifestVersion,
        scope: pageInfo.extensionBaseUrl || null,
        serviceWorkerState: null,
        scriptURL: null,
      },
      backgroundContexts: pageInfo.contexts,
      pageTitle: pageInfo.title,
    };
  } finally {
    if (sessionId) {
      try {
        await connection.send('Target.detachFromTarget', { sessionId });
      } catch {
        // ignore
      }
    }
    try {
      await connection.send('Target.closeTarget', { targetId });
    } catch {
      // ignore
    }
  }
}

async function discoverExtension(connection, distManifest, computedId) {
  const deadline = Date.now() + options.discoveryTimeoutMs;
  // service worker 目标在启动阶段可能短暂不可 attach（Runtime.evaluate 失败），
  // 因此不能首次失败就永久跳过，而是限制重试次数后继续轮询。
  const attemptCounts = new Map();
  const notOurs = new Set();
  const observed = new Map();
  let lastError = null;
  while (Date.now() < deadline) {
    let targetInfos = [];
    try {
      targetInfos = (await connection.send('Target.getTargets')).targetInfos || [];
    } catch (error) {
      lastError = error;
      await sleep(300);
      continue;
    }
    const candidates = targetInfos.filter(info => info.type === 'service_worker' && String(info.url || '').startsWith('chrome-extension://'));
    for (const candidate of candidates) {
      if (notOurs.has(candidate.targetId)) continue;
      const attempts = attemptCounts.get(candidate.targetId) || 0;
      if (attempts >= 10) continue;
      attemptCounts.set(candidate.targetId, attempts + 1);
      let sessionId = null;
      try {
        sessionId = await attachTarget(connection, candidate.targetId);
        await connection.send('Runtime.enable', {}, sessionId);
        const info = await evaluateInSession(connection, sessionId, SW_INFO_EXPRESSION);
        if (info) observed.set(candidate.targetId, { targetId: candidate.targetId, url: candidate.url, ...info });
        if (info && info.name === distManifest.name) {
          return { discovery: 'service-worker-target', target: candidate, sessionId, info, observed: [...observed.values()] };
        }
        if (info) notOurs.add(candidate.targetId);
      } catch (error) {
        lastError = error;
        if (sessionId) {
          try {
            await connection.send('Target.detachFromTarget', { sessionId });
          } catch {
            // ignore
          }
        }
      }
    }
    await sleep(300);
  }

  // 兜底：SW 目标始终不可 attach 时，改从扩展页面上下文验证（同时尝试唤醒 SW）。
  const candidateIds = new Set([computedId]);
  try {
    const loaded = await connection.send('Extensions.loadUnpacked', { path: options.dist });
    if (loaded?.id) candidateIds.add(loaded.id);
  } catch (error) {
    lastError = error;
  }
  for (const extensionId of candidateIds) {
    try {
      const pageProbe = await probeExtensionViaPage(connection, extensionId);
      if (!pageProbe) continue;
      // 打开扩展页面可能唤醒 service worker：随后短轮询直接目标，优先返回直接的 SW 证据。
      const wakeDeadline = Date.now() + 5000;
      while (Date.now() < wakeDeadline) {
        const targetInfos = (await connection.send('Target.getTargets').catch(() => ({ targetInfos: [] }))).targetInfos || [];
        const serviceWorkerTarget = targetInfos.find(
          info => info.type === 'service_worker' && String(info.url || '').startsWith(`chrome-extension://${extensionId}/`),
        );
        if (serviceWorkerTarget) {
          try {
            const sessionId = await attachTarget(connection, serviceWorkerTarget.targetId);
            await connection.send('Runtime.enable', {}, sessionId);
            const info = await evaluateInSession(connection, sessionId, SW_INFO_EXPRESSION);
            if (info && info.name === distManifest.name) {
              return {
                discovery: 'extension-page-woken-service-worker',
                target: serviceWorkerTarget,
                sessionId,
                info: { ...info, backgroundContexts: pageProbe.backgroundContexts },
                observed: [...observed.values()],
                warning: '直接轮询 service worker 目标曾短暂失败；打开扩展页面唤醒后完成验证。',
              };
            }
          } catch (error) {
            lastError = error;
          }
        }
        await sleep(250);
      }
      if (pageProbe.info?.name === distManifest.name) {
        return {
          discovery: pageProbe.discovery,
          target: null,
          sessionId: null,
          info: { ...pageProbe.info, backgroundContexts: pageProbe.backgroundContexts },
          observed: [...observed.values()],
          warning: '未直接 attach 到 service worker 目标，改由扩展页面 + chrome.runtime.getContexts() 验证后台上下文。',
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(
    `未发现已加载扩展的 service worker（${options.discoveryTimeoutMs}ms 内）。目标列表: ${JSON.stringify(
      (await connection.send('Target.getTargets').catch(() => ({ targetInfos: [] }))).targetInfos?.map(info => ({ type: info.type, url: info.url }))?.slice(0, 20) ?? [],
    )}${lastError ? `；最后一次错误: ${errorMessage(lastError)}` : ''}`,
  );
  error.code = 'EXTENSION_NOT_LOADED';
  error.observed = [...observed.values()];
  throw error;
}

// ---------- 页面检查 ----------
async function checkExtensionPage(connection, extensionId, distManifest, pageName, relativeHtmlPath) {
  const url = `chrome-extension://${extensionId}/${relativeHtmlPath}`;
  const created = await connection.send('Target.createTarget', { url: 'about:blank' });
  const targetId = created.targetId;
  const exceptions = [];
  const consoleErrors = [];
  const logErrors = [];
  let sessionId = null;
  let unsubscribe = null;
  const startedPageAt = Date.now();
  try {
    sessionId = await attachTarget(connection, targetId);
    unsubscribe = connection.onEvent(event => {
      if (event.sessionId !== sessionId) return;
      if (event.method === 'Runtime.exceptionThrown') {
        const details = event.params?.exceptionDetails || {};
        exceptions.push({
          text: details.text || '',
          description: details.exception?.description || details.exception?.value || '',
          url: details.url || '',
          lineNumber: details.lineNumber,
          columnNumber: details.columnNumber,
        });
      } else if (event.method === 'Runtime.consoleAPICalled' && event.params?.type === 'error') {
        consoleErrors.push(
          (event.params.args || [])
            .map(arg => arg.value ?? arg.description ?? arg.type ?? '')
            .filter(Boolean)
            .join(' ')
            .slice(0, 500),
        );
      } else if (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error') {
        logErrors.push({ source: event.params.entry.source, text: event.params.entry.text, url: event.params.entry.url });
      }
    });
    await connection.send('Runtime.enable', {}, sessionId);
    await connection.send('Page.enable', {}, sessionId);
    await connection.send('Log.enable', {}, sessionId);

    const loadEvent = connection
      .waitForEvent(event => event.sessionId === sessionId && event.method === 'Page.loadEventFired', options.pageTimeoutMs)
      .then(() => true)
      .catch(() => false);
    await connection.send('Page.navigate', { url }, sessionId);
    const loadEventFired = await loadEvent;

    const deadline = Date.now() + options.pageTimeoutMs;
    let pageInfo = null;
    let lastEvaluateError = null;
    while (Date.now() < deadline) {
      try {
        pageInfo = await evaluateInSession(
          connection,
          sessionId,
          `(() => {
            const root = document.querySelector('#root');
            return {
              url: location.href,
              title: document.title || '',
              readyState: document.readyState,
              runtimeId: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || null,
              manifestName: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().name : null,
              rootChildren: root ? root.children.length : null,
              bodyTextLength: document.body ? String(document.body.innerText || '').length : 0,
              bodyChildCount: document.body ? document.body.children.length : 0,
            };
          })()`,
        );
        // React 挂载是异步的：标题/运行时 ID 就绪后，再多给一点渲染时间。
        if (pageInfo.readyState === 'complete' && pageInfo.title && pageInfo.rootChildren !== null && pageInfo.rootChildren > 0) break;
      } catch (error) {
        lastEvaluateError = error;
      }
      await sleep(200);
    }
    if (!pageInfo) {
      throw new Error(`无法读取页面状态: ${lastEvaluateError ? errorMessage(lastEvaluateError) : 'unknown'}`);
    }
    const storageCheck = await evaluateInSession(
      connection,
      sessionId,
      `(async () => { try { const items = await chrome.storage.local.get(null); return { ok: true, keys: Object.keys(items).length }; } catch (error) { return { ok: false, error: String(error) }; } })()`,
    ).catch(error => ({ ok: false, error: errorMessage(error) }));

    const checks = [];
    const addCheck = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
    addCheck('page.loaded', loadEventFired || pageInfo.readyState === 'complete', `loadEventFired=${loadEventFired}, readyState=${pageInfo.readyState}`);
    addCheck('page.title', pageInfo.title.trim().length > 0, `title=${JSON.stringify(pageInfo.title)}`);
    addCheck('page.runtimeId', pageInfo.runtimeId === extensionId, `runtimeId=${pageInfo.runtimeId}`);
    addCheck('page.manifestName', pageInfo.manifestName === distManifest.name, `manifestName=${JSON.stringify(pageInfo.manifestName)}（期望 ${JSON.stringify(distManifest.name)}）`);
    addCheck('page.rendered', pageInfo.rootChildren === null ? pageInfo.bodyChildCount > 0 : pageInfo.rootChildren > 0, `rootChildren=${pageInfo.rootChildren}, bodyChildCount=${pageInfo.bodyChildCount}`);
    addCheck('page.storage', storageCheck?.ok === true, `chrome.storage.local.get 可用: ${JSON.stringify(storageCheck)}`);
    addCheck('page.noUncaughtExceptions', exceptions.length === 0, exceptions.length === 0 ? '无未捕获异常' : `捕获 ${exceptions.length} 个未捕获异常`);
    const failedChecks = checks.filter(item => !item.ok);
    const notes = [];
    if (pageName === 'popup' && consoleErrors.length > 0) {
      notes.push('popup 以普通标签页方式打开时 chrome.tabs.sendMessage 可能找不到活动页的 content script，控制台错误属冒烟环境预期噪声，不计入未捕获异常。');
    }
    return {
      name: pageName,
      url,
      ok: failedChecks.length === 0,
      checks,
      uncaughtExceptions: exceptions,
      consoleErrors,
      logErrors,
      notes,
      durationMs: Date.now() - startedPageAt,
    };
  } finally {
    unsubscribe?.();
    if (sessionId) {
      try {
        await connection.send('Target.detachFromTarget', { sessionId });
      } catch {
        // ignore
      }
    }
    try {
      await connection.send('Target.closeTarget', { targetId });
    } catch {
      // ignore
    }
  }
}

// ---------- 单次尝试 ----------
async function runAttempt(mode) {
  const attemptStartedAt = Date.now();
  const tempRoot = mkdtempSync(join(tmpdir(), `${TEMP_PREFIX}${mode}-`));
  let launched = null;
  let connection = null;
  const attempt = {
    mode,
    tempProfileDir: tempRoot,
    ok: false,
    errorCode: null,
    error: null,
    browser: null,
    extension: null,
    pages: [],
    notes: [
      '本冒烟只验证扩展加载与扩展页面运行时，不代表真实招聘页端到端验收。',
      '未访问、未填写、未提交任何真实招聘页。',
    ],
  };
  try {
    launched = launchBrowser(mode, tempRoot);
    const devtools = await waitForDevToolsPort(launched);
    log(`DevTools 端口: ${devtools.port}（浏览器进程 pid=${launched.child.pid}）`);
    const browserWebSocketUrl = `ws://127.0.0.1:${devtools.port}${devtools.browserWebSocketPath}`;
    connection = new CdpConnection(browserWebSocketUrl, { commandTimeoutMs: options.commandTimeoutMs });
    await connection.connect();
    log('CDP 已连接，读取浏览器版本…');
    const version = await connection.send('Browser.getVersion');
    const distManifest = readDistManifest();
    const computedId = computeExtensionIdFromPath(options.dist);
    attempt.browser = {
      path: options.browser,
      product: version.product,
      protocolVersion: version.protocolVersion,
      userAgent: version.userAgent,
      headless: mode === 'headless',
      port: devtools.port,
    };
    log(`浏览器: ${version.product}；扩展 manifest: ${distManifest.name} v${distManifest.version}`);
    log('等待扩展 service worker 注册…');
    const discovered = await discoverExtension(connection, distManifest, computedId);
    log(`发现扩展: id=${discovered.info.runtimeId}，方式=${discovered.discovery}，SW state=${discovered.info.serviceWorkerState ?? 'n/a'}，scope=${discovered.info.scope ?? 'n/a'}`);
    const extensionId = discovered.info.runtimeId;
    const expectedIdMatch = extensionId === computedId;
    const swScopeExpected = `chrome-extension://${extensionId}/`;
    const backgroundContexts = Array.isArray(discovered.info.backgroundContexts) ? discovered.info.backgroundContexts : [];
    const directServiceWorkerVerified =
      ['service-worker-target', 'extension-page-woken-service-worker'].includes(discovered.discovery) &&
      Boolean(discovered.info.scope) &&
      String(discovered.info.scope).startsWith(swScopeExpected) &&
      ['activated', 'activating', 'installing'].includes(String(discovered.info.serviceWorkerState));
    const indirectServiceWorkerVerified = backgroundContexts.some(context => context.contextType === 'BACKGROUND');
    const swDebug = {
      discovery: discovered.discovery,
      scope: discovered.info.scope ?? null,
      state: discovered.info.serviceWorkerState ?? null,
      backgroundContexts,
    };
    const swChecks = [
      {
        id: 'extension.manifestName',
        ok: discovered.info.name === distManifest.name,
        detail: `扩展 manifest name=${JSON.stringify(discovered.info.name)}（期望 ${JSON.stringify(distManifest.name)}）`,
      },
      {
        id: 'extension.manifestVersion',
        ok: discovered.info.version === distManifest.version,
        detail: `扩展 manifest version=${JSON.stringify(discovered.info.version)}（期望 ${JSON.stringify(distManifest.version)}）`,
      },
      {
        id: 'extension.manifestVersion3',
        ok: discovered.info.manifestVersion === 3,
        detail: `manifest_version=${JSON.stringify(discovered.info.manifestVersion)}`,
      },
      {
        id: 'extension.serviceWorkerRegistered',
        ok: directServiceWorkerVerified || indirectServiceWorkerVerified,
        detail: directServiceWorkerVerified
          ? `直接验证 SW 目标: scope=${JSON.stringify(swDebug.scope)}, state=${JSON.stringify(swDebug.state)}`
          : indirectServiceWorkerVerified
            ? `间接验证后台上下文: chrome.runtime.getContexts() 含 BACKGROUND 上下文, discovery=${discovered.discovery}`
            : `未验证到 service worker 注册: ${JSON.stringify(swDebug)}`,
      },
      {
        id: 'extension.idMatchesPath',
        ok: expectedIdMatch,
        detail: `浏览器分配 id=${extensionId}；路径哈希推导 id=${computedId}`,
      },
    ];
    if (discovered.warning) attempt.notes.push(discovered.warning);
    attempt.extension = {
      id: extensionId,
      computedIdFromPath: computedId,
      discovery: discovered.discovery,
      scriptURL: discovered.info.scriptURL ?? discovered.target?.url ?? null,
      serviceWorkerState: discovered.info.serviceWorkerState ?? null,
      scope: discovered.info.scope ?? null,
      backgroundContexts,
      name: discovered.info.name ?? null,
      version: discovered.info.version ?? null,
      checks: swChecks,
      observedExtensionTargets: (discovered.observed || []).map(item => ({ targetId: item.targetId, url: item.url, name: item.name })),
    };
    const swFailed = swChecks.filter(item => !item.ok);
    if (swFailed.length > 0) {
      const error = new Error(`扩展加载检查失败: ${swFailed.map(item => `${item.id}: ${item.detail}`).join('; ')}`);
      error.code = 'EXTENSION_CHECK_FAILED';
      throw error;
    }

    // 打开 options / popup 扩展页面（在关闭 Runtime.enable 之前就挂接异常监听）。
    log('检查 options 页面…');
    attempt.pages.push(await checkExtensionPage(connection, extensionId, distManifest, 'options', 'src/options/index.html'));
    log('检查 popup 页面…');
    attempt.pages.push(await checkExtensionPage(connection, extensionId, distManifest, 'popup', 'src/popup/index.html'));
    const failedPages = attempt.pages.filter(page => !page.ok);
    if (failedPages.length > 0) {
      const error = new Error(`扩展页面检查失败: ${failedPages.map(page => `${page.name}: ${page.checks.filter(check => !check.ok).map(check => `${check.id}(${check.detail})`).join(', ')}`).join(' | ')}`);
      error.code = 'PAGE_CHECK_FAILED';
      throw error;
    }
    attempt.ok = true;
    return attempt;
  } catch (error) {
    attempt.error = errorMessage(error);
    attempt.errorCode = error.code || 'SMOKE_FAILED';
    throw Object.assign(error, { attempt });
  } finally {
    try {
      connection?.close();
    } catch {
      // ignore
    }
    killBrowser(launched);
    const exited = launched ? await waitForChildExit(launched) : true;
    const cleanup = await removeTempRoot(tempRoot);
    attempt.cleanup = { browserExited: exited, tempProfile: cleanup };
    attempt.durationMs = Date.now() - attemptStartedAt;
    log(`临时实例已关闭（exited=${exited}），临时目录 ${cleanup.removed ? '已删除' : '保留: ' + cleanup.path}`);
  }
}

// ---------- 主流程 ----------
async function main() {
  const result = {
    ok: false,
    generatedAt: new Date().toISOString(),
    distDir: options.dist,
    mode: options.mode,
    attempts: [],
    notes: [
      '隔离临时 user-data-dir 冒烟，不接触用户默认浏览器配置。',
      '只检查扩展加载 / service worker / options、popup 页面运行时；不代表真实招聘页端到端验收。',
      '未访问、未填写、未提交任何真实招聘页。',
    ],
  };
  if (!existsSync(options.dist) || !existsSync(join(options.dist, 'manifest.json'))) {
    result.errorCode = 'DIST_NOT_FOUND';
    result.error = `扩展构建目录不存在或缺少 manifest.json: ${options.dist}（请先运行 npm run build）`;
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(1);
  }
  try {
    const preflightManifest = readDistManifest();
    if (preflightManifest.manifest_version !== 3 || typeof preflightManifest.name !== 'string' || preflightManifest.name.trim() === '') {
      result.errorCode = 'DIST_INVALID';
      result.error = `扩展 manifest 不是合法的 MV3 扩展（manifest_version=${JSON.stringify(preflightManifest.manifest_version)}, name=${JSON.stringify(preflightManifest.name)}）: ${options.dist}`;
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(1);
    }
  } catch (error) {
    result.errorCode = 'DIST_INVALID';
    result.error = `扩展构建目录的 manifest.json 不是合法 JSON: ${options.dist}（${error.message}）`;
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(1);
  }
  if (!existsSync(options.browser)) {
    result.errorCode = 'BROWSER_NOT_FOUND';
    result.error = `未找到 Microsoft Edge: ${options.browser}（可用 --browser 或 EDGE_PATH 指定）`;
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(1);
  }

  const modes = options.mode === 'auto' ? ['headless', 'headed'] : [options.mode];
  let lastError = null;
  for (const mode of modes) {
    try {
      const attemptResult = await runAttempt(mode);
      result.ok = true;
      result.mode = mode;
      result.attempts.push(attemptResult);
      result.browser = attemptResult.browser;
      result.extension = attemptResult.extension;
      result.pages = attemptResult.pages;
      result.cleanup = attemptResult.cleanup;
      break;
    } catch (error) {
      const attempt = error.attempt || { mode, ok: false, error: errorMessage(error), errorCode: error.code || 'SMOKE_FAILED' };
      result.attempts.push(attempt);
      lastError = error;
      const retryable = ['EXTENSION_NOT_LOADED', 'BROWSER_LAUNCH_FAILED', 'DEVTOOLS_TIMEOUT', 'CDP_CONNECT_FAILED', 'HEADLESS_UNSUPPORTED'];
      if (options.mode !== 'auto' || mode === modes[modes.length - 1] || !retryable.includes(attempt.errorCode)) break;
      log(`模式 ${mode} 未通过（${attempt.errorCode}），按任务约定改用隔离的非 headless 临时实例重试`);
    }
  }
  const successful = result.attempts.find(attempt => attempt.ok);
  result.ok = Boolean(successful);
  result.durationMs = Date.now() - startedAt;
  if (!result.ok) {
    const failedAttempt = result.attempts[result.attempts.length - 1];
    result.errorCode = failedAttempt?.errorCode || 'SMOKE_FAILED';
    result.error = failedAttempt?.error || errorMessage(lastError) || '冒烟失败';
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.ok ? 0 : 1);
}

main().catch(error => {
  const payload = { ok: false, errorCode: 'SMOKE_FAILED', error: errorMessage(error), generatedAt: new Date().toISOString() };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(1);
});
