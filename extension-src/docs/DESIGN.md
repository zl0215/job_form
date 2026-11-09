# Job Application Helper 安全匹配与别名系统重构方案

> 文档用途：交给后续 AI/开发者直接理解背景、边界、实施顺序和验收标准。
>
> 当前源码目录：`D:\plug\Job-Application-Helper-main`
>
> 浏览器实际加载目录：`D:\plug\job-application-helper-extension`
>
> 本文只是一份实施方案。编写本文时没有修改插件代码。

---

## 0. 给接手者的最重要提醒

1. **先读当前代码，再修改。不要根据旧聊天记录猜测当前状态。** 用户已经执行过回滚，当前文件状态可能与此前任何一次描述不同。
2. **不要查看或依赖 Git 历史来推断需求。** 以当前工作区代码和本文为准。
3. 修改前必须把源码目录和浏览器加载目录分别做一份带时间戳的完整备份。
4. 不要一次改十几个文件后只跑一个字符串模拟就宣布成功。必须分阶段，每一阶段都做到：能编译、能构建、能加载、能回滚。
5. 用户不需要压缩包，也不需要上传 GitHub。最终构建产物直接同步到 `D:\plug\job-application-helper-extension`。
6. 不要删除或重建用户资料。数据结构升级必须向后兼容，已有字段值、简历、API Key、投递记录、WebDAV 设置和多简历资料库都必须保留。
7. **安全性优先于覆盖率：宁可少填，也绝不能乱填或覆盖网页已有内容。**
8. “快速填充”应当是纯本地、确定性的匹配。AI 是用户后续主动触发的补填工具，不应暗中参与普通快速填充。

---

## 1. 我们在做什么：项目背景和改造目的

这是一个浏览器扩展，用于在不同公司的招聘/校园招聘网站中自动填写个人信息、教育经历、实习/工作经历、项目经历、奖项及其他求职资料。

原作者仓库：<https://github.com/aurostars/Job-Application-Helper>

用户使用它的原因很直接：不同公司的招聘表单字段极多，而且同一个问题在不同网站中会使用不同叫法，例如：

- “手机号 / 手机号码 / 联系电话 / 本人电话”实际需要同一个答案；
- “紧急联系人电话 / 紧急联系电话 / 应急联系人手机”实际需要另一个答案；
- “学校 / 学校名称 / 就读院校 / 毕业（在读）院校”实际都是学校；
- “入学时间 / 就读开始时间 / 开始时间”在教育模块里含义相同；
- 日期选项可能写成 `6`、`06` 或 `6月`；
- 同一个值在某些网站中是输入框，在另一些网站中是原生下拉框、自定义下拉框或日期选择器。

因此，这次改造的目标不是追求“插件敢填更多”，而是建立一条**可解释、可配置、可验证、不会破坏已有页面数据**的自动填写链路。

最终希望达到：

```text
网页字段
  ↓
判断是否禁止自动填写
  ↓
判断网页是否已经有值
  ↓
使用用户别名/字段专属规则确定答案来源
  ↓
按控件类型执行输入或选择
  ↓
回读页面确认确实成功
  ↓
只有确认成功才计入“成功填写”
```

---

## 2. 原作者原本有什么：内置匹配器说明

原作者本来就有“内置匹配器”，主要由以下文件组成：

- `src/utils/fieldMatcher.ts`
- `src/shared/constants.ts`
- `src/content/formDetector.ts`
- `src/content/formFiller.ts`

原始思路大致为：

1. 从网页控件读取 `name`、`id`、`placeholder`、可见标签、`autocomplete` 等文字；
2. 把这些文字拼成一个大字符串；
3. 遍历 `FIELD_PATTERNS` 中的关键词；
4. 只要大字符串包含某个关键词，就把网页字段认成对应的 `FieldType`；
5. 如果没有明显命中，再使用 Levenshtein 字符串相似度尝试匹配；
6. `FormFiller` 根据 `FieldType` 从资料库取值并写入网页。

这套方案能处理简单字段，但不符合当前“安全优先”的需求，主要问题包括：

- `电话` 太宽泛，会把紧急联系人电话、推荐人电话、单位电话都当作本人手机号；
- `name` 太宽泛，可能在 `nationalityName`、`mentorName`、`projectName` 中误判为本人姓名；
- `education` 同时出现在学校和学历规则中，容易抢字段；
- 多个规则命中时缺少可靠的冲突处理；
- 字段模块上下文、网页可见标题和内部技术 ID 被混在一起，证据没有优先级；
- 匹配结果不确定时仍可能填写；
- 普通快速填充没有可靠地跳过已有值；
- 匹配成功和网页真正写入成功没有完全等价；
- 新增的预设字段虽然有别名，但自定义匹配通常只处理“内置匹配失败”的字段，可能永远没有机会生效。

---

## 3. 当前已经确认的真实问题

### 3.1 紧急联系人电话被本人手机号抢走

资料库中存在：

```text
字段：紧急联系人电话
系统别名：紧急联系电话、联系人手机
```

但当前内置手机号规则包含：

```text
phone、mobile、tel、contact、电话、手机、联系电话……
```

网页字段“紧急联系电话”先被内置规则认成 `FieldType.PHONE`，随后 `FormFiller` 取出 `profile.personal.phone`，因此填写了本人手机号。

预设的“紧急联系人电话”别名没有机会生效，因为当前 `customFieldMatcher` 通常只接收 `FormDetector` 留下的 unmatched 字段。

### 3.2 🔒 紧急联系人电话无法被 AI 使用

紧急联系人电话属于敏感资料，默认 `sensitive = true`、`allowAI = false`。当前 `profileForAI()` 会过滤敏感字段，所以 AI 不会收到这个答案。

用户后来新建一个同值的普通自定义字段后，AI 能匹配，是因为新字段默认不是敏感字段。这不代表应该复制字段；正确做法是让本地别名匹配能够使用原来的敏感字段。

### 3.3 已有内推码会被覆盖

当前普通快速填充在调用 `fillField()` 前没有统一、可靠地判断控件是否已有有效值。因此只要字段被误识别，插件就可能覆盖网页原值。

这需要两道防线：

1. 内推码、推荐码、邀请码、验证码等永久禁止自动填写；
2. 快速填充默认只处理空白控件，任何已有内容都跳过。

### 3.4 国籍可能被姓名/拼音名抢走

许多网站的内部字段名类似：

```text
nationalityName
countryName
nationName
```

如果匹配器使用 `searchText.includes('name')`，就可能把国籍认成本人姓名。网页可见标题“国籍”本应比内部 ID 中的 `name` 后缀更可信。

### 3.5 民族能保存但缺少完整本地填写线路

`PersonalInfo` 中存在 `ethnicity`，但当前 `FieldType` 和取值分支未必完整覆盖民族。结果可能是资料页能填写“汉族”，但普通快速填充不知道怎样把网页“民族”字段映射到该值。

网页使用下拉框、插件资料使用文本保存不是根本问题。只要映射正确，文本“汉族”完全可以用于选择下拉选项“汉族”。

### 3.6 学校、学院、专业等曾因外层模块词发生回归

曾出现以下错误：

```text
education.schoolName  → degree
education.collegeName → degree
experience.companyName → description
```

根因是把外层模块词 `education`、`experience` 当成字段本身，并采用“最长关键词获胜”之类不安全的策略。新设计必须明确：模块词只用于限定上下文，不能覆盖字段本身的语义。

---

## 4. 用户已经确认的核心需求

1. 所有资料字段都应当有自己的明确匹配逻辑，效果上等价于“每个字段一个小的 `if`”。
2. 每个字段允许用户添加自己的匹配别名。
3. 匹配不上就不填，不能为了提高数字而猜测。
4. 普通快速填充默认不得覆盖网页已有内容。
5. 内推码、推荐码、验证码等字段一律不自动填写。
6. 同一个答案可以匹配不同网站的不同题目，不需要复制出多个答案相同的自定义字段。
7. 国籍、民族、紧急联系人等已经能在插件资料页保存的字段，必须真正接入普通快速填充。
8. 插件资料的保存控件与网页控件可以不同：资料中保存文本，网页中可以是下拉框。
9. AI 作为本地规则之后的第二阶段补填工具；本轮优先修复本地快速填充。
10. 修改要分阶段，每阶段都必须是完整可运行版本，防止额度或会话中断后留下烂尾代码。

---

## 5. 总体技术方案

### 5.1 不再使用“一锅煮”的匹配字符串

新增结构化证据对象，网页信息必须分开保存：

```ts
interface FieldEvidence {
  visibleLabel: string;
  placeholder: string;
  name: string;
  id: string;
  autocomplete: string;
  moduleContext: string;
  rowContext: string;
  inputType: string;
  controlKind: 'input' | 'textarea' | 'select' | 'custom-select' | 'radio' | 'checkbox' | 'date' | 'cascader';
}
```

禁止再把所有证据简单拼接后执行无差别 `includes()`。

证据可信度顺序：

1. 网页可见字段标题；
2. 用户配置的完整别名；
3. 系统提供的完整标准名称/别名；
4. `aria-label`、`data-form-field-name` 等稳定语义属性；
5. `placeholder`；
6. 拆词后的 `name`、`id`；
7. 模块标题只用于限定作用域，不直接决定字段。

### 5.2 统一规范化，但保留原始来源

建议新增 `src/utils/fieldText.ts`，提供：

- Unicode `NFKC` 规范化；
- 英文字母小写化；
- HTML DOM 已解码后的字符处理；
- 去除 `必填`、`选填`、`required`、星号、锁图标等显示噪声；
- 统一中文/英文括号；
- 去除不影响语义的空格和标点；
- camelCase、snake_case、kebab-case 拆词；
- 保留英文词元边界，`name` 不得命中 `nationalityName` 后直接代表本人姓名；
- 同时返回原始值和规范化值，便于日志解释。

### 5.3 建立统一字段注册表

建议新增 `src/shared/profileFieldRegistry.ts`，所有内置字段在一个地方定义：

```ts
interface ProfileFieldDefinition {
  key: ProfileFieldKey;
  label: string;
  scope: 'personal' | 'education' | 'experience' | 'project' | 'award' | 'custom';
  defaultAliases: string[];
  positiveTokens?: string[];
  negativeContexts?: string[];
  sensitive?: boolean;
  valueType: ProfileFieldType;
}
```

