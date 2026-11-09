#!/usr/bin/env node
// 构建产物校验：确认 extension-src/dist 是可直接加载的 MV3 扩展。
// 只读脚本：不修改 dist、不启动浏览器、不接触用户浏览器配置。
//
// 用法：
//   node scripts/verify_extension_build.mjs                # 人类可读输出
//   node scripts/verify_extension_build.mjs --json         # 机器可读 JSON
//   node scripts/verify_extension_build.mjs --dist <dir>   # 校验其他构建目录
//
// 退出码：0 = 全部检查通过；1 = 存在失败项。
// 检查项：manifest 合法性（MV3/name/version/permissions/content_scripts 指向存在文件）、
//          content.js 为 classic script（无顶层 import/export）、background.js 存在、
//          icons / PDF worker / cmaps / standard_fonts 资源存在、HTML 引用的本地资源存在。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const projectRoot = join(repoRoot, 'extension-src');

const checks = [];
let verbose = true;
let distDir = join(projectRoot, 'dist');

const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i];
  if (arg === '--json') verbose = false;
  else if (arg === '--dist') distDir = resolve(rawArgs[++i] || '');
  else if (arg === '--help' || arg === '-h') {
    console.log('用法: node scripts/verify_extension_build.mjs [--json] [--dist <dir>]');
    process.exit(0);
  } else {
    console.error(`未知参数: ${arg}`);
    process.exit(2);
  }
}

function check(id, ok, detail, extra = null) {
  checks.push({ id, ok: Boolean(ok), detail, ...(extra ? { extra } : {}) });
  return Boolean(ok);
}

function fail(id, detail) {
  return check(id, false, detail);
}

function readManifestAt(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// 相对路径必须落在 dist 内，防止被篡改的 manifest 指向 dist 之外。
function insideDist(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return null;
  if (relPath.includes('\0')) return null;
  const abs = resolve(distDir, relPath);
  const rel = relative(distDir, abs);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || resolve(distDir, relPath) === resolve(distDir)) return null;
  return abs;
}

function fileSize(abs) {
  try {
    return statSync(abs).isFile() ? statSync(abs).size : -1;
  } catch {
    return -1;
  }
}

function listFilesRecursive(dir) {
  const out = [];
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(abs);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// manifest.web_accessible_resources 的简单通配：支持 `dir/*`、`dir/*.ext` 与普通相对文件。
function resolveResourcePattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return { ok: false, reason: '空资源路径' };
  if (!pattern.includes('*')) {
    const abs = insideDist(pattern);
    if (!abs) return { ok: false, reason: '路径越出 dist 或非法' };
    return existsSync(abs) && statSync(abs).isFile()
      ? { ok: true, files: [pattern] }
      : { ok: false, reason: `文件不存在: ${pattern}` };
  }
  const starIndex = pattern.indexOf('*');
  const slashBeforeStar = pattern.lastIndexOf('/', starIndex);
  const dirRel = slashBeforeStar >= 0 ? pattern.slice(0, slashBeforeStar) : '';
  const namePattern = pattern.slice(slashBeforeStar + 1);
  const dirAbs = dirRel === '' ? distDir : insideDist(dirRel);
  if (!dirAbs || !existsSync(dirAbs) || !statSync(dirAbs).isDirectory()) {
    return { ok: false, reason: `目录不存在: ${dirRel || '.'}（模式 ${pattern}）` };
  }
  const regex = new RegExp('^' + namePattern.split('*').map(escapeRegExp).join('.*') + '$');
  const matching = [];
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && regex.test(entry.name)) matching.push(relative(distDir, abs).split(sep).join('/'));
    }
  };
  walk(dirAbs);
  return matching.length > 0
    ? { ok: true, files: matching }
    : { ok: false, reason: `模式未匹配到文件: ${pattern}` };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 提取 HTML 中引用的本地脚本/样式/图标路径（跳过外链与 data:）。
