# 校招表单助手 · 扩展源码（extension-src）

本目录是「校招表单助手」v1.0 的浏览器扩展源码（Chrome / Edge，Manifest V3）。

- 基于 [NetApply](https://github.com/Yezi2002/NetApply)（MIT）改造，后者基于 [Job-Application-Helper](https://github.com/aurostars/Job-Application-Helper)（MIT）；上游 `LICENSE` 与本目录版权声明保留。
- 本项目改造：纯本地字段识别与填写、旧版 `profile.json` 一次性导入、「本页字段对照」记住一次、关闭云端 AI 生成入口、品牌与文档。
- 详细的匹配引擎设计见 [docs/DESIGN.md](docs/DESIGN.md)，项目总体说明见仓库根 `README.md` 与 `docs/v1.0-纯浏览器扩展改造.md`。

## 特性

- **本地识别与填写**：字段注册表 + 分层匹配 + 写入前空白检查 + 写入后回读，识别与填写全部在本机完成。
- **不覆盖、不乱填**：页面已有内容绝不覆盖；识别没把握的字段留空；内推码、验证码、密码等永久禁止自动填写；不提交、不勾选协议、不上传附件。
- **多简历 + 投递记录**：校招/实习等资料一键切换；投递记录本地留存。
- **记住一次**：填充后可在弹窗「本页字段对照」把未识别字段对应到资料字段，保存为永久别名，下次自动命中。
- **旧资料迁移**：设置页支持导入旧版 Python 助手的 `profile.json`（只在本机解析）。
- **纯本地存储**：资料保存在 `chrome.storage.local`，不上传任何服务器。
- 本版本**未启用**云端 AI 填充/答案生成：不向模型服务发送个人资料。

## 开发

需要 Node.js 20.19+ 或 22.12+。

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build     # tsc -b && vite build && post-build，产物在 dist/
npm test          # 单元/集成测试
npm run lint
```

> `--ignore-scripts` 是必须的：devDependency `canvas` 安装时会尝试从 nodejs.org 下载原生二进制，受限网络下会失败；构建与运行不需要该原生模块。

构建产物 `dist/` 可直接作为未打包扩展加载：

1. 打开 `edge://extensions`（Edge）或 `chrome://extensions`（Chrome）；
2. 开启「开发人员模式」；
3. 「加载解压缩的扩展」选择 `dist/`。

## 数据与备份

- 手动导出/导入完整数据（JSON）与投递记录 CSV。
- WebDAV 同步为可选项，默认关闭；启用后只上传到用户自己填写的服务器。
- 同步契约（安全优先）：
  - 只有远端变化时，**未修改设备会自动下载云端更新**；
  - 只有本地变化时使用条件请求上传，并在无 ETag 时**上传前重新读取并确认远端 hash**；
  - **双方都修改时不会自动覆盖**，冲突会停止同步等待用户选择；
  - **首次连接且两边数据不同时需要手动选择**本地或云端版本；
  - 服务端不提供 ETag 时使用 hash 基线，**如果后续服务开始返回有效 ETag，会自动升级为 ETag 模式**。

## 验证边界

单元测试、构建校验与隔离浏览器冒烟不代表真实招聘页验收。真实页验证需要在用户本机已打开的真实招聘申请页上，通过已加载扩展完成「扫描 → 填充 → 回读核对」，详见仓库根 `docs/v1.0-验证记录.md`。