示例：

```ts
{
  key: 'personal.emergencyPhone',
  label: '紧急联系人电话',
  defaultAliases: ['紧急联系电话', '应急联系人电话', '紧急联系人手机号', '联系人手机'],
  positiveTokens: ['紧急联系人', '应急联系人'],
  negativeContexts: [],
  sensitive: true,
  valueType: 'text'
}

{
  key: 'personal.phone',
  label: '本人手机号',
  defaultAliases: ['手机号', '手机号码', '本人联系电话', '个人手机'],
  positiveTokens: ['手机', '电话'],
  negativeContexts: ['紧急', '应急', '推荐人', '内推人', '父亲', '母亲', '监护人', '单位'],
  sensitive: false,
  valueType: 'text'
}
```

### 5.4 用小型、按顺序的判断函数代替通用猜测

用户所说的“拆成小 `if`”应落地为一组可独立测试的函数，而不是一个几百行的大函数：

```ts
matchBlockedField(evidence)
matchEmergencyPhone(evidence)
matchEmergencyName(evidence)
matchEmergencyRelationship(evidence)
matchNationality(evidence)
matchEthnicity(evidence)
matchPoliticalStatus(evidence)
matchPersonalPhone(evidence)
matchPersonalName(evidence)
matchEducationSchool(evidence)
matchEducationCollege(evidence)
matchEducationMajor(evidence)
matchEducationDegree(evidence)
matchEducationDates(evidence)
matchCompany(evidence)
matchPosition(evidence)
matchWorkDates(evidence)
...
```

每个判断函数必须包含：

- 正向完整名称；
- 正向别名；
- 必要模块上下文；
- 明确排除语境；
- 为什么命中的 reason；
- 匹配强度/等级，但不能只靠一个模糊分数决定填写。

返回结果建议为：

```ts
interface FieldMatchResult {
  status: 'matched' | 'blocked' | 'ambiguous' | 'unmatched';
  profileKey?: ProfileFieldKey;
  confidence: 'exact-user-alias' | 'exact-system-alias' | 'exact-identifier' | 'contextual';
  reason: string;
  candidates?: ProfileFieldKey[];
}
```

如出现同优先级的多个候选，必须返回 `ambiguous` 并跳过，不能用规则数组先后顺序偷偷决定答案。

---

## 6. 严格匹配顺序

每个网页控件必须严格按以下顺序处理：

### 第 0 层：判断控件是否可操作

- 不可见、禁用、隐藏、按钮类控件跳过；
- 同源 iframe/open shadow root 继续支持；
- 不应把用于搜索下拉框的临时内部 input 重复当成另一个字段；
- 对 readonly input 先判断它是不是自定义下拉框/日期控件，不能一概丢弃。

### 第 1 层：永久禁止字段

无论是否为空、无论用户是否配置了相似别名，下列字段默认都不自动填写：

- 内推码、推荐码、推荐编码；
- 邀请码；
- 推荐人编号、内推员工编号；
- 短信验证码、邮箱验证码、图形验证码、OTP；
- 密码、确认密码；
- 招聘系统生成的只读流水号。

中英文和常见内部 ID 都要覆盖，例如：

```text
recommendCode, recommendationCode, referralCode, referrerCode,
inviteCode, invitationCode, verifyCode, verificationCode, captcha, otp
```

第 1 层必须先于所有用户别名和普通规则，防止误配置破坏页面。

### 第 2 层：已有内容保护

普通快速填充默认只填空白字段。需要实现统一的 `getExistingControlValue()` / `isControlBlank()`：

- input/textarea：`value.trim()`；
- 原生 select：检查实际选中项，排除“请选择”等占位项；
- 自定义 select：综合内部 input、触发器文字、`aria-label`、隐藏值；
- radio：同组已有任一选项选中即视为已有值；
- checkbox：根据字段组语义判断，不能单看某一个 checkbox；
- 日期框：检查可见日期文字和绑定值；
- 省市区联动：任何有效层级已有选择时默认不覆盖整组；
- 文件上传：已有文件名/上传成功状态时不重复上传。

为了防止异步页面变化，必须检查两次：

1. 检测/匹配前检查；
2. 真正写入前再次检查。

本阶段暂不增加“覆盖已有内容”开关。先固定为永不覆盖；未来确有需要再单独设计显式覆盖模式。

### 第 3 层：用户自定义完整别名

- 用户增加的别名优先于系统规则；
- 优先使用规范化后的完整相等；
- 对中文短别名不得随意做包含匹配；
- 对英文使用完整 token 或完整路径段匹配；
- 用户别名若同时命中两个资料字段，返回 `ambiguous` 并跳过。

### 第 4 层：系统标准名称和完整别名

例如：

```text
“紧急联系电话”完整命中 personal.emergencyPhone
“手机号”完整命中 personal.phone
“民族”完整命中 personal.ethnicity
“毕业（在读）院校”完整命中 education.school
```

### 第 5 层：字段专属上下文判断

只有在完整名称未命中时才使用组合条件：

```text
包含“紧急/应急联系人”上下文 + 包含“电话/手机” → emergencyPhone
包含“教育/学校”上下文 + 字段 token 为 schoolName → education.school
包含“教育”上下文 + 字段 token 为 collegeName/department → education.college
包含“工作/实习”上下文 + 字段 token 为 companyName → experience.company
```

### 第 6 层：安全内部标识符

只允许完整 token 或已知复合词：

```text
schoolName、collegeName、majorName、jobTitle、companyName
```

禁止：

```text
nationalityName 因为包含 name 就认成姓名
recommendCode 因为包含 code 或其他短词就认成任意资料
```

### 第 7 层：不确定就跳过

- Levenshtein 相似度不得再直接触发写入；
- 模糊结果可以进入诊断日志或待 AI 列表；
- 不允许“为了成功数量”选一个最像的答案。

---

## 7. 关键字段的专属 if 规则

### 7.1 本人姓名

正向：

```text
姓名、本人姓名、真实姓名、申请人姓名、候选人姓名、fullName、realName、applicantName
```

排除：

```text
紧急联系人、导师、指导教师、推荐人、证明人、父亲、母亲、监护人、项目、公司、学校、学院
```

单独的英文 `name` 只能在可见标题完整等于 `name`，或者内部标识符完整 token 就是 `name/fullName` 时使用；不能匹配任何以 `Name` 结尾的复合字段。

### 7.2 本人手机号

正向：

```text
手机号、手机号码、本人联系电话、本人手机、个人电话、mobilePhone、phoneNumber
```

排除：

```text
紧急、应急、推荐人、内推人、导师、父亲、母亲、监护人、单位、公司、固定电话、传真
```

HTML `type="tel"` 只能说明控件格式是电话，不能说明一定是本人手机号。仍要结合字段标题/上下文。

### 7.3 紧急联系人电话

必须在本人手机号之前判断。

正向：

```text
紧急联系人电话、紧急联系电话、紧急联系人手机号、应急联系人电话、应急联系人手机、联系人手机
```

组合判断：存在“紧急联系人/应急联系人”上下文，同时存在“电话/手机/联系方式”。

取值必须来自紧急联系人电话预设字段，绝不能回退到本人手机号。

### 7.4 国籍

正向：

```text
国籍、国家/地区、国家、nationality、countryOfCitizenship、citizenship
```

排除：

```text
出生国家、证件签发国家、学校所在国家、项目国家
```

`nationalityName` 应按完整复合词/首段 `nationality` 识别为国籍，末尾 `name` 不得抢占。

### 7.5 民族

正向：

```text
民族、所属民族、民族类别、ethnicity、ethnicGroup、nation（仅在中文招聘语境且没有 nationality/country 时）
```

民族与国籍必须分开，不能把 `nation` 无条件同时当成二者。

### 7.6 学校、学院、专业、学历/学位

- “学校/院校/大学/毕业院校/就读院校/schoolName/universityName” → school；
- “学院/院系/系别/collegeName/department/faculty” → college；
- “专业/专业名称/所学专业/majorName/fieldOfStudy” → major；
- “学历/最高学历/教育程度/degreeLevel/educationLevel” → education degree；
- “学位/最高学位/academicDegree” → degree/预设学位字段，需根据资料模型最终统一；
- `education` 只表示教育模块上下文，不能单独代表学历或学校；
- “毕业院校”必须先匹配学校，不能因为包含“毕业”就匹配毕业时间；
- 日期判断必须同时包含时间语义，例如“毕业时间/毕业日期/预计毕业时间”。

### 7.7 公司、职位、经历描述

- `experience` 只表示工作经历模块上下文，不能单独代表描述；
- `companyName/employer/单位名称` → company；
- `positionName/jobTitle/岗位名称` → position；
- 只有“工作内容/岗位职责/经历描述/主要成果”等明确标题才进入 description；
- `title`、`role`、`name` 等短词必须结合模块上下文。

### 7.8 GPA 与语言考试成绩

- “绩点/GPA/学分绩点/平均绩点” → GPA；
- “语种等级考试成绩/英语成绩/CET/TOEFL/IELTS”不得匹配 GPA；
- “成绩”单独出现时不自动填，必须结合教育绩点或具体考试上下文。

---

## 8. 别名系统设计

### 8.1 数据结构

内置核心字段目前只是字符串，没有保存别名的位置。建议在 `UserProfile` 增加可选字段：

```ts
interface FieldAliasOverride {
  added: string[];
}

type FieldAliasOverrides = Partial<Record<ProfileFieldKey, FieldAliasOverride>>;

interface UserProfile {
  // 现有字段保持不变
  fieldAliasOverrides?: FieldAliasOverrides;
}
```

说明：

- 注册表保存系统默认别名；
-资料只保存用户自己新增的别名；
- 旧资料没有 `fieldAliasOverrides` 时按空对象处理；
- 第一版先只允许新增/删除用户别名，不允许删除系统别名，避免误操作导致常用字段失效；
- 如果以后需要禁用某个系统别名，再增加 `disabledDefaults`，本轮不要过度设计。

预设字段和自定义字段已经有 `aliases: string[]`，可以继续使用，但最终匹配时要统一转换成同一种 `ProfileAnswerCandidate`。

### 8.2 统一答案候选

建议在 `src/shared/profileAnswerCandidates.ts` 新增展平函数：