function extractHtmlLocalRefs(html, htmlAbs) {
  const refs = [];
  const attrPattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrPattern.exec(html)) !== null) {
    const ref = match[1].trim();
    if (!ref || ref.startsWith('#') || /^(?:https?:|data:|blob:|javascript:|mailto:)/i.test(ref)) continue;
    if (ref.startsWith('//')) continue;
    if (ref.includes('${')) continue;
    const clean = ref.split(/[?#]/)[0];
    if (!clean) continue;
    // 扩展页面中的 `/assets/x.js` 指扩展根目录（dist），不是磁盘根目录。
    const abs = clean.startsWith('/') ? resolve(distDir, clean.replace(/^\/+/, '')) : resolve(dirname(htmlAbs), clean);
    refs.push({ ref: clean, abs });
  }
  return refs;
}

function earlyExit(message) {
  const failedItems = checks.filter(item => !item.ok);
  if (message) console.error(`✗ ${message}`);
  if (verbose) {
    for (const item of checks) {
      console.log(`${item.ok ? '✓' : '✗'} [${item.id}] ${item.detail}`);
    }
    console.log('');
    console.log(`结果: ${checks.length - failedItems.length}/${checks.length} 项通过，${failedItems.length} 项失败（校验中止）`);
  } else {
    process.stdout.write(
      JSON.stringify(
        { ok: false, error: message ?? '构建产物不完整，校验中止', checks: { total: checks.length, passed: checks.length - failedItems.length, failed: failedItems.length, failedItems } },
        null,
        2,
      ) + '\n',
    );
  }
  process.exit(1);
}

// ---------- 1. 基础结构 ----------
const distExists = check('dist.exists', existsSync(distDir) && statSync(distDir).isDirectory(), `构建目录: ${distDir}`);
if (!distExists) {
  earlyExit(`构建目录不存在: ${distDir}（请先运行 npm run build）`);
}
const manifestAbs = join(distDir, 'manifest.json');
const manifestExists = check('manifest.exists', existsSync(manifestAbs), 'dist/manifest.json 存在');
let manifest = null;
if (manifestExists) {
  try {
    manifest = readManifestAt(manifestAbs);
    check('manifest.json.parse', true, 'dist/manifest.json 是合法 JSON');
  } catch (error) {
    fail('manifest.json.parse', `dist/manifest.json 解析失败: ${error.message}`);
  }
}
if (!manifest) earlyExit('dist/manifest.json 不存在或不是合法 JSON，无法继续校验');

// ---------- 2. manifest 字段 ----------
check('manifest.version', manifest.manifest_version === 3, `manifest_version = ${JSON.stringify(manifest.manifest_version)}（要求 3）`);
check(
  'manifest.name',
  typeof manifest.name === 'string' && manifest.name.trim().length > 0,
  `name = ${JSON.stringify(manifest.name)}`,
);
check(
  'manifest.versionFormat',
  typeof manifest.version === 'string' && /^\d+(?:\.\d+){0,3}$/.test(manifest.version),
  `version = ${JSON.stringify(manifest.version)}`,
);
const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : null;
check('manifest.permissions', Array.isArray(permissions) && permissions.length > 0, `permissions = ${JSON.stringify(permissions)}`);
if (permissions) {
  const required = ['storage', 'scripting'];
  const missing = required.filter(item => !permissions.includes(item));
  check(
    'manifest.permissions.required',
    missing.length === 0,
    missing.length === 0 ? `核心权限齐全（${required.join('/')}）；共 ${permissions.length} 项` : `缺少核心权限: ${missing.join(', ')}`,
  );
  const unknown = permissions.filter(item => typeof item !== 'string');
  check('manifest.permissions.types', unknown.length === 0, 'permissions 全部为字符串');
}
if (manifest.host_permissions !== undefined) {
  const hostPerms = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : null;
  check('manifest.host_permissions', hostPerms !== null && hostPerms.every(item => typeof item === 'string'), `host_permissions = ${JSON.stringify(manifest.host_permissions)}`);
}

// 与源 manifest 比较：如果不一致说明 dist 是旧构建（post-build 会原样复制）。
const sourceManifestAbs = join(projectRoot, 'manifest.json');
if (existsSync(sourceManifestAbs)) {
  const sourceText = readFileSync(sourceManifestAbs, 'utf8');
  const distText = readFileSync(manifestAbs, 'utf8');
  check(
    'manifest.matchesSource',
    sourceText === distText,
    sourceText === distText
      ? 'dist/manifest.json 与 extension-src/manifest.json 逐字节一致'
      : 'dist/manifest.json 与 extension-src/manifest.json 不一致：dist 可能是旧构建，请运行 npm run build',
  );
}

// ---------- 3. background / content ----------
const backgroundRel = manifest.background?.service_worker;
let backgroundAbs = null;
if (typeof backgroundRel === 'string' && backgroundRel.length > 0) {
  backgroundAbs = insideDist(backgroundRel);
  const size = backgroundAbs ? fileSize(backgroundAbs) : -1;
  check(
    'background.exists',
    size > 0,
    size > 0 ? `background service worker 存在: ${backgroundRel} (${formatBytes(size)})` : `background service worker 不存在: ${backgroundRel}`,
  );
  if (manifest.background.type !== undefined) {
    check('background.type', manifest.background.type === 'module', `background.type = ${JSON.stringify(manifest.background.type)}（要求 module）`);
  }
} else {
  fail('background.exists', 'manifest.background.service_worker 未配置或不是字符串');
}

const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : null;
check('content_scripts.exists', contentScripts !== null && contentScripts.length > 0, `content_scripts 数量 = ${contentScripts?.length ?? 'N/A'}`);
let contentAbs = null;
if (contentScripts) {
  contentScripts.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      fail(`content_scripts[${index}].shape`, `content_scripts[${index}] 不是对象`);
      return;
    }
    check(
      `content_scripts[${index}].matches`,
      Array.isArray(entry.matches) && entry.matches.length > 0 && entry.matches.every(item => typeof item === 'string'),
      `matches = ${JSON.stringify(entry.matches)}`,
    );
    const js = Array.isArray(entry.js) ? entry.js : [];
    check(`content_scripts[${index}].js`, js.length > 0, `js = ${JSON.stringify(entry.js)}`);
    for (const jsRel of js) {
      const abs = insideDist(jsRel);
      const size = abs ? fileSize(abs) : -1;
      check(
        `content_scripts[${index}].js.exists:${jsRel}`,
        size > 0,
        size > 0 ? `${jsRel} 存在 (${formatBytes(size)})` : `${jsRel} 不存在或为空`,
      );
      if (abs && basename(abs) === 'content.js' && !contentAbs) contentAbs = abs;
    }
    const css = Array.isArray(entry.css) ? entry.css : [];
    for (const cssRel of css) {
      const abs = insideDist(cssRel);
      const size = abs ? fileSize(abs) : -1;
      check(`content_scripts[${index}].css.exists:${cssRel}`, size > 0, size > 0 ? `${cssRel} 存在 (${formatBytes(size)})` : `${cssRel} 不存在或为空`);
    }
  });
}

