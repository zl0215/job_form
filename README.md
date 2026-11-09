# 校招表单助手（Chrome / Edge 扩展）

本机识别并填写校招网申表单，支持字段学习；纯浏览器扩展，资料不出本机。

> GitHub: <https://github.com/zl0215/job_form>

在本机识别校招网申表单，把已保存的个人资料填进**空白字段**，并记住每个网站识别不了的字段——下次直接命中。

- **纯浏览器扩展**：无需本地服务、无 Native Messaging、无端口/令牌/版本握手，装好即用。
- **资料只在本机**：保存在浏览器扩展存储，不上传服务器；识别与填写全部本地完成，本版本不向任何模型服务发送个人资料。
- **不覆盖、不乱填**：页面已有内容绝不覆盖；识别没把握的字段宁可留空；不勾选协议、不提交、不上传附件。
- **失败一次就能记住**：填充后弹窗列出本页未识别字段，选择对应资料字段保存为永久别名，下次自动填写。
- **旧资料可导入**：曾使用旧版 Python 助手的用户，可在设置页一次性导入 `profile.json`。

## 快速开始

### 安装

仓库根目录的 `extension/` 是已构建好的可加载扩展。

- **更新**：打开 `edge://extensions` → 找到「校招表单助手」→ 点「重新加载」；卡片异常时移除后重新加载。
- **首次安装**：打开 `edge://extensions`（Edge）或 `chrome://extensions`（Chrome）→ 开启「开发人员模式」→「加载解压缩的扩展」→ 选择 `extension/`。

### 资料

- **新用户**：点扩展图标 →「设置个人信息」，填写一次基本信息、教育经历、工作经历、技能证书等；也可上传简历 PDF/DOCX 解析。
- **旧版用户**：设置页 →「数据与同步」→「从旧版校招助手导入（profile.json）」→ 选择 `%LOCALAPPDATA%\CampusFormAgent\profile.json`，核对条数后确认导入。
  - 导入只显示条数摘要，不展示个人值；冲突值不会自动覆盖（例如多条教育记录需人工核对合并）。
- 支持多份简历（校招/实习）在弹窗顶部切换。

### 填写

1. 打开招聘网站申请/简历页；
2. 点击扩展图标 →「快速填充」；
3. 页面显示填充结果（成功 / 跳过已有 / 失败），只填空白项、不提交。

有字段未识别时，展开弹窗中的「本页字段对照」：为每个未识别字段选择对应资料字段 →「记住并填充」，下次自动命中。需要手动补填可打开「信息窗口」，点击单条资料复制或写入当前输入框。

## 识别能力

用旧工具保存的 **941 条真实网申字段**（20 个申请页：hotjob / zhiye / Moka / 智联 / 51job / 国网等）做离线匹配诊断：

| 指标 | 改造前 | 改造后 |
|---|---|---|
| 字段匹配率 | 57.5%（541/941） | **71.0%（668/941）** |
| 规则冲突（ambiguous） | 106 | **2** |
| 旧工具已识别但新引擎未命中 | 48 | **18** |

> 这是**离线字段标签级诊断**（候选资料为占位资料、无真实 DOM），不是真实页填写验收。报告见 [`diagnostics/coverage/coverage-comparison-baseline-after.md`](diagnostics/coverage/coverage-comparison-baseline-after.md)。

仍可能需要人工处理的字段：证书类字段（可用「本页字段对照」记住一次）、多记录家庭成员姓名、汇总类教育字段、问卷/资格类问题、日期区间等依赖页面结构的控件。复杂级联、封闭 Shadow DOM、不可访问 iframe、需新增经历卡片的控件也可能需要人工。

## 安全与隐私

- 只填空白项，不覆盖已有内容；不勾选协议、不提交、不上传附件；
- 内推码、验证码、密码等永久禁止自动填写；
- 写入后回读验证，失败只报告，不反复乱写；
- 资料、简历附件、字段别名、投递记录保存在 `chrome.storage.local`；卸载/清除扩展数据前请先导出备份；
- 设置页支持完整数据 JSON 导出/导入，投递记录支持 CSV；
- WebDAV 同步默认关闭，启用后只上传到你自己填写的服务器。

## 开发

需要 Node.js 20.19+ / 22.12+。

```powershell
cd extension-src
npm ci --ignore-scripts --no-audit --no-fund   # canvas 原生模块在受限网络会失败，构建不需要它
npm test                                       # 单元/集成测试
npm run build                                  # tsc -b && vite build && post-build

cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build_extension.ps1   # 构建并同步到 extension/
node scripts/verify_extension_build.mjs --dist extension
node scripts/smoke_extension_cdp.mjs --dist extension                              # 隔离临时 Edge 冒烟
```

- 构建校验：manifest/MV3/content.js classic/资源完整性；
- 隔离冒烟：临时 user-data-dir 加载扩展，检查 service worker 与扩展页面，不触碰日常浏览器配置；
- 真实验证记录见 [`docs/v1.0-验证记录.md`](docs/v1.0-验证记录.md)。

### 验证边界

单元测试、构建校验、离线字段诊断和隔离浏览器冒烟**都不等于**真实招聘页验收。真实页验收需要在已加载扩展的真实招聘申请页上点击「快速填充」，核对字段、回读与未覆盖情况。本仓库没有可访问的真实页面，未声称端到端成功。

## 目录

```
extension/              可加载扩展（构建产物，v1.0.0）
extension-src/          扩展源码（TypeScript + React + Vite，MV3）
diagnostics/coverage/   真实字段目录提取与离线匹配诊断 harness/报告
scripts/                构建、产物校验、隔离冒烟、只读标签页观察
docs/                   改造方案、资料迁移说明、验证记录
```

旧版（Python 本地服务 + 注入脚本）架构与旧文档已在仓库精简时移除，仅保留在本地 git 历史中。

## 许可

本项目基于 [NetApply](https://github.com/Yezi2002/NetApply)（MIT）与 [Job-Application-Helper](https://github.com/aurostars/Job-Application-Helper)（MIT）改造，版权归原作者；本项目修改部分同样以 MIT 发布，详见 [`extension-src/LICENSE`](extension-src/LICENSE)。