```ts
interface ProfileAnswerCandidate {
  key: string;
  semanticKey: ProfileFieldKey | string;
  label: string;
  aliases: string[];
  value: string;
  valueType: ProfileFieldType;
  scope: string;
  recordIndex?: number;
  sensitive: boolean;
  allowAI: boolean;
}
```

它统一收集：

- 个人基本字段；
- 个人预设字段；
- 每条教育经历核心字段和详细字段；
- 每条工作/实习经历；
- 每条项目经历；
- 每条奖项；
- 一级常用模块；
- 用户自定义模块和字段；
- 旧版 `customInformation`（仅兼容，不新增依赖）。

匹配器只面对统一候选，不再分成“内置先匹配、自定义只能捡剩下的”。

### 8.3 别名 UI

新增一个可复用组件，例如：

```text
src/options/FieldAliasEditor.tsx
```

UI要求：

- 默认只显示字段名和值，不增加页面高度；
- 字段旁边提供小型“别名”按钮或齿轮；
- 点击后展开一行；
- 展示系统别名（只读）；
- 允许编辑“我的别名”，用顿号、逗号、分号或换行分隔；
- 自动 trim、去重、去空值；
- 显示规范化后重复/冲突提示；
- 敏感字段继续显示 🔒，别名本身可以本地保存；
- 不因修改别名改变字段的稳定 key 或已有值。

接入位置：

- `src/options/App.tsx`：基本信息；
- `src/options/CustomProfileEditor.tsx`：预设字段、自定义字段、常用模块；
- `src/options/EducationSection.tsx`：教育核心字段和详细字段；
- `src/options/ExperienceSection.tsx`：工作、项目核心字段和详细字段；
- `src/options/AwardsSection.tsx`：奖项核心字段和详细字段；
- `src/options/index.css`：紧凑展开样式。

---

## 9. 网页已有内容保护

这是第一优先级，必须先于提高匹配率完成。

### 9.1 新增统一检查函数

建议在 `src/content/controlState.ts` 新增：

```ts
getControlDisplayedValue(element): string
isControlBlank(element): boolean
isChoiceGroupBlank(element): boolean
```

禁止在多个填充函数中各写一套不一致判断。

### 9.2 填充前双重检查

`FormDetector` 可以在检测时记录当前值，但 `FormFiller` 写入前必须再次读取实时状态：

```ts
if (!isControlBlank(element)) {
  result.skippedExisting += 1;
  continue;
}
```

不能依赖早先保存的 `DetectedField.value`，因为招聘网站可能在检测后异步回填内容。

### 9.3 结果统计

扩展 `FormFillResult`：

```ts
interface FormFillResult {
  detected: number;
  attempted: number;
  filled: number;
  failed: number;
  skippedExisting: number;
  skippedBlocked: number;
  skippedAmbiguous: number;
  skippedChoices?: number;
}
```

弹窗不要只显示“成功 7 项”。建议显示：

```text
成功填写 7 项；跳过已有内容 3 项；禁止字段 1 项；无法确定 2 项。
```

只有回读确认后的字段才进入 `filled`。

---

## 10. 控件填写层设计

字段匹配和控件操作必须彻底分开：

```text
Matcher：这个网页字段对应哪个资料 key？
Resolver：这个 key 当前应该取第几条记录的什么值？
Adapter：这个网页控件应该怎样操作？
Verifier：页面是否真的接受并显示了这个值？
```

### 10.1 普通输入框/textarea

- 使用原生 setter 兼容 React；
- 触发必要的 input/change/blur；
- 写入前检查为空；
- 写入后等待并读取实际 value；
- 被页面回滚时计为失败，不能计为成功。

### 10.2 原生 select

- 读取所有 option；
- 先比较规范化后的 option text/value；
- 日期支持 `6`、`06`、`6月` 等值等价；
- 找不到唯一选项就不操作；
- 触发 change 后回读 selected option。

### 10.3 自定义下拉框

按适配器处理：

1. 确认触发器；
2. 模拟真实点击打开；
3. 等待选项 DOM 出现；
4. 只读取当前可见弹层中的选项，避免点到页面其他下拉框的同名选项；
5. 匹配唯一候选；
6. 点击；
7. 等待组件状态更新；
8. 回读触发器显示文字/隐藏值；
9. 确认成功后才计数。

需要优先覆盖：

- 原生 `<select>`；
- Moka 常见 React 自定义下拉框；
- Ant Design Select；
- Element/Vue Select；
- Arco/Semi 等已有选择器；
- 日期年月日分段控件；
- 省市区联动框。

若无法唯一识别控件类型，跳过，不要直接改内部 input.value 制造“看似成功”。

### 10.4 民族/国籍的输入值与下拉值

资料库保存：

```text
汉族
中国
```

网页选项允许：

```text
汉族
中华人民共和国 / 中国 / China / CN（只使用明确映射）
```

字段值归一化应与字段匹配分开，避免用值的近似匹配反向猜字段。

---

## 11. 普通快速填充与 AI 的边界

### 11.1 快速填充

必须满足：

- 完全本地；
- 不需要 API Key；
- 只填空白字段；
- 使用标准名称、别名和确定性 if 规则；
- 不进行 LLM 调用；
- 不处理 ambiguous 字段；
- 敏感信息可以本地匹配。

当前 `src/content/index.ts` 中如果“快速填充”仍然自动调用 `enhanceDetectionWithLLM()`，应拆开。普通快速填充不能悄悄进入 AI。

### 11.2 AI扫描/框选补填

本轮重构可以先保持功能可用，但不要扩大修改范围。后续单独讨论的目标是：

- AI只处理本地规则之后仍为空且未被禁止的字段；
- AI主要返回 `profileKey` 映射，不自由编造答案；
- 已有内容绝不传给 AI 覆盖；
- 敏感字段的值不发送给 AI；
- 可研究只向 AI 提供“存在某个敏感字段 key/名称”，AI返回 key 后由本地读取值，但这属于后续功能，需要另行确认；
- AI结果仍须经过禁止名单、空白检查、候选值检查和写后验证。

---

## 12. 逐文件实施清单

下面是建议修改范围。接手者应先检查当前文件，确认职责后再动手。

### 12.1 `src/shared/types.ts`

计划：

- 新增 `ProfileFieldKey` 或等价的稳定字段 key 类型；
- 新增 `FieldAliasOverride` / `fieldAliasOverrides?`；
- 新增结构化 `FieldEvidence`、`FieldMatchResult`（也可放独立文件）；
- 扩展 `FormFillResult` 的跳过统计；
- 补齐国籍、民族、政治面貌、籍贯、现居住地、紧急联系人等可填语义；
- 保持所有新字段可选，兼容旧存储。

不要：

- 删除现有字段；
- 重命名已持久化字段；
- 破坏 `ResumeProfileLibrary`；
- 把敏感值混入普通日志。

### 12.2 新增 `src/shared/profileFieldRegistry.ts`

计划：

- 统一定义核心字段标准名称、默认别名、作用域、类型、敏感性和排除上下文；
- 先覆盖个人、教育、工作、项目、奖项的核心字段；
- 再将 `profilePresets.ts` 的预设字段转换为统一候选；
- 注册表中禁止使用裸 `name/id/contact/电话/名称/日期` 作为独立充分条件。

### 12.3 `src/shared/profilePresets.ts`

计划：

- 保留现有预设字段和值；
- 校对国籍、紧急联系人等默认别名；
- 避免 `mergePresetFields()` 覆盖用户自己增加的别名；
- 敏感字段继续默认 `allowAI = false`；
- 不重复创建预设字段；
- 不恢复用户已经明确删除的旧废弃模块。

### 12.4 `src/shared/profileCustomFields.ts`

计划：

- 保留自定义字段创建、别名分割和旧数据升级；
- 把核心字段、预设字段、自定义字段统一展平为答案候选；
- 不再让自定义匹配只处理 unmatched 字段；
- `profileForAI()` 继续过滤敏感值。

如职责过重，可将展平逻辑拆到新文件 `src/shared/profileAnswerCandidates.ts`。

### 12.5 `src/shared/resumeProfiles.ts`

计划：

- 更新严格校验以接受可选的别名覆盖结构；
- 读取旧资料时默认补空对象，但不能修改其他值；
- 深拷贝别名数组，避免跨简历资料共享引用；
- 多简历切换、复制、重命名、同步仍正常。

### 12.6 `src/shared/backup.ts`

计划：

- 导出/导入时保留字段别名；
- 接受旧备份缺少别名配置；
- 拒绝非法别名类型；
- 不泄漏/丢失现有 WebDAV 与资料库数据；
- 如果当前备份 schema 可以通过可选字段兼容，则不要无必要升级大版本。

### 12.7 新增 `src/utils/fieldText.ts`

计划：

- 负责字段文字规范化和英文词元拆分；
- 去掉 UI 噪声但保留语义；
- 提供 exact label、exact token、compound identifier 等独立比较函数；
- 严禁把所有来源合成一个字符串后裸 `includes()`。

### 12.8 重构 `src/utils/fieldMatcher.ts`

这是核心文件。

计划：

- 保留公共入口或提供兼容包装，避免一次性破坏调用方；
- 使用结构化 `FieldEvidence`；
- 先 blocked，再用户别名，再系统精确别名，再字段专属 if；
- 每个字段判断拆为小函数；
- 完整处理排除语境；
- 多候选冲突返回 ambiguous；
- Levenshtein 仅作为诊断建议，不能直接生成可填写结果；
- 返回明确 reason，便于测试和调试；
- 模块上下文只用于消歧，不能直接覆盖字段语义。

### 12.9 `src/content/formDetector.ts`

计划：

- 提取结构化证据，不再只返回拼接字符串；
- 识别控件类型；
- 先过滤 blocked；
- 记录 matched/unmatched/ambiguous/blocked；
- 让预设和用户别名参与同一次统一匹配，不再只给 unmatched；
- 保留 Shadow DOM 和 frame 支持；
- 修正 readonly 自定义选择器的检测；
- 避免同一实际控件重复加入检测结果。

### 12.10 `src/content/customFieldMatcher.ts`

建议二选一：

1. 将其职责合并进统一匹配器；或
2. 保留文件，但让它生成统一候选，并在内置宽泛规则之前参与精确别名判断。

不能继续维持“内置先抢，只有 unmatched 才尝试别名”的顺序。