// content.js 必须是 classic script：Chrome 的静态 content_scripts 不能执行 ES module。
if (contentAbs) {
  const source = readFileSync(contentAbs, 'utf8');
  const moduleImport = /^\s*(?:import|export)\s/m.test(source);
  const importMeta = /\bimport\s*\.\s*meta\b/.test(source);
  check(
    'content.classicScript',
    !moduleImport && !importMeta,
    moduleImport
      ? 'content.js 含顶层 import/export，Chrome content_scripts 无法按 classic script 执行'
      : importMeta
        ? 'content.js 含 import.meta，classic script 不支持'
        : `content.js 为 classic script（${formatBytes(Buffer.byteLength(source))}，无 import/export/import.meta）`,
  );
} else {
  fail('content.classicScript', '未在 content_scripts 中找到 content.js');
}

// ---------- 4. icons / action / html 入口 ----------
const iconEntries = manifest.icons && typeof manifest.icons === 'object' ? Object.entries(manifest.icons) : [];
check('icons.exists', iconEntries.length > 0, `manifest.icons 共 ${iconEntries.length} 项`);
for (const [size, rel] of iconEntries) {
  const abs = insideDist(rel);
  const length = abs ? fileSize(abs) : -1;
  check(`icons.${size}.exists`, length > 0, length > 0 ? `icons/${size} → ${rel} (${formatBytes(length)})` : `icons/${size} → ${rel} 不存在`);
  if (abs && length > 0) {
    const header = readFileSync(abs).subarray(0, 8);
    const isPng = header.length >= 8 && header[0] === 0x89 && header.subarray(1, 4).toString('ascii') === 'PNG';
    check(`icons.${size}.png`, isPng, isPng ? 'PNG 文件头合法' : '不是有效 PNG（文件头错误）');
  }
}
const defaultIcon = manifest.action?.default_icon;
if (defaultIcon && typeof defaultIcon === 'object') {
  for (const [size, rel] of Object.entries(defaultIcon)) {
    const abs = insideDist(rel);
    check(`action.default_icon.${size}`, Boolean(abs) && fileSize(abs) > 0, `${rel}`);
  }
}

