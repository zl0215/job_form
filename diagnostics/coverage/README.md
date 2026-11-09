# 真实站点字段识别覆盖率诊断（task-1 / engine）

本目录是**离线匹配诊断**，用于把旧工具（CampusFormAgent）保存过的真实网申字段目录
（`%LOCALAPPDATA%\CampusFormAgent\profile.json` 的 `mappings` / `pages` / `semanticLinks`）
与新扩展（extension-src，NetApply 引擎）的 `buildProfileAnswerCandidates + FieldMatcher`
匹配链做对比，驱动 `profileFieldRegistry / profilePresets / fieldMatcher` 的规则扩充。

## 边界（AGENTS.md）

- 只读取用户本地 profile.json，**不修改**；输出只含字段标签、结构、状态、计数、选项，
  **绝不输出任何个人答案值**（用 `verify_no_personal_values.py` 自动校验）。
- 候选资料是**固定占位 UserProfile**（`placeholderProfile.ts`，值全部是唯一的占位串），
  不读取、不打印真实资料值。
- 字段证据只有旧目录里的 `label / section / type` 元数据，没有 DOM 的 name/id/placeholder，
  也没有真实页面的输入控件结构；因此这是**后端/离线映射诊断**，
  **不是**真实页 DOM 提取，**不是**已部署扩展的端到端验收。
- **选项文本安全**：旧工具 `mappings.options` 里可能保存着用户已选/已填的值（实测含院校名等
  个人答案），因此目录只输出 `optionsCount` 数量，绝不输出原始选项文本；`verify_no_personal_values.py`
  会自动拦截高熵个人值泄漏。
- 旧目录的 `section` 来自旧工具的页面结构识别，本身可能带噪声（例如教育字段被记录在
  "证书" section 下）；真实页面的模块上下文由新扩展的 DOM 提取逻辑决定，可能不同。

## 文件

| 文件 | 说明 |
| --- | --- |
| `extract_field_catalog.py` | 只读提取真实字段目录（生成 `field-catalog.json` / `available-semantics.json` / `catalog-summary.md`；这些大文件已被仓库精简移除，可随时重跑生成） |
| `placeholderProfile.ts` | 诊断用占位资料（固定占位值，全覆盖预设/模块字段） |
| `match-diagnostic.ts` | 匹配 harness：`record <tag>` 生成报告，`compare <before> <after>` 生成对比 |
| `coverage-after.md` | 规则扩充后的逐字段报告（当前快照） |
| `coverage-comparison-baseline-after.md` | 改前/改后逐站点覆盖率对比 + 新命中/回归/冲突清单（基线数字来自已固化的历史报告） |
| `verify_no_personal_values.py` | 安全校验：生成物不得含高熵个人答案值 |

## 复现命令（Windows，在仓库根目录执行；tsx 依赖在 extension-src/）

```powershell
# 1) 提取真实字段目录（只读 profile.json；生成文件不入库）
python -X utf8 diagnostics/coverage/extract_field_catalog.py

# 2) 记录覆盖率（依赖已装好 extension-src/node_modules）
cd extension-src
npx tsx ../diagnostics/coverage/match-diagnostic.ts record after

# 3) 安全校验：确认报告里没有真实个人答案值
cd ..
python diagnostics/coverage/verify_no_personal_values.py
```

> 规则指纹（文件 SHA-256 前 16 位）写进每份报告，用于确认报告对应哪一版规则代码。
> 仓库精简删除了 `coverage-baseline.*` 等历史大文件；若要重跑 baseline→after 对比，
> 需先对精简前的规则源码执行 `record baseline`，再对当前代码执行 `record after` 与 `compare`。

## 指标口径

- **matched / 覆盖率**：`matched / 字段总数`。matched = 规则能唯一识别（且有可填候选）。
- **blocked**：安全规则永久禁止自动填写（内推码/验证码等），算正确行为，不算缺口。
- **ambiguous**：多个字段规则冲突，扩展会跳过不填（防乱填底线）。
- **unmatched**：规则缺口，或缺少对应资料/数据模型的字段。
- **oldReadyMissed**：旧工具状态 `ready`（实际填过）但新引擎未命中，是最高优先级回归。
- 另按"短标签（≤30 字）"单独统计：真实 DOM 的字段标题提取器只接受 ≤30 字的短文本，
  长说明文本不作为主要覆盖率分母。