### 12.11 新增 `src/content/controlState.ts`

计划：

- 统一判断输入框、下拉框、日期框、radio、checkbox、文件控件是否已有有效内容；
- 支持写入前二次检查；
- 屏蔽占位文本“请选择/请输入/年/月/日”；
- 自定义下拉框读取真实显示值；
- 提供纯函数或易模拟接口，方便测试。

### 12.12 `src/content/formFiller.ts`

计划：

- 写入前调用 `isControlBlank()`；
- blocked/ambiguous 结果不得进入写入层；
- 用统一 `profileKey` resolver 取值；
- 补齐国籍、民族、政治面貌、籍贯、现居地、紧急联系人等取值；
- 保留重复教育/工作/项目/奖项的记录索引；
- 避免学校、学院等字段各自计数错位；
- 控件适配器找不到唯一选项时返回失败，不直接改内部 input；
- 所有成功必须经过回读验证；
- 返回 `skippedExisting/skippedBlocked/skippedAmbiguous`。

### 12.13 `src/content/index.ts`

计划：

- 重新编排快速填充管线；
- 快速填充不自动调用 AI；
- blocked、已有值、ambiguous 的统计传到 UI；
- 只把本地无法确认的空白字段保留给后续 AI 功能；
- 保留内容脚本重复注入保护和消息连接修复，不要撤销构建/连接相关已有修复；
- 不恢复自动上传简历，除非用户另行明确要求。

### 12.14 `src/options/FieldAliasEditor.tsx`（新增）

计划：

- 系统别名只读展示；
- 用户别名可编辑；
- 紧凑折叠；
- 冲突提示；
- 使用稳定 `profileKey` 保存；
- 不显示或记录真实敏感值到控制台。

### 12.15 `src/options/CustomProfileEditor.tsx`

计划：

- 预设字段也可以展开编辑用户别名；
- 原有自定义字段别名功能保持；
- 🔒 语义保持：仅本地匹配；
- 不因别名编辑把预设字段转换成普通自定义字段；
- UI继续紧凑。

### 12.16 `src/options/App.tsx`

计划：

- 给个人基本字段接入别名编辑入口；
- 保存时保留 `fieldAliasOverrides`；
- 外部资料变更/多简历切换的 dirty 状态保护继续有效；
- 不重新引入此前已经移除的旧标签页或旧模块。

### 12.17 `src/options/EducationSection.tsx`

计划：

- 学校、学院、专业、学历、培养方式、GPA、起止时间等核心字段接入别名入口；
- 用户别名作用于字段语义，通常不需要每条教育记录重复配置；
- 每条记录自身的详细预设字段继续保留现有别名。

### 12.18 `src/options/ExperienceSection.tsx`

计划：

- 公司、职位、开始时间、结束时间、经历描述；
- 项目名称、角色、起止时间、项目描述；
- 分别接入字段语义级别名；
- 不把 `name/role/title/experience` 作为裸充分条件。

### 12.19 `src/options/AwardsSection.tsx`

计划：

- 奖项名称、角色、时间、描述接入别名；
- 只有奖项模块上下文中“名称/角色/日期/描述”才允许映射奖项字段。

### 12.20 `src/options/index.css`

计划：

- 别名编辑器默认折叠；
- 展开后尽量一行或紧凑网格；
- 小窗口正常换行；
- 不扩大现有字段字体；
- 不破坏用户已经确认的紧凑布局。

### 12.21 `src/services/llm/prompts.ts` 和 AI 相关文件

本轮默认不改 AI 语义，除非为了让“快速填充不自动调用 AI”必须做最小调整。AI统一映射方案留到本地匹配稳定后再单独实施。

### 12.22 `scripts/post-build.js`

除非构建实际失败，否则不要修改。当前项目需要把 content script 构建为可由浏览器直接加载的独立 classic script。不要为了匹配器重构撤销构建修复。

---

## 13. 测试计划

仅测试 `matchFieldType('学校名称')` 不够。至少分五层测试。

### 13.1 字符串/证据匹配单元测试

新增 `src/utils/fieldMatcher.test.ts`，至少包含：

#### 必须正确匹配

```text
姓名 → personal.name
手机号 → personal.phone
紧急联系电话 → personal.emergencyPhone
应急联系人手机 → personal.emergencyPhone
国籍 → personal.nationality
nationalityName → personal.nationality
民族 → personal.ethnicity
学校名称 → education.school
毕业（在读）院校 → education.school
collegeName → education.college
专业名称 → education.major
最高学历 → personal.highestEducation 或已确定的统一 key
公司名称 → experience.company
职位名称 → experience.position
```

#### 必须不匹配/进入 blocked

```text
推荐码
内推码
邀请码
验证码
短信验证码
导师姓名（没有对应资料时）
推荐人电话（没有对应资料时）
语种等级考试成绩（不得映射 GPA）
projectName（不得映射本人姓名）
```

#### 必须验证内部路径不抢字段

```text
education.schoolName
education.collegeName
education.majorName
education.degree
education.startDate
education.endDate
experience.companyName
experience.positionName
experience.description
```

### 13.2 别名优先级测试

新增 `src/shared/profileFieldAliases.test.ts` 或合并到匹配测试：

- 用户别名“应急联系电话”命中紧急联系人电话；
- 相同用户别名配置给两个字段时返回 ambiguous；
- blocked 字段即使被用户设成别名也不能填；
- 系统默认别名与用户别名合并且去重；
- 多简历资料的别名互不污染；
- 复制简历后修改别名不会影响原简历。

### 13.3 FormDetector 集成测试

建议新增 `src/content/formDetector.test.ts`，使用最小 DOM fixture 模拟：

- label[for]；
- Moka `data-form-field-name` 容器；
- `nationalityName` 内部 ID + 可见“国籍”；
- readonly custom select；
- shadow root；
- 同一控件不会重复检测；
- blocked/ambiguous 不进入 detected fill 列表。

### 13.4 不覆盖测试

新增 `src/content/formFillerSafety.test.ts`：

- 已有文本输入框不覆盖；
- 已有内推码不覆盖；
- 空白姓名可以填写；
- 已选择原生 select 不覆盖；
- 已选择自定义 select 不覆盖；
- 已有日期不覆盖；
- 已选 radio 组不覆盖；
- 检测时为空、写入前变成有值时仍跳过；
- 跳过项不计入 attempted/filled；
- 写入后被 React 回滚必须计 failed。

### 13.5 控件适配测试

- 文本“汉族”选择网页下拉项“汉族”；
- `6`、`06`、`6月` 等价；
- `2027` 只能选年份，不误点其他列表；
- 打开多个下拉框时只在当前弹层查找；
- 没有唯一候选时不点击；
- 点击后回读不一致时失败。

### 13.6 UI与持久化测试

- 系统别名可见但默认不可删除；
- 用户别名可新增、删除、去重；
- 保存后重新打开仍存在；
- 切换简历显示各自别名；
- 旧资料无别名配置仍能加载；
- 导入导出保留别名；
- 敏感字段别名可本地使用，但值不进入 AI payload。

### 13.7 真实页面 fixture 回归

保存脱敏后的 Moka/招聘页面表单片段作为测试 fixture，至少覆盖：

- 教育经历：就读时间、学校名称、专业名称、学历；
- 个人信息：国籍、民族、紧急联系人电话；
- 已预填内推码；
- 自定义下拉框；
- 重复两条教育经历。

不能只把截图文字手工传给 matcher；必须同时跑 `FormDetector → Matcher → Resolver → FormFiller → Verifier`。

---

## 14. 分阶段实施与每阶段验收

### 阶段 0：冻结与备份

操作：

1. 确认源码目录和浏览器加载目录；
2. 创建：

```text
D:\plug\Job-Application-Helper-backups\before-safe-matcher-YYYYMMDD-HHmmss\source
D:\plug\Job-Application-Helper-backups\before-safe-matcher-YYYYMMDD-HHmmss\loaded-extension
```

3. 运行当前测试和构建，记录基线；
4. 不因 Windows 缺少 `/bin/bash` 而修改 macOS 测试，单独记录环境性失败即可。

验收：随时可以将两个目录完整恢复。

### 阶段 1：安全止损版本

只做：

- 永久禁止字段；
- 默认不覆盖已有值；
- 写入前双检；
- 结果统计；
- 对应测试。

暂不大改别名和所有字段。

验收：

- 已填内推码绝不变化；
- 已填任意普通字段不变化；
- 空白的明确字段仍能填写；
- 构建成功并可独立加载。

完成后立即构建一个可用版本。即使后续中断，此版本也不是半成品。

### 阶段 2：统一字段注册表和小 if 匹配器

只做：

- 结构化证据；
- 字段注册表；
- 具体字段优先的 if；
- ambiguous 跳过；
- 移除模糊相似度直接填写；
- 内置与自定义候选统一优先级。

验收：

- 紧急联系电话使用紧急联系人电话；
- 本人手机号仍正确；
- 国籍不再变成姓名；
- 学校/学院/专业/学历不串；
- 导师、推荐码、语言成绩不乱填。

### 阶段 3：所有字段的别名编辑

只做：

- 数据结构；
- 持久化/备份兼容；
- UI；
- 用户别名参与最高优先级精确匹配。

验收：

- 给紧急联系人电话添加新别名后，无需复制字段即可本地填写；
- 刷新设置页、切换资料、重新加载扩展后仍存在；
- 不影响字段原值；
- 敏感值不发送给 AI。

### 阶段 4：补齐缺失字段和控件适配

只做：

- 民族、国籍、政治面貌、籍贯、紧急联系人等完整 resolver；
- 原生/自定义下拉框；
- 日期选项规范化；
- 写后验证。

验收：

- 插件保存“汉族”，网页民族下拉框可选中“汉族”；
- 国籍“中华人民共和国/中国”等只按明确映射转换；
- 学校/专业自定义下拉框能打开、选择、回读；
- 找不到候选时保持空白并报告失败。

### 阶段 5：AI映射重构（后续单独确认）

本阶段不应与前四阶段混在一次修改中。

目标：AI只对本地 unresolved 空白字段返回 profile key 映射，不覆盖、不编答案、不接触敏感值。

---

## 15. 最低验收场景

交付前必须人工或自动验证下面的完整场景：

### 场景 A：紧急联系人电话

资料：