const htmlEntries = [];
const popupRel = manifest.action?.default_popup;
if (typeof popupRel === 'string') htmlEntries.push({ label: 'popup', rel: popupRel });
const optionsRel = manifest.options_page ?? manifest.options_ui?.page;
if (typeof optionsRel === 'string') htmlEntries.push({ label: 'options', rel: optionsRel });
const sidePanelRel = manifest.side_panel?.default_path;
if (typeof sidePanelRel === 'string') htmlEntries.push({ label: 'side_panel', rel: sidePanelRel });
check('html.entries', htmlEntries.length > 0, `入口页面 ${htmlEntries.length} 个: ${htmlEntries.map(item => `${item.label}=${item.rel}`).join(', ')}`);
for (const { label, rel } of htmlEntries) {
  const abs = insideDist(rel);
  const length = abs ? fileSize(abs) : -1;
  check(
    `html.${label}.exists`,
    length > 0,
    length > 0 ? `${label}: ${rel} 存在 (${formatBytes(length)})` : `${label}: ${rel} 不存在或为空`,
  );
  if (!abs || length <= 0) continue;
  const html = readFileSync(abs, 'utf8');
  const refs = extractHtmlLocalRefs(html, abs);
  const missing = refs.filter(item => !existsSync(item.abs) || !statSync(item.abs).isFile());
  check(
    `html.${label}.refs`,
    missing.length === 0,
    missing.length === 0
      ? `${label} 本地引用 ${refs.length} 个全部存在`
      : `${label} 缺少本地引用: ${missing.map(item => item.ref).join(', ')}`,
  );
}

// ---------- 5. web_accessible_resources（PDF worker / cmaps / fonts / icons） ----------
const warEntries = Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : [];
check('war.exists', warEntries.length > 0, `web_accessible_resources 共 ${warEntries.length} 组`);
const warFiles = new Set();
for (const [index, entry] of warEntries.entries()) {
  check(
    `war[${index}].matches`,
    Array.isArray(entry?.matches) && entry.matches.length > 0,
    `matches = ${JSON.stringify(entry?.matches)}`,
  );
  const resources = Array.isArray(entry?.resources) ? entry.resources : [];
  check(`war[${index}].resources`, resources.length > 0, `resources = ${JSON.stringify(resources)}`);
  for (const pattern of resources) {
    const resolution = resolveResourcePattern(pattern);
    check(`war[${index}].resource:${pattern}`, resolution.ok, resolution.ok ? `匹配 ${resolution.files.length} 个文件` : resolution.reason);
    if (resolution.ok) for (const file of resolution.files) warFiles.add(file);
  }
}