```text
本人手机号：A
紧急联系人电话：B
```

网页：

```text
手机号码 → A
紧急联系电话 → B
```

不得出现两处都填 A。

### 场景 B：已有内推码

网页打开时：

```text
内推码：EXISTING-CODE
```

点击快速填充后必须仍为 `EXISTING-CODE`，并在结果中显示为禁止字段或已有值跳过。

### 场景 C：国籍和姓名

网页内部 ID 为 `nationalityName`，可见标题为“国籍”。必须填写国籍，不能填写中文姓名或拼音姓名。

### 场景 D：民族下拉框

资料保存“汉族”，网页民族为自定义下拉框。必须真实选中“汉族”，页面校验通过；不能只修改隐藏 input 后宣称成功。

### 场景 E：教育经历

两条教育记录同时存在，网页也有两条：

- 每条学校、学院、专业、学历、开始/结束时间在同一行内使用同一记录索引；
- 不得把第一条学校和第二条专业混在一起；
- “毕业（在读）院校”必须识别成学校；
- 年月的 `6/06/6月` 正确转换。

### 场景 F：不确定字段

网页字段只有“名称”“联系方式”“成绩”等模糊标题且没有上下文时，插件必须留空，并报告无法确定。

---

## 16. 构建、同步和交付要求

每个阶段完成后：

1. 运行与本阶段有关的定向测试；
2. 运行完整可运行测试集合；
3. 执行：

```powershell
npm run build
```

4. 确认 `dist/content.js` 是浏览器可以加载的独立脚本；
5. 将 `dist` 内容覆盖同步到：

```text
D:\plug\job-application-helper-extension
```

6. 比较 `dist/content.js` 与加载目录 `content.js` 的 SHA256；
7. 不删除用户资料，不要求重新安装依赖，不生成压缩包；
8. 告知用户只需在扩展管理页点击“重新加载”，然后刷新招聘网站标签页。

不要使用“构建成功”等同于“功能成功”。必须提供上述真实场景测试结果。

---

## 17. 禁止事项

接手者不得：

- 用一个更复杂的全局打分器替换当前全局打分器，却仍然让所有词互相竞争；
- 让“最长关键词获胜”作为最终规则；
- 让裸 `name/id/phone/contact/education/experience` 直接决定字段；
- 使用 Levenshtein 相似度直接自动填写；
- 在普通快速填充中自动调用 AI；
- 覆盖任何已有网页值；
- 自动填写内推码、验证码或密码；
- 把敏感字段值发送给 AI；
- 只跑字符串匹配测试就宣布网页控件已经填成功；
- 直接修改编译后的 `dist/content.js` 而不修改源码；
- 删除、清空或重建用户资料；
- 为了省事整体覆盖当前源码为作者仓库版本；
- 撤销 `scripts/post-build.js` 中已有的内容脚本独立打包能力；
- 一次完成全部阶段后才第一次构建。

---

## 18. 推荐的最终代码流程伪代码

```ts
async function safeQuickFill(profile: UserProfile) {
  const controls = collectFormControls();
  const candidates = buildProfileAnswerCandidates(profile);
  const result = createEmptyFillResult();

  for (const control of controls) {
    const evidence = extractFieldEvidence(control);

    const blocked = matchBlockedField(evidence);
    if (blocked) {
      result.skippedBlocked++;
      continue;
    }

    if (!isControlBlank(control)) {
      result.skippedExisting++;
      continue;
    }

    const match = matchField(evidence, candidates, profile.fieldAliasOverrides);
    if (match.status === 'ambiguous') {
      result.skippedAmbiguous++;
      continue;
    }
    if (match.status !== 'matched' || !match.profileKey) {
      continue;
    }

    const value = resolveProfileValue(match.profileKey, profile, control);
    if (!value) continue;

    // 页面可能在前面的异步操作后自动回填，因此写入前再检查一次。
    if (!isControlBlank(control)) {
      result.skippedExisting++;
      continue;
    }

    result.attempted++;
    const written = await fillByControlAdapter(control, value);
    const verified = written && await verifyControlValue(control, value);

    if (verified) result.filled++;
    else result.failed++;
  }

  return result;
}
```

匹配主函数示例：

```ts
function matchField(evidence, candidates, aliasOverrides): FieldMatchResult {
  if (isBlocked(evidence)) return blocked('禁止自动填写字段');

  const userAlias = matchExactUserAlias(evidence, candidates, aliasOverrides);
  if (userAlias.unique) return matched(userAlias.key, 'exact-user-alias');
  if (userAlias.conflict) return ambiguous(userAlias.keys);

  const systemAlias = matchExactSystemNameOrAlias(evidence, candidates);
  if (systemAlias.unique) return matched(systemAlias.key, 'exact-system-alias');
  if (systemAlias.conflict) return ambiguous(systemAlias.keys);

  // 下面按照“具体字段在前、普通字段在后”执行小 if。
  return (
    matchEmergencyPhone(evidence)
    ?? matchEmergencyName(evidence)
    ?? matchEmergencyRelationship(evidence)
    ?? matchNationality(evidence)
    ?? matchEthnicity(evidence)
    ?? matchPoliticalStatus(evidence)
    ?? matchPersonalPhone(evidence)
    ?? matchPersonalName(evidence)
    ?? matchEducationField(evidence)
    ?? matchExperienceField(evidence)
    ?? matchProjectField(evidence)
    ?? matchAwardField(evidence)
    ?? unmatched('没有唯一可靠规则')
  );
}
```

---

## 19. 接手者交付时必须汇报的内容

1. 修改前备份目录；
2. 实际修改文件列表；
3. 每个阶段完成状态；
4. 哪些字段已经接入统一注册表；
5. 哪些网页控件适配器经过测试；
6. 所有测试命令和通过/失败数量；
7. 任何环境性失败及其原因；
8. 构建产物位置；
9. 构建目录与浏览器加载目录哈希是否一致；
10. 用户下一步只需要做什么；
11. 明确列出尚未完成的内容，禁止用含糊措辞掩盖。

---

## 20. 一句话总结

这次不是继续给原作者的关键词匹配器打补丁，而是把它重构成：**每个资料字段都有独立、可配置别名和排除条件的确定性小规则；已有内容和敏感/禁止字段先保护；匹配不唯一就不填；写入后必须回读确认；AI只负责后续补填。**

---

## 21. 完整规则表（接手者必须按本节落地）

### 21.1 规则表和小 if 的关系

本方案**同时使用规则表和小 if**，二者不是二选一：

- **规则表**负责声明每个资料字段的稳定 key、标准名称、默认别名、作用域、排除语境、值类型和敏感性；
- **小 if**负责按优先级执行规则、处理复合语义和冲突，例如必须先判断“紧急联系人电话”，再判断“本人手机号”；
- 普通字段不要在代码中散落几百份别名数组。小 if 应读取统一规则表，只保留必须用上下文消歧的逻辑；
- 用户自己增加的别名在运行时合并进规则表，但不得绕过禁止字段和已有值保护。

换句话说，目标实现应当是：

```text
一张完整规则表（资料）
        +
一组有明确顺序的小 if（决策）
        =
安全的本地匹配器
```

### 21.2 全局执行优先级表

| 顺序 | 规则 | 命中后的动作 | 是否允许继续匹配 |
|---:|---|---|---|
| 0 | 控件不可见、禁用、隐藏或不是实际表单控件 | 跳过 | 否 |
| 1 | 禁止字段表命中 | `blocked`，绝不填写 | 否 |
| 2 | 网页控件已有有效值 | `skippedExisting`，绝不覆盖 | 否 |
| 3 | 用户自定义别名完整命中且唯一 | 使用对应资料 key | 否 |
| 4 | 系统标准名称完整命中且唯一 | 使用对应资料 key | 否 |
| 5 | 系统默认别名完整命中且唯一 | 使用对应资料 key | 否 |
| 6 | 字段专属小 if 在明确上下文中唯一命中 | 使用对应资料 key | 否 |
| 7 | 已知英文复合标识符完整命中 | 使用对应资料 key | 否 |
| 8 | 多个候选同级命中 | `ambiguous`，不填 | 否 |
| 9 | 仅模糊相似、仅短词命中或完全未知 | `unmatched`，不填 | 否 |

### 21.3 匹配方式代码表

| 代码 | 含义 | 是否可直接填写 |
|---|---|---|
| `EXACT_USER_ALIAS` | 网页可见标题完整等于用户别名 | 是，前提是唯一且字段为空 |
| `EXACT_LABEL` | 网页可见标题完整等于标准名称 | 是 |
| `EXACT_SYSTEM_ALIAS` | 网页可见标题完整等于系统别名 | 是 |
| `EXACT_IDENTIFIER` | `name/id/data-*` 的完整复合标识符命中 | 是，但优先级低于可见标题 |
| `CONTEXT_AND_TOKEN` | 模块上下文和字段 token 同时满足专属小 if | 是，前提是唯一 |
| `SUBSTRING_ONLY` | 仅在大字符串中包含一个词 | 否 |
| `FUZZY_ONLY` | 仅编辑距离/相似度命中 | 否，只能供日志或 AI 参考 |
| `AMBIGUOUS` | 两个或以上候选同级命中 | 否 |
| `BLOCKED` | 内推码、验证码等禁止字段 | 否 |

### 21.4 个人核心字段规则表

| 稳定 key | 标准名称 | 系统默认别名 | 明确排除语境 | 值来源 | 类型 |
|---|---|---|---|---|---|
| `personal.name` | 姓名 | 本人姓名、真实姓名、申请人姓名、候选人姓名、fullName、realName、applicantName | 紧急联系人、应急联系人、导师、指导教师、推荐人、证明人、父亲、母亲、家属、监护人、项目、公司、学校、学院、国籍 | `profile.personal.name` | text |
| `personal.gender` | 性别 | 本人性别、gender、sex | 紧急联系人、家庭成员 | `profile.personal.gender` | single/radio |
| `personal.birthDate` | 出生日期 | 出生年月日、生日、出生年月、birthDate、dateOfBirth、DOB | 子女生日、家属生日 | `profile.personal.birthDate` | date |
| `personal.phone` | 本人手机号 | 手机号、手机号码、本人联系电话、本人手机、个人电话、mobilePhone、phoneNumber | 紧急、应急、推荐人、内推人、证明人、导师、父亲、母亲、监护人、家属、单位、公司、传真 | `profile.personal.phone` | text |
| `personal.email` | 邮箱 | 电子邮箱、个人邮箱、邮箱地址、email、emailAddress | 紧急联系人、推荐人、单位邮箱 | `profile.personal.email` | text |
| `personal.wechat` | 微信号 | 微信、个人微信、WeChat、WeChat ID | 紧急联系人、推荐人 | `profile.personal.wechat` | text |
| `personal.idCard` | 身份证号 | 身份证号码、公民身份号码、证件号码、idCard、identityNumber | 证件类型、推荐人证件、家属证件 | `profile.personal.idCard` | text/sensitive |
| `personal.politicalStatus` | 政治面貌 | 政治身份、政治情况、政治状态、politicalStatus | 无明确排除 | `profile.personal.politicalStatus` | single |
| `personal.ethnicity` | 民族 | 所属民族、民族类别、ethnicity、ethnicGroup | 国籍、国家、国家/地区、nationality、citizenship | `profile.personal.ethnicity` | single |
| `personal.hometown` | 籍贯 | 原籍、祖籍、籍贯所在地、nativePlace、hometown | 户籍、现居地、出生地 | `profile.personal.hometown` | address |
| `personal.currentAddress` | 现居住地 | 现居地、目前居住地、当前所在地、居住地址、currentAddress | 户籍所在地、通讯地址、家庭地址 | `profile.personal.currentAddress` | address |
| `personal.selfEvaluation` | 自我评价 | 个人评价、自我描述、个人总结、个人优势、selfEvaluation、personalSummary | 项目描述、工作描述、奖项描述 | `profile.personal.selfEvaluation` | textarea |

#### 个人核心字段专属顺序

```text
紧急联系人字段
→ 证明人/推荐人/导师/家庭成员字段
→ 国籍、民族、政治面貌、籍贯、地址字段
→ 本人手机号、本人邮箱、本人姓名
```

不能把 `type="tel"` 直接当作本人手机号；它只说明值格式像电话号码。

### 21.5 更多个人信息预设字段规则表

以下 key 与当前 `profilePresets.ts` 的 `personal.*` presetKey 对齐。

| 稳定 key | 标准名称 | 当前系统别名 | 建议补充别名 | 排除/说明 | 类型/敏感 |
|---|---|---|---|---|---|
| `personal.englishName` | 英文姓名 / 姓名拼音 | 英文名、姓名拼音、拼音姓名、name in English | 英文姓名、中文名拼音、拼音 | 本人姓名规则不得抢；`name` 不能单独命中 | text |
| `personal.formerName` | 曾用名 | 原姓名 | 曾用姓名、previousName、formerName | 不得填入本人姓名 | text |
| `personal.nationality` | 国籍 | 国家、国家/地区 | nationality、citizenship、countryOfCitizenship | 排除出生国家、证件国家、学校国家；必须先于 `name` | single |
| `personal.maritalStatus` | 婚姻状况 | 婚姻情况 | 婚姻状态、maritalStatus | 无 | single |
| `personal.height` | 身高 | 身高(cm)、身高（厘米） | 身高厘米、height | 排除家庭成员身高 | number/cm |
| `personal.weight` | 体重 | 体重(kg)、体重（公斤） | 体重公斤、weight | 排除家庭成员体重 | number/kg |
| `personal.bloodType` | 血型 | 血液类型 | bloodType | 无 | single |
| `personal.health` | 健康状况 | 身体状况、健康情况 | 健康状态、healthStatus | 无 | single |
| `personal.leftVision` | 左眼视力 | 左眼、左视力 | 左眼裸眼视力 | “左眼”只在视力模块/标签明确时命中 | text |
| `personal.rightVision` | 右眼视力 | 右眼、右视力 | 右眼裸眼视力 | 同上 | text |
| `personal.colorVision` | 色觉 | 辨色能力、色盲色弱 | 色觉情况、colorVision | 无 | single |
| `personal.highestEducation` | 最高学历 | 学历层次、最高教育程度、文化程度 | 最终学历、最高学历层次 | 不得抢教育经历中每条记录的学历 | single |
| `personal.highestDegree` | 最高学位 | 学位、最高学位层次 | 最终学位 | 单独“学位”在个人区才可命中；教育记录中归 `education.academicDegree` | single |
| `personal.graduationClass` | 毕业届别 | 毕业年份、毕业年度、应届年份 | 毕业届、毕业年份届别 | “毕业年份”若在教育日期控件中应归日期 | text/届 |
| `personal.freshGraduate` | 是否应届生 | 应届生、是否为应届毕业生 | 应届毕业生、应届身份 | 无 | boolean |
| `personal.hasWorkExperience` | 是否有工作 / 实习经验 | 有无工作经验、是否有实习经历、是否有工作经历 | 工作经历情况、实习经历情况 | 不能匹配经历描述 | boolean |
| `personal.workYears` | 工作经验年限 | 工作年限、累计工作年限、工作经验 | 从业年限、工作经验几年 | 单独“工作经验”可能是布尔题，需结合“年限/几年” | number/年 |
| `personal.overseasExperience` | 是否有海外留学 / 交换经历 | 海外留学经历、海外学习经历、留学经历 | 是否有留学经历、海外经历 | 不能把具体学校/国家字段映射到这里 | boolean |
| `personal.householdRegistration` | 户籍所在地 | 户口所在地、户口地址、户籍地址 | 户籍、户口、户籍地 | 排除现居地、通讯地址 | address |
| `personal.mailingAddress` | 通讯地址 | 通信地址、联系地址、邮寄地址 | 收件地址 | 排除现居地、户籍地址 | address |
| `personal.idType` | 证件类型 | 身份证件类型、证件类别 | 证件种类、documentType | 不能匹配证件号码 | single/敏感 |
| `personal.emergencyName` | 紧急联系人姓名 | 紧急联系人、联系人姓名 | 应急联系人姓名、紧急联络人 | 必须先于本人姓名；单独“联系人姓名”需有紧急模块上下文 | text/敏感 |
| `personal.emergencyRelationship` | 紧急联系人关系 | 与紧急联系人关系、联系人关系 | 应急联系人关系、与本人关系 | 必须有紧急/应急联系人上下文 | single/敏感 |
| `personal.emergencyPhone` | 紧急联系人电话 | 紧急联系电话、联系人手机 | 应急联系人电话、应急联系人手机、紧急联系人手机号、紧急联络电话 | 必须先于本人手机号；不得回退本人手机号 | text/敏感 |
| `personal.github` | GitHub / 个人主页 | Github、个人主页、代码仓库、技术主页 | GitHub地址、GitHub链接 | 与作品集/博客冲突时 ambiguous | url |
| `personal.portfolio` | 博客 / 作品集 | 个人博客、作品集链接、Portfolio | 博客地址、作品集地址 | 与个人主页冲突时优先完整标题 | url |
| `personal.linkedin` | LinkedIn | 领英 | LinkedIn主页、领英主页 | 无 | url |
| `personal.hobbies` | 兴趣爱好 | 爱好 | 个人爱好、兴趣、hobby | 不得匹配技能/特长 | textarea |
| `personal.strengths` | 特长 | 个人特长、擅长领域 | 特殊技能、优势特长 | 不得匹配专业技能 | textarea |

### 21.6 教育经历核心字段规则表

| 稳定 key | 标准名称 | 系统默认别名 | 必需上下文/排除 | 值来源 | 类型 |
|---|---|---|---|---|---|
| `education.school` | 学校 | 学校名称、院校、院校名称、就读学校、就读院校、毕业院校、毕业（在读）院校、schoolName、universityName、almaMater | 排除学院、学校类型、交换学校；“毕业院校”优先学校而不是毕业时间 | `education[index].school` | text/select |
| `education.college` | 学院 | 学院名称、院系、所在学院、所属学院、系别、院系名称、collegeName、departmentName、facultyName | 必须在教育记录内；排除学校名称 | `education[index].college` | text/select |
| `education.educationType` | 学历类型/培养方式 | 学习形式、培养方式、教育类型、全日制类型、educationType、studyType | 排除最高学历、学位 | `education[index].educationType` | single |
| `education.major` | 专业 | 专业名称、所学专业、主修专业、majorName、fieldOfStudy、specialty | 排除专业方向、专业类别、辅修专业 | `education[index].major` | text/select |
| `education.degree` | 学历 | 学历层次、教育程度、degree、educationLevel、qualification | 教育记录内；排除最高学历和学位 | `education[index].degree` | single |
| `education.gpa` | GPA/绩点 | 绩点、学分绩点、平均绩点、gradePoint | 排除 GPA满分、考试成绩、语言成绩、课程成绩 | `education[index].gpa` | text/number |
| `education.ranking` | 排名 | 专业排名、综合排名、年级排名、班级排名 | 排除奖项排名、作者排名、项目排名 | `education[index].ranking` | text |
| `education.startDate` | 入学时间 | 入学日期、入学年月、就读开始时间、教育开始时间、enrollmentDate、educationStartDate | 必须同时具备教育上下文和时间语义 | `education[index].startDate` | month/date parts |
| `education.endDate` | 毕业时间 | 毕业日期、毕业年月、就读结束时间、educationEndDate、graduationDate | “毕业院校”不得命中；必须有时间/日期/年月语义 | `education[index].endDate` | month/date parts |

### 21.7 教育经历详细预设字段规则表