const pdfWorkerRel = 'pdf.worker.min.js';
const pdfWorkerAbs = insideDist(pdfWorkerRel);
const pdfWorkerSize = pdfWorkerAbs ? fileSize(pdfWorkerAbs) : -1;
check(
  'asset.pdfWorker',
  pdfWorkerSize > 100_000 && warFiles.has(pdfWorkerRel),
  pdfWorkerSize > 100_000
    ? `${pdfWorkerRel} 存在 (${formatBytes(pdfWorkerSize)}) 且在 web_accessible_resources 中`
    : `${pdfWorkerRel} 缺失或过小（${pdfWorkerSize} 字节）`,
);
const cmapsDir = join(distDir, 'cmaps');
const cmapsCount = listFilesRecursive(cmapsDir).length;
check('asset.cmaps', cmapsCount > 0 && warFiles.has([...warFiles].find(file => file.startsWith('cmaps/')) ?? ''), `cmaps/ 文件数 = ${cmapsCount}`);
const fontsDir = join(distDir, 'standard_fonts');
const fontsCount = listFilesRecursive(fontsDir).length;
check('asset.standardFonts', fontsCount > 0 && warFiles.has([...warFiles].find(file => file.startsWith('standard_fonts/')) ?? ''), `standard_fonts/ 文件数 = ${fontsCount}`);

// ---------- 6. 大小摘要 ----------
const allFiles = listFilesRecursive(distDir);
const totalBytes = allFiles.reduce((sum, file) => sum + fileSize(file), 0);
const byExtension = {};
for (const file of allFiles) {
  const ext = file.endsWith('.js') ? '.js'
    : file.endsWith('.css') ? '.css'
      : file.endsWith('.html') ? '.html'
        : file.endsWith('.png') ? '.png'
          : file.endsWith('.json') ? '.json'
            : '.' + (basename(file).split('.').pop() || 'other');
  byExtension[ext] = (byExtension[ext] ?? 0) + 1;
}
const topFiles = allFiles
  .map(file => ({ rel: relative(distDir, file).split(sep).join('/'), bytes: fileSize(file) }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 10);
const topLevelDirs = {};
for (const file of allFiles) {
  const rel = relative(distDir, file).split(sep);
  const key = rel.length > 1 ? rel[0] : '(根目录)';
  topLevelDirs[key] = (topLevelDirs[key] ?? 0) + fileSize(file);
}

// ---------- 输出 ----------
const failed = checks.filter(item => !item.ok);
const passed = checks.length - failed.length;
const summary = {
  distDir,
  files: allFiles.length,
  totalBytes,
  byExtension,
  topLevelDirs,
  topFiles,
};
const result = {
  ok: failed.length === 0,
  checkedAt: new Date().toISOString(),
  manifest: manifest
    ? {
        name: manifest.name,
        version: manifest.version,
        manifestVersion: manifest.manifest_version,
        permissions: manifest.permissions,
        contentScript: contentScripts?.[0]?.js?.[0] ?? null,
      }
    : null,
  checks: { total: checks.length, passed, failed: failed.length, failedItems: failed },
  summary,
};

function report() {
  if (verbose) {
    for (const item of checks) {
      console.log(`${item.ok ? '✓' : '✗'} [${item.id}] ${item.detail}`);
    }
    console.log('');
    console.log(`构建目录: ${summary.distDir}`);
    console.log(`文件总数: ${summary.files}，总大小: ${formatBytes(summary.totalBytes)}`);
    console.log(`文件类型: ${Object.entries(summary.byExtension).map(([ext, count]) => `${ext}=${count}`).join(', ')}`);
    console.log(`顶层目录大小: ${Object.entries(summary.topLevelDirs).map(([dir, bytes]) => `${dir}=${formatBytes(bytes)}`).join(', ')}`);
    console.log('最大文件:');
    for (const file of summary.topFiles) console.log(`  ${formatBytes(file.bytes).padStart(10)}  ${file.rel}`);
    console.log('');
    console.log(`结果: ${passed}/${checks.length} 项通过${failed.length ? `，${failed.length} 项失败` : '，全部通过'}`);
    if (failed.length) {
      console.log('失败项:');
      for (const item of failed) console.log(`  ✗ [${item.id}] ${item.detail}`);
    }
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

report();