| 稳定 key | 标准名称 | 当前系统别名 | 排除/说明 | 类型 |
|---|---|---|---|---|
| `education.academicDegree` | 学位 | 获得学位、学位层次 | 教育记录内；与个人最高学位分开 | single |
| `education.schoolType` | 学校类型 | 院校类型、学校层次 | 不得匹配学校名称 | multi |
| `education.majorDirection` | 专业方向 | 研究方向、专业研究方向 | 不得匹配专业名称 | text |
| `education.majorCategory` | 专业类别 | 学科门类、专业门类 | 不得匹配专业名称 | single |
| `education.expectedGraduation` | 预计毕业时间 | 预毕业时间、预计毕业日期 | 明确“预计”；不得抢普通毕业时间 | month |
| `education.actualGraduation` | 实际毕业时间 | 正式毕业时间 | 明确“实际/正式” | month |
| `education.programLength` | 学制 | 培养年限 | 排除工作年限 | number/年 |
| `education.gpaScale` | GPA满分 | 绩点满分、GPA总分 | 不得匹配实际 GPA | number |
| `education.failedCourses` | 是否有挂科 | 有无挂科、是否存在不及格科目 | 无 | boolean |
| `education.failedCourseCount` | 挂科科目数 | 不及格科目数 | 必须有“数/数量/科目数” | number/门 |
| `education.coreCourses` | 主修 / 核心课程 | 主修课程、核心课程、主要课程 | 不得匹配专业 | textarea |
| `education.thesisTitle` | 毕业论文题目 | 学位论文题目、论文名称 | 必须有论文上下文 | text |
| `education.thesisAdvisor` | 毕业论文导师 | 导师姓名、研究生导师 | 必须先于本人姓名 | text |
| `education.thesisStatus` | 毕业论文状态 | 论文进度 | 无 | single |
| `education.hasMinor` | 是否辅修 | 有无辅修 | 无 | boolean |
| `education.minorMajor` | 辅修专业 | 第二专业 | 不得匹配主修专业 | text |
| `education.minorDegree` | 辅修学位 | 第二学位 | 不得匹配主学位 | text |
| `education.hasExchange` | 是否有交换经历 | 海外交换经历、交换生经历 | 与个人海外经历布尔题按模块区分 | boolean |
| `education.exchangeSchool` | 交换学校 | 交换院校 | 不得匹配主学校 | text |
| `education.exchangePeriod` | 交换时间 | 交换起止时间 | 必须有交换上下文 | date-range |

### 21.8 实习/工作经历核心及详细字段规则表

| 稳定 key | 标准名称 | 系统默认别名 | 排除/说明 | 类型/取值 |
|---|---|---|---|---|
| `experience.company` | 公司/单位 | 公司名称、单位名称、工作单位、实习单位、employer、companyName、organizationName | 排除学校、颁奖单位、工作单位（家庭模块） | core `company` |
| `experience.position` | 职位/岗位 | 职位名称、岗位名称、职务、jobTitle、positionName | 排除证明人职位、家庭成员职务、项目角色 | core `position` |
| `experience.startDate` | 工作开始时间 | 入职时间、实习开始时间、任职开始、workStartDate | 必须有工作/实习上下文 | core `startDate` |
| `experience.endDate` | 工作结束时间 | 离职时间、实习结束时间、任职结束、workEndDate | 必须有工作/实习上下文 | core `endDate` |
| `experience.description` | 工作内容/经历描述 | 岗位职责、工作职责、主要工作、实习内容、responsibilities | 排除项目描述、奖项描述、个人评价 | core `description` |
| `experience.organizationNature` | 单位性质 | 公司性质、企业性质 | 不得匹配单位名称 | single |
| `experience.industry` | 单位行业 | 所属行业、公司行业 | 无 | text |
| `experience.organizationSize` | 单位规模 | 公司规模、企业规模 | 不得匹配项目用户规模 | single |
| `experience.fortune500` | 是否世界500强 | 世界五百强、是否500强 | 无 | boolean |
| `experience.department` | 部门 | 所在部门、所属部门 | 排除学校院系 | text |
| `experience.positionCategory` | 职位类别 | 岗位类别、职能类别 | 不得匹配职位名称 | single |
| `experience.workLocation` | 工作地点 | 实习地点、任职地点 | 排除现居地、期望城市 | address |
| `experience.fullTimeInternship` | 是否全职实习 | 全职实习 | 无 | boolean |
| `experience.internshipSalary` | 实习薪资 | 实习工资、薪资标准 | 排除期望薪资 | text |
| `experience.workResults` | 工作成果 | 主要成果、工作业绩、实习成果 | 必须有工作/实习上下文 | textarea |
| `experience.technologies` | 使用工具 / 技术 | 技术栈、使用技术、使用工具 | 必须有工作经历上下文 | multi |
| `experience.leavingReason` | 离职原因 | 离职理由 | 无 | textarea |
| `experience.referenceName` | 证明人姓名 | 联系人姓名、背调联系人 | 必须有证明人/背调上下文；先于本人姓名 | text/敏感 |
| `experience.referencePosition` | 证明人职位 | 证明人职务 | 先于本人职位 | text/敏感 |
| `experience.referencePhone` | 证明人联系方式 | 证明人电话 | 先于本人手机号 | text/敏感 |
| `experience.proofAvailable` | 是否可提供证明 | 能否提供实习证明 | 无 | boolean |

### 21.9 项目经历核心及详细字段规则表

| 稳定 key | 标准名称 | 系统默认别名 | 排除/说明 | 类型/取值 |
|---|---|---|---|---|
| `project.name` | 项目名称 | 项目名、课题名称、projectName | 必须有项目上下文；不得匹配本人姓名 | core `name` |
| `project.role` | 项目角色 | 担任角色、本人角色、项目职责 | 必须有项目上下文；不得匹配职位 | core `role` |
| `project.startDate` | 项目开始时间 | 项目起始时间、projectStartDate | 必须有项目上下文 | core `startDate` |
| `project.endDate` | 项目结束时间 | 项目完成时间、projectEndDate | 必须有项目上下文 | core `endDate` |
| `project.description` | 项目描述 | 项目简介、项目内容、projectDescription | 不得匹配工作描述 | core `description` |
| `project.projectType` | 项目类型 | 项目类别 | 无 | single |
| `project.projectLevel` | 项目级别 | 项目等级 | 无 | single |
| `project.personalDuty` | 个人职责 | 本人职责、主要职责、个人贡献 | 必须有项目上下文 | textarea |
| `project.difficulties` | 项目难点 | 技术难点、关键难点 | 无 | textarea |
| `project.results` | 项目成果 | 项目成效、量化成果 | 必须有项目上下文 | textarea |
| `project.technologies` | 使用技术 / 工具 | 技术栈、项目技术 | 必须有项目上下文 | multi |
| `project.projectUrl` | 项目链接 | 项目地址、演示地址 | 无 | url |
| `project.launched` | 项目是否上线 | 是否已上线、项目已落地 | 无 | boolean |
| `project.userScale` | 用户规模 | 用户量、使用人数 | 排除公司规模 | text |
| `project.openSource` | 是否开源 | 开源项目 | 无 | boolean |
| `project.stars` | 开源仓库 Star 数 | GitHub Stars、Star数 | 必须有开源/仓库上下文 | number |

### 21.10 奖项/荣誉核心及详细字段规则表

| 稳定 key | 标准名称 | 系统默认别名 | 排除/说明 | 类型/取值 |
|---|---|---|---|---|
| `award.name` | 奖项名称 | 荣誉名称、获奖名称、awardName | 必须有奖项/荣誉上下文 | core `name` |
| `award.role` | 获奖角色 | 奖项角色、团队角色 | 必须有奖项上下文 | core `role` |
| `award.date` | 获奖时间 | 获奖日期、奖项时间、awardDate | 必须有奖项上下文 | core `date` |
| `award.description` | 奖项描述 | 获奖描述、荣誉描述、awardDescription | 必须有奖项上下文 | core `description` |
| `award.awardCategory` | 奖项类别 | 获奖类别 | 无 | single |
| `award.awardLevel` | 奖项级别 | 获奖级别 | 与奖项等级分开 | single |
| `award.awardGrade` | 奖项等级 | 获奖等级 | 与奖项级别分开 | single |
| `award.issuer` | 颁奖单位 | 授奖单位、颁发机构 | 不得匹配工作单位 | text |
| `award.ranking` | 获奖排名 | 团队排名、个人排名 | 必须有奖项上下文 | number |
| `award.teamSize` | 团队人数 | 获奖团队人数 | 无 | number/人 |
| `award.personalAward` | 是否个人奖 | 个人奖项 | 无 | boolean |
| `award.verifiable` | 是否可核验 | 能否核验 | 无 | boolean |

### 21.11 一级常用模块规则表

一级常用模块的每个字段继续使用稳定 `module.<moduleKey>.<fieldKey>`。模块名必须作为作用域，模块内部的“姓名、名称、职位、电话、成绩”等短标题**只能在对应模块内匹配**。

#### 校园经历 `module.campus.*`

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.campus.organization` | 组织名称 | 社团名称、学生组织 | text |
| `module.campus.position` | 担任职务 | 校园职务 | text |
| `module.campus.level` | 职务级别 | 组织级别 | single |
| `module.campus.period` | 任职时间 | 开始时间、结束时间、任职起止时间 | date-range |
| `module.campus.organizationSize` | 组织规模 | 管理人数 | number/人 |
| `module.campus.responsibilities` | 主要职责 | 工作职责 | textarea |
| `module.campus.results` | 量化成果 | 主要成果 | textarea |
| `module.campus.largeEvent` | 是否组织过大型活动 | 组织大型活动 | boolean |
| `module.campus.eventScale` | 活动规模 | 活动人数 | number/人 |

#### 语言能力 `module.languages.*`

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.languages.language` | 语言 | 语种 | single |
| `module.languages.certificate` | 证书类型 | 语言证书、考试类型 | single |
| `module.languages.score` | 证书分数 | 考试分数、成绩 | text |
| `module.languages.level` | 综合水平 | 熟练程度 | single |
| `module.languages.workLanguage` | 是否可作为工作语言 | 工作语言 | boolean |
| `module.languages.obtainedAt` | 证书获得时间 | 通过时间 | month |

“成绩”只有在语言能力模块内才允许映射 `module.languages.score`，不得映射教育 GPA。

#### 专业技能明细 `module.skills.*`

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.skills.name` | 技能名称 | 专业技能 | text |
| `module.skills.category` | 技能类别 | 技能分类 | single |
| `module.skills.level` | 熟练程度 | 掌握程度 | single |
| `module.skills.duration` | 使用时长 | 使用年限 | number/月 |
| `module.skills.projectVerified` | 是否有项目验证 | 是否用于项目 | boolean |
| `module.skills.relatedProject` | 关联项目 | 应用项目 | text |

#### 学术论文 `module.papers.*`

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.papers.title` | 论文标题 | 论文题目 | text |
| `module.papers.type` | 论文类型 | 论文类别 | single |
| `module.papers.status` | 发表状态 | 论文状态 | single |
| `module.papers.authorRank` | 作者排名 | 第几作者 | number |
| `module.papers.coFirst` | 是否共同一作 | 共同第一作者 | boolean |
| `module.papers.corresponding` | 是否通讯作者 | 通讯作者 | boolean |
| `module.papers.venue` | 期刊 / 会议名称 | 发表刊物、会议名称 | text |
| `module.papers.indexing` | 收录类型 | 检索类型 | multi |
| `module.papers.partition` | 分区 / CCF等级 | JCR分区、中科院分区、CCF等级 | text |
| `module.papers.publishedAt` | 发表时间 | 出版时间 | month |
| `module.papers.doi` | DOI | 论文DOI | text |
| `module.papers.url` | 论文链接 | 论文地址 | url |
| `module.papers.abstract` | 论文摘要 | 摘要 | textarea |
| `module.papers.keywords` | 关键词 | 关键字 | multi |

#### 科研项目 `module.research.*`

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.research.name` | 项目名称 | 课题名称 | text |
| `module.research.level` | 项目级别 | 课题级别 | single |
| `module.research.source` | 项目来源 | 课题来源 | text |
| `module.research.number` | 项目编号 | 课题编号 | text |
| `module.research.role` | 项目角色 | 本人角色 | single |
| `module.research.period` | 项目时间 | 项目起止时间 | date-range |
| `module.research.funding` | 项目经费 | 课题经费 | number/万元 |
| `module.research.status` | 项目状态 | 课题状态 | single |
| `module.research.description` | 项目描述 | 课题描述 | textarea |
| `module.research.contribution` | 个人贡献 | 本人贡献 | textarea |
| `module.research.results` | 项目成果 | 科研成果 | textarea |

#### 专利 / 软件著作权 `module.patents.*`

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.patents.type` | 类型 | 成果类型 | single |
| `module.patents.name` | 名称 | 专利名称、软著名称 | text |
| `module.patents.applicationNumber` | 申请号 / 登记号 | 登记号、申请号 | text |
| `module.patents.authorizationNumber` | 公开号 / 授权号 | 授权号、公开号 | text |
| `module.patents.status` | 状态 | 申请状态 | single |
| `module.patents.rank` | 申请人排名 | 发明人排名 | number |
| `module.patents.firstInventor` | 是否第一发明人 | 第一发明人 | boolean |
| `module.patents.appliedAt` | 申请时间 | 提交时间 | date |
| `module.patents.authorizedAt` | 授权时间 | 获批时间 | date |
| `module.patents.owner` | 专利权人 | 著作权人 | text |
| `module.patents.abstract` | 摘要 | 专利摘要 | textarea |

#### 求职意向与期望薪酬 `module.jobIntent.*`

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.jobIntent.positions` | 期望岗位 | 意向岗位、求职岗位 | multi |
| `module.jobIntent.category` | 期望岗位类别 | 意向职位类别 | single |
| `module.jobIntent.industries` | 期望行业 | 意向行业 | multi |
| `module.jobIntent.employmentType` | 期望工作性质 | 工作类型 | single |
| `module.jobIntent.cities` | 期望工作城市 | 意向城市、期望地点 | multi |
| `module.jobIntent.arrivalDate` | 最快到岗时间 | 可到岗时间 | date |
| `module.jobIntent.internshipMonths` | 可实习时长 | 实习周期 | number/月 |
| `module.jobIntent.jobStatus` | 求职状态 | 当前状态 | single |
| `module.jobIntent.relocation` | 是否接受城市调剂 | 接受调剂城市 | boolean |
| `module.jobIntent.travel` | 是否接受出差 | 能否出差 | boolean |
| `module.jobIntent.shift` | 是否接受轮班 | 能否倒班 | boolean |
| `module.jobIntent.overseas` | 是否接受海外派遣 | 海外工作 | boolean |
| `module.jobIntent.salaryType` | 薪酬类型 | 期望薪资类型 | single |
| `module.jobIntent.salaryMin` | 期望薪酬下限 | 最低期望薪资 | number |
| `module.jobIntent.salaryMax` | 期望薪酬上限 | 最高期望薪资 | number |
| `module.jobIntent.salaryCurrency` | 薪酬币种 | 工资币种 | single |
| `module.jobIntent.negotiable` | 薪酬是否可谈 | 薪资面议 | boolean |
| `module.jobIntent.benefits` | 其他福利要求 | 福利期望 | textarea |

#### 家庭成员 `module.family.*`

家庭成员全部属于敏感字段，只能在家庭成员模块中匹配，且只允许本地使用。

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.family.name` | 姓名 | 家属姓名 | text/敏感 |
| `module.family.relationship` | 与本人关系 | 关系、亲属关系 | single/敏感 |
| `module.family.organization` | 工作单位 | 所在单位 | text/敏感 |
| `module.family.position` | 职务 | 职位 | text/敏感 |
| `module.family.phone` | 联系电话 | 手机号码 | text/敏感 |

家庭模块中的“姓名、职位、联系电话”不得被本人姓名、本人职位、本人手机号规则抢走。

### 21.12 可选模板规则表

这些模板只有用户主动添加后才进入答案候选；未添加时不得凭空生成或参与匹配。

#### 学术著作与教材 `module.books.*`

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.books.name` | 著作名称 | 用户可添加 | text |
| `module.books.type` | 类型 | 著作类型 | single |
| `module.books.publisher` | 出版社 | 出版单位 | text |
| `module.books.isbn` | ISBN | 书号 | text |
| `module.books.publishedAt` | 出版时间 | 出版日期 | month |
| `module.books.authorRank` | 作者排名 | 第几作者 | number |
| `module.books.writtenWords` | 本人撰写字数 | 撰写字数 | number/万字 |

#### 学术会议与活动 `module.conferences.*`

| key | 标准名称 | 默认别名 | 类型 |
|---|---|---|---|
| `module.conferences.name` | 会议名称 | 学术会议名称 | text |
| `module.conferences.level` | 会议级别 | 会议等级 | single |
| `module.conferences.location` | 会议地点 | 举办地点 | address |
| `module.conferences.date` | 会议时间 | 举办时间 | month |
| `module.conferences.role` | 参与角色 | 参会角色 | single |
| `module.conferences.reportTitle` | 报告题目 | 报告名称 | text |
| `module.conferences.invited` | 是否受邀 | 受邀参会 | boolean |

### 21.13 自定义字段通用规则表

| 条件 | 处理规则 |
|---|---|
| 自定义字段没有名称 | 不参与匹配 |
| 自定义字段没有值 | 不参与自动填写 |
| 用户别名完整等于网页可见标题 | 高优先级候选 |
| 自定义字段名称完整等于网页可见标题 | 高优先级候选 |
| 两个自定义字段使用同一别名 | 返回 ambiguous，不按数组顺序取第一个 |
| 自定义别名只有一个危险短词，如“名称”“电话”“时间” | UI提示并禁止作为充分条件 |
| 自定义字段标记敏感 | 可本地匹配，值不得进入 AI payload |
| 自定义字段属于重复模块 | 使用模块和记录行定位索引，不能只按全页出现顺序 |
| 网页字段命中永久禁止表 | 即使用户设置同名别名也不得填写 |

### 21.14 永久禁止规则表

| 类别 | 中文匹配 | 英文/内部标识符匹配 | 动作 |
|---|---|---|---|
| 内推 | 内推码、内推编码、内部推荐码、员工内推码 | `referralCode`、`employeeReferralCode` | blocked |
| 推荐码 | 推荐码、推荐编码、推荐编号 | `recommendCode`、`recommendationCode` | blocked |
| 邀请码 | 邀请码、邀请码编号 | `inviteCode`、`invitationCode` | blocked |
| 验证码 | 验证码、短信验证码、邮箱验证码、图形验证码、动态码 | `verifyCode`、`verificationCode`、`captcha`、`otp` | blocked |
| 密码 | 密码、登录密码、确认密码、新密码 | `password`、`confirmPassword`、`newPassword` | blocked |
| 系统编号 | 申请编号、系统流水号、候选人编号（只读） | `applicationId`、`systemId` | blocked/readonly |

说明：推荐人姓名、推荐人电话不一定属于“码”，不能仅因包含“推荐人”就归 blocked；如果资料库没有对应的明确推荐人字段，应返回 unmatched，而不是填本人信息。

### 21.15 高风险冲突裁决表

| 网页文字/标识符 | 正确结果 | 必须禁止的错误结果 |
|---|---|---|
| 紧急联系电话 | `personal.emergencyPhone` | `personal.phone` |
| 紧急联系人姓名 | `personal.emergencyName` | `personal.name` |
| 证明人电话 | `experience.referencePhone`（有对应记录时） | `personal.phone` |
| 导师姓名 | `education.thesisAdvisor`（有对应记录时） | `personal.name` |
| nationalityName | `personal.nationality` | `personal.name` / `personal.englishName` |
| 民族 | `personal.ethnicity` | `personal.nationality` |
| 毕业（在读）院校 | `education.school` | `education.endDate` |
| education.schoolName | `education.school` | `education.degree` |
| education.collegeName | `education.college` | `education.school` / `education.degree` |
| education.majorName | `education.major` | `education.degree` |
| experience.companyName | `experience.company` | `experience.description` |
| experience.positionName | `experience.position` | `experience.description` |
| projectName | `project.name` | `personal.name` |
| 语种等级考试成绩 | `module.languages.score`（语言模块内）或 unmatched | `education.gpa` |
| 内推码 | blocked | 任意个人/自定义资料 |

### 21.16 规则表的实现约束

1. 上述表是第一版系统规则基线，不能继续分散在 `constants.ts`、多个组件和多个 matcher 中各维护一份。
2. `profilePresets.ts` 中已经存在的标准名称和别名可以由注册表生成器读取，但核心字段必须在同一个注册表中补齐。
3. 系统规则表只保存语义，不负责直接操作 DOM。
4. 小 if 只负责上下文与排除条件，不重复硬编码整套别名。
5. 用户别名必须按稳定 key 合并，不能通过复制字段解决同义题目。
6. 完整标题优先于内部 ID；具体字段优先于普通字段；模块内字段优先于模块外通用短词。
7. 任意规则新增时必须同时添加：正确命中测试、相邻字段不误命中测试、已有值不覆盖测试。
8. 第一版实施时，如某个表中字段的实际资料路径与当前模型不一致，应先统一 resolver，再修改 key；不得临时回退到宽泛字符串猜测。
