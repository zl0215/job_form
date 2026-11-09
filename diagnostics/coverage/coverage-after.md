# 真实网申字段离线匹配覆盖率报告（after）

- 生成时间：2026-11-09T10:03:10.205Z
- 类型：offline-matching-diagnostic（**离线映射诊断：字段证据来自旧工具目录的 label/section/type 元数据（无 name/id/placeholder），候选资料为固定占位 UserProfile；不是真实页 DOM 提取，不是已部署扩展的端到端验收。**）
- 字段目录：`D:\PythonDemo_learn\tools\简历投递信息填写\diagnostics\coverage\field-catalog.json`（941 条；其中 ≤30 字短标签 883 条）
- 目录来源 profile.json updatedAt：2026-10-31T13:54:25.830850+00:00；SHA-256：`6eab1a61d36dffd1…`
- 占位候选：206 个（自定义字段 171 个；占位资料：所有注册表/预设/模块字段填固定占位值（每个候选唯一），不读取真实资料。）
- 规则指纹（sha256 前 16 位）：
  - `extension-src/src/shared/profileFieldRegistry.ts` → `65f20f2f288ed80e`
  - `extension-src/src/shared/blockedFields.ts` → `db302effd1fa5222`
  - `extension-src/src/shared/profilePresets.ts` → `c46fa6c125c3ce1c`
  - `extension-src/src/utils/fieldMatcher.ts` → `57476e641ecf26fb`
  - `extension-src/src/utils/fieldText.ts` → `b5184e23f56c8b45`
  - `extension-src/src/shared/profileAnswerCandidates.ts` → `c4684b570ea3fa08`

> 本报告只有字段标签与计数，不包含任何个人答案值。覆盖率 = matched / 字段总数；
> blocked 表示按安全规则永久禁止填写（不算缺口）；ambiguous 表示规则冲突；
> unmatched 表示规则缺口。旧工具 ready 但新引擎未命中（oldReadyMissed）是最高优先级回归。

## 总览

| 分组 | 字段数 | matched | 覆盖率 | blocked | ambiguous | unmatched | 命中但无值 | 旧ready总数 | 旧ready未命中 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 全部字段 | 941 | 668 | 71.0% | 2 | 2 | 269 | 0 | 214 | 18 |
| 短标签(≤30字) | 883 | 652 | 73.8% | 2 | 2 | 227 | 0 | 213 | 17 |

## 按站点

| 站点 | 字段数 | matched | 覆盖率 | blocked | ambiguous | unmatched | 命中但无值 | 旧ready总数 | 旧ready未命中 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| app.mokahr.com | 69 | 54 | 78.3% | 2 | 0 | 13 | 0 | 18 | 1 |
| careers.eccom.com.cn | 6 | 4 | 66.7% | 0 | 0 | 2 | 0 | 4 | 0 |
| chinastock.zhiye.com | 112 | 65 | 58.0% | 0 | 0 | 47 | 0 | 17 | 2 |
| recruitment.uco.com | 10 | 8 | 80.0% | 0 | 2 | 0 | 0 | 4 | 0 |
| scbank.hotjob.cn | 115 | 67 | 58.3% | 0 | 0 | 48 | 0 | 17 | 0 |
| starnet.zhiye.com | 41 | 31 | 75.6% | 0 | 0 | 10 | 0 | 15 | 0 |
| webhr.shccig.com | 10 | 6 | 60.0% | 0 | 0 | 4 | 0 | 0 | 0 |
| wecruit.hotjob.cn | 302 | 248 | 82.1% | 0 | 0 | 54 | 0 | 90 | 11 |
| xjnsyh2026.zhaopin.com | 55 | 38 | 69.1% | 0 | 0 | 17 | 0 | 2 | 0 |
| xyz.51job.com | 106 | 73 | 68.9% | 0 | 0 | 33 | 0 | 15 | 0 |
| zhaopin.china-cdt.com | 4 | 3 | 75.0% | 0 | 0 | 1 | 0 | 0 | 0 |
| zhaopin.sgcc.com.cn | 82 | 43 | 52.4% | 0 | 0 | 39 | 0 | 22 | 3 |
| zhonghuan.zhiye.com | 29 | 28 | 96.6% | 0 | 0 | 1 | 0 | 10 | 1 |

## 按旧工具状态

| 旧状态 | 字段数 | matched | 覆盖率 | blocked | ambiguous | unmatched | 命中但无值 | 旧ready总数 | 旧ready未命中 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unmatched | 414 | 188 | 45.4% | 1 | 2 | 223 | 0 | 0 | 0 |
| incompatible | 146 | 140 | 95.9% | 0 | 0 | 6 | 0 | 0 | 0 |
| ready | 214 | 196 | 91.6% | 0 | 0 | 18 | 0 | 214 | 18 |
| missing | 46 | 42 | 91.3% | 1 | 0 | 3 | 0 | 0 | 0 |
| review | 121 | 102 | 84.3% | 0 | 0 | 19 | 0 | 0 | 0 |

## 命中分布（按资料 key）

| 资料 key | 命中字段数 |
| --- | --- |
| education.endDate | 48 |
| education.school | 44 |
| education.major | 36 |
| education.startDate | 28 |
| education.degree | 26 |
| experience.position | 19 |
| module.languages.level | 19 |
| personal.name | 18 |
| experience.company | 17 |
| personal.phone | 17 |
| personal.hometown | 17 |
| personal.highestEducation | 16 |
| personal.email | 15 |
| personal.birthDate | 14 |
| personal.idCard | 14 |
| education.academicDegree | 14 |
| personal.gender | 13 |
| module.jobIntent.cities | 13 |
| personal.householdRegistration | 13 |
| personal.currentAddress | 12 |
| education.schoolCity | 12 |
| personal.politicalStatus | 11 |
| personal.ethnicity | 11 |
| education.educationType | 10 |
| education.ranking | 9 |
| module.languages.language | 8 |
| personal.idType | 7 |
| education.exchangePeriod | 7 |
| personal.emergencyPhone | 7 |
| personal.mailingAddress | 7 |
| personal.selfEvaluation | 7 |
| module.jobIntent.relocation | 6 |
| personal.maritalStatus | 6 |
| personal.gaokaoLocation | 6 |
| education.coreCourses | 6 |
| personal.weight | 5 |
| personal.nationality | 5 |
| personal.height | 5 |
| education.schoolType | 5 |
| education.gpa | 5 |
| module.jobIntent.salaryExpected | 5 |
| experience.description | 4 |
| experience.startDate | 4 |
| experience.endDate | 4 |
| module.family.phone | 4 |
| personal.highestDegree | 4 |
| personal.englishLevel | 4 |
| module.family.name | 3 |
| project.description | 3 |
| personal.studentOrigin | 3 |
| education.college | 3 |
| module.family.relationship | 3 |
| module.family.organization | 3 |
| personal.workYears | 3 |
| personal.overseasExperience | 3 |
| personal.hobbies | 2 |
| education.admissionType | 2 |
| award.name | 2 |
| award.date | 2 |
| project.personalDuty | 2 |
| project.name | 2 |
| personal.health | 2 |
| personal.emergencyName | 2 |
| module.papers.publishedAt | 2 |
| module.papers.title | 2 |
| module.papers.venue | 2 |
| module.jobIntent.overseas | 2 |
| module.languages.workLanguage | 2 |
| module.languages.score | 2 |
| personal.wechat | 2 |
| experience.positionCategory | 2 |
| module.jobIntent.employmentType | 2 |
| module.campus.period | 2 |
| module.jobIntent.positions | 2 |
| education.gpaScale | 2 |
| education.expectedGraduation | 2 |
| education.thesisTitle | 2 |
| education.majorDirection | 2 |
| module.campus.position | 2 |
| module.skills.name | 1 |
| experience.workLocation | 1 |
| module.family.position | 1 |
| module.jobIntent.arrivalDate | 1 |
| experience.workResults | 1 |
| module.papers.abstract | 1 |
| personal.postalCode | 1 |
| module.papers.authorRank | 1 |
| module.papers.doi | 1 |

## 未命中字段清单（短标签，共 227 条；按站点分组）

### app.mokahr.com（13）

- `关系` | section=其他 | type=combobox | required=false | seen=15 | old=unmatched
- `是否有过违法行为` | section=其他 | type=combobox | required=false | seen=15 | old=unmatched
- `是否至今` | section=实习经历 | type=checkbox | required=false | seen=3 | old=missing canon=project.ongoing
- `是否至今` | section=实习经历 | type=checkbox | required=false | seen=1 | old=missing
- `就读时间` | section=教育经历 | type=combobox | required=false | seen=15 | old=review canon=education.start_date
- `就读时间` | section=教育经历 | type=combobox | required=false | seen=15 | old=review canon=education.start_date
- `就读时间` | section=教育经历 | type=combobox | required=false | seen=15 | old=review canon=education.start_date
- `就读时间` | section=教育经历 | type=combobox | required=false | seen=15 | old=review canon=education.start_date
- `就读时间` | section=教育经历 | type=combobox | required=false | seen=0 | old=review canon=education.start_date
- `就读时间` | section=教育经历 | type=combobox | required=false | seen=0 | old=review canon=education.start_date
- `证书名称` | section=证书 | type=text | required=false | seen=15 | old=ready canon=certificate.name
- `证书颁发机构` | section=证书 | type=text | required=false | seen=15 | old=unmatched
- `是否至今` | section=项目经历 | type=checkbox | required=false | seen=15 | old=review canon=project.ongoing

### careers.eccom.com.cn（2）

- `用户名` | section=- | type=text | required=false | seen=6 | old=unmatched
- `简历类型` | section=- | type=select | required=false | seen=6 | old=unmatched

### chinastock.zhiye.com（47）

- `加入党派时间` | section=基本信息 | type=combobox | required=false | seen=33 | old=unmatched
- `户口类型` | section=基本信息 | type=combobox | required=false | seen=33 | old=unmatched
- `招聘信息知悉途径` | section=基本信息 | type=combobox | required=false | seen=33 | old=unmatched
- `是否拥有境外居留权` | section=基本信息 | type=custom_radio | required=false | seen=33 | old=unmatched
- `是否曾在银河证券实习` | section=基本信息 | type=custom_radio | required=false | seen=33 | old=unmatched
- `奖励名称` | section=实习经历 | type=text | required=false | seen=17 | old=unmatched
- `奖励类型` | section=实习经历 | type=combobox | required=false | seen=17 | old=unmatched
- `是否受到奖励` | section=实习经历 | type=combobox | required=false | seen=16 | old=unmatched
- `是否受到奖励` | section=实习经历 | type=combobox | required=false | seen=17 | old=unmatched
- `是否有代表性的在校经历` | section=实习经历 | type=combobox | required=false | seen=16 | old=unmatched
- `是否有代表性的在校经历` | section=实习经历 | type=combobox | required=false | seen=17 | old=unmatched
- `点击此处添加实习经历` | section=实习经历 | type=combobox | required=false | seen=16 | old=unmatched
- `点击此处添加实习经历` | section=实习经历 | type=combobox | required=false | seen=17 | old=unmatched
- `点击此处添加正式工作经历` | section=实习经历 | type=combobox | required=false | seen=16 | old=unmatched
- `点击此处添加正式工作经历` | section=实习经历 | type=combobox | required=false | seen=17 | old=unmatched
- `是否为颁发学历/学位证书的教育经历` | section=教育经历 | type=custom_radio | required=false | seen=33 | old=unmatched
- `是否有学术成果` | section=论文发表 | type=combobox | required=false | seen=20 | old=unmatched
- `是否有学术成果` | section=论文发表 | type=combobox | required=false | seen=20 | old=unmatched
- `是否有学术成果` | section=论文发表 | type=combobox | required=false | seen=13 | old=unmatched
- `是否有学术成果` | section=论文发表 | type=combobox | required=false | seen=13 | old=unmatched
- `职务` | section=论文发表 | type=text | required=false | seen=20 | old=unmatched
- `职务` | section=论文发表 | type=text | required=false | seen=13 | old=unmatched
- `评价内容(100字以内)` | section=论文发表 | type=long_text | required=false | seen=20 | old=unmatched
- `评价内容(100字以内)` | section=论文发表 | type=long_text | required=false | seen=13 | old=unmatched
- `专业名称(中文)` | section=证书 | type=text | required=false | seen=5 | old=unmatched
- `专业名称(中文)` | section=证书 | type=text | required=false | seen=28 | old=unmatched
- `专业课程` | section=证书 | type=long_text | required=false | seen=5 | old=unmatched
- `专业课程` | section=证书 | type=long_text | required=false | seen=5 | old=unmatched
- `专业课程` | section=证书 | type=long_text | required=false | seen=28 | old=unmatched
- `专业课程` | section=证书 | type=long_text | required=false | seen=28 | old=unmatched
- `其他证书` | section=证书 | type=text | required=false | seen=5 | old=ready canon=certificate.name
- `其他证书` | section=证书 | type=text | required=false | seen=28 | old=ready canon=certificate.name
- `学习形式` | section=证书 | type=combobox | required=false | seen=5 | old=unmatched
- `学习形式` | section=证书 | type=combobox | required=false | seen=5 | old=unmatched
- `学习形式` | section=证书 | type=combobox | required=false | seen=28 | old=unmatched
- `学习形式` | section=证书 | type=combobox | required=false | seen=28 | old=unmatched
- `成绩` | section=证书 | type=text | required=false | seen=5 | old=unmatched
- `成绩` | section=证书 | type=text | required=false | seen=5 | old=unmatched
- `成绩` | section=证书 | type=text | required=false | seen=28 | old=unmatched
- `成绩` | section=证书 | type=text | required=false | seen=28 | old=unmatched
- `接受外派地点` | section=证书 | type=combobox | required=false | seen=28 | old=unmatched
- `是否为颁发学历/学位证书的教育经历` | section=证书 | type=custom_radio | required=false | seen=5 | old=unmatched
- `是否为颁发学历/学位证书的教育经历` | section=证书 | type=custom_radio | required=false | seen=28 | old=unmatched
- `证书获取情况` | section=证书 | type=combobox | required=false | seen=5 | old=unmatched
- `证书获取情况` | section=证书 | type=combobox | required=false | seen=28 | old=unmatched
- `院系(中文)` | section=证书 | type=text | required=false | seen=5 | old=unmatched
- `院系(中文)` | section=证书 | type=text | required=false | seen=28 | old=unmatched

### scbank.hotjob.cn（27）

- `您获取我行校园招聘信息的途径为` | section=基本信息 | type=combobox | required=true | seen=33 | old=unmatched
- `户口所属派出所` | section=基本信息 | type=text | required=true | seen=33 | old=unmatched
- `户口类别` | section=基本信息 | type=radio | required=true | seen=33 | old=unmatched
- `第一学历` | section=基本信息 | type=combobox | required=true | seen=33 | old=review canon=basic.highest_degree
- `第一学历专业` | section=基本信息 | type=text | required=true | seen=33 | old=review canon=basic.highest_major
- `是否为我集团员工` | section=家庭信息 | type=radio | required=true | seen=33 | old=unmatched
- `奖励情况 (含学术成果,如无相关情况,请选无)` | section=论文发表 | type=radio | required=false | seen=28 | old=unmatched
- `奖励情况 (含学术成果,如无相关情况,请选无)` | section=论文发表 | type=radio | required=false | seen=1 | old=unmatched
- `奖励情况 (含学术成果,如无相关情况,请选无)` | section=论文发表 | type=radio | required=false | seen=2 | old=unmatched
- `奖励情况 (含学术成果,如无相关情况,请选无)` | section=论文发表 | type=radio | required=false | seen=1 | old=unmatched
- `奖励情况 (含学术成果,如无相关情况,请选无)` | section=论文发表 | type=radio | required=false | seen=1 | old=unmatched
- `是否有经商办企或兼职*?` | section=论文发表 | type=radio | required=false | seen=28 | old=unmatched
- `是否有经商办企或兼职*?` | section=论文发表 | type=radio | required=false | seen=1 | old=unmatched
- `是否有经商办企或兼职*?` | section=论文发表 | type=radio | required=false | seen=2 | old=unmatched
- `是否有经商办企或兼职*?` | section=论文发表 | type=radio | required=false | seen=1 | old=unmatched
- `是否有经商办企或兼职*?` | section=论文发表 | type=radio | required=false | seen=1 | old=unmatched
- `有无从事有毒有害工种的经历` | section=论文发表 | type=radio | required=false | seen=28 | old=unmatched
- `有无从事有毒有害工种的经历` | section=论文发表 | type=radio | required=false | seen=1 | old=unmatched
- `有无从事有毒有害工种的经历` | section=论文发表 | type=radio | required=false | seen=2 | old=unmatched
- `有无从事有毒有害工种的经历` | section=论文发表 | type=radio | required=false | seen=1 | old=unmatched
- `有无从事有毒有害工种的经历` | section=论文发表 | type=radio | required=false | seen=1 | old=unmatched
- `评价内容` | section=论文发表 | type=long_text | required=false | seen=28 | old=unmatched
- `评价内容` | section=论文发表 | type=long_text | required=false | seen=1 | old=unmatched
- `评价内容` | section=论文发表 | type=long_text | required=false | seen=2 | old=unmatched
- `评价内容` | section=论文发表 | type=long_text | required=false | seen=1 | old=unmatched
- `评价内容` | section=论文发表 | type=long_text | required=false | seen=1 | old=unmatched
- `请输入专业名称` | section=论文发表 | type=text | required=false | seen=1 | old=unmatched

### starnet.zhiye.com（10）

- `是否保研` | section=基本信息 | type=custom_radio | required=false | seen=31 | old=unmatched
- `是否已经上传个人简历` | section=基本信息 | type=custom_radio | required=false | seen=31 | old=unmatched
- `是否挂科` | section=基本信息 | type=custom_radio | required=false | seen=31 | old=unmatched
- `是否考研` | section=基本信息 | type=custom_radio | required=false | seen=31 | old=unmatched
- `父母常居城市` | section=基本信息 | type=combobox | required=false | seen=31 | old=unmatched
- `留学意向` | section=基本信息 | type=custom_radio | required=false | seen=31 | old=unmatched
- `考公意向` | section=基本信息 | type=custom_radio | required=false | seen=31 | old=unmatched
- `竞赛内容` | section=实习经历 | type=long_text | required=false | seen=31 | old=unmatched
- `所属校区` | section=教育经历 | type=text | required=false | seen=31 | old=unmatched
- `所属校区` | section=教育经历 | type=text | required=false | seen=31 | old=unmatched

### webhr.shccig.com（4）

- `共 3 页` | section=- | type=combobox | required=false | seen=4 | old=unmatched
- `共 49 页` | section=- | type=combobox | required=false | seen=5 | old=unmatched
- `请选择企业` | section=- | type=combobox | required=false | seen=5 | old=unmatched
- `请选择企业` | section=- | type=combobox | required=false | seen=4 | old=unmatched

### wecruit.hotjob.cn（51）

- `QQ` | section=基本信息 | type=text | required=false | seen=42 | old=unmatched
- `专业` | section=基本信息 | type=text | required=true | seen=3 | old=ready
- `专业` | section=基本信息 | type=text | required=true | seen=2 | old=ready
- `专业` | section=基本信息 | type=text | required=false | seen=123 | old=ready
- `专业` | section=基本信息 | type=text | required=false | seen=42 | old=ready
- `户口性质` | section=基本信息 | type=radio | required=false | seen=42 | old=unmatched
- `第一学历` | section=基本信息 | type=combobox | required=false | seen=56 | old=review canon=basic.highest_degree
- `第一学历专业` | section=基本信息 | type=combobox | required=false | seen=56 | old=review canon=basic.highest_major
- `家庭成员姓名` | section=家庭信息 | type=text | required=true | seen=5 | old=ready
- `请选择开始时间` | section=教育经历 | type=text | required=false | seen=2 | old=review
- `请选择结束时间` | section=教育经历 | type=text | required=false | seen=2 | old=review
- `请选择获得时间` | section=教育经历 | type=text | required=false | seen=1 | old=unmatched
- `具体分数` | section=求职意向 | type=text | required=false | seen=30 | old=unmatched
- `具体分数` | section=求职意向 | type=text | required=false | seen=3 | old=unmatched
- `评价内容` | section=求职意向 | type=long_text | required=false | seen=42 | old=unmatched
- `语种&等级` | section=求职意向 | type=combobox | required=false | seen=23 | old=unmatched
- `语种&等级` | section=求职意向 | type=combobox | required=false | seen=23 | old=unmatched
- `语种&等级` | section=求职意向 | type=combobox | required=false | seen=30 | old=unmatched
- `语种&等级` | section=求职意向 | type=combobox | required=false | seen=30 | old=unmatched
- `语种&等级` | section=求职意向 | type=combobox | required=false | seen=3 | old=unmatched
- `语种&等级` | section=求职意向 | type=combobox | required=false | seen=3 | old=unmatched
- `母亲姓名` | section=证书 | type=text | required=false | seen=1 | old=unmatched
- `母亲姓名` | section=证书 | type=text | required=false | seen=122 | old=unmatched
- `父亲姓名` | section=证书 | type=text | required=false | seen=1 | old=unmatched
- `父亲姓名` | section=证书 | type=text | required=false | seen=122 | old=unmatched
- `获得时间` | section=证书 | type=combobox | required=false | seen=122 | old=incompatible
- `获得时间` | section=证书 | type=date | required=false | seen=5 | old=ready
- `证书名称` | section=证书 | type=text | required=false | seen=5 | old=ready
- `证书名称` | section=证书 | type=text | required=false | seen=122 | old=ready
- `说明` | section=证书 | type=text | required=false | seen=5 | old=ready
- `说明` | section=证书 | type=text | required=false | seen=122 | old=ready
- `从何种渠道了解中国五矿的招聘信息` | section=语言能力 | type=text | required=false | seen=118 | old=unmatched
- `从何种渠道了解中国五矿的招聘信息` | section=语言能力 | type=text | required=false | seen=1 | old=unmatched
- `从何种渠道了解中国五矿的招聘信息` | section=语言能力 | type=text | required=false | seen=1 | old=unmatched
- `从何种渠道了解中国五矿的招聘信息` | section=语言能力 | type=text | required=false | seen=2 | old=unmatched
- `从何种渠道了解中国五矿的招聘信息` | section=语言能力 | type=text | required=false | seen=1 | old=unmatched
- `请输入专业名称` | section=语言能力 | type=text | required=false | seen=1 | old=unmatched
- `请选择开始时间` | section=语言能力 | type=text | required=false | seen=2 | old=unmatched
- `请选择结束时间` | section=语言能力 | type=text | required=false | seen=1 | old=unmatched
- `选择中国五矿的理由` | section=语言能力 | type=long_text | required=false | seen=118 | old=unmatched
- `选择中国五矿的理由` | section=语言能力 | type=long_text | required=false | seen=1 | old=unmatched
- `选择中国五矿的理由` | section=语言能力 | type=long_text | required=false | seen=1 | old=unmatched
- `选择中国五矿的理由` | section=语言能力 | type=long_text | required=false | seen=2 | old=unmatched
- `选择中国五矿的理由` | section=语言能力 | type=long_text | required=false | seen=1 | old=unmatched
- `其他AI工具/技术栈` | section=项目经历 | type=text | required=false | seen=30 | old=unmatched
- `是否有AI相关作品/项目经验` | section=项目经历 | type=radio | required=false | seen=26 | old=unmatched
- `是否有AI相关作品/项目经验` | section=项目经历 | type=radio | required=false | seen=30 | old=unmatched
- `涉及的AI工具/技术栈` | section=项目经历 | type=custom_checkbox | required=false | seen=30 | old=unmatched
- `该作品解决的核心问题与成果价值` | section=项目经历 | type=long_text | required=false | seen=30 | old=review canon=project.description
- `请用一句话介绍您的作品*?` | section=项目经历 | type=long_text | required=false | seen=30 | old=review canon=project.description
- `请选择您的作品核心分类` | section=项目经历 | type=radio | required=false | seen=30 | old=unmatched

### xjnsyh2026.zhaopin.com（17）

- `出生地` | section=- | type=combobox | required=false | seen=1 | old=unmatched
- `0 / 1000` | section=实习经历 | type=long_text | required=false | seen=1 | old=unmatched
- `4 / 100` | section=实习经历 | type=text | required=false | seen=1 | old=unmatched
- `6 / 50` | section=实习经历 | type=text | required=false | seen=1 | old=unmatched
- `至今` | section=实习经历 | type=combobox | required=false | seen=1 | old=missing canon=experience.ongoing
- `其他需要说明的情况` | section=家庭信息 | type=long_text | required=false | seen=1 | old=unmatched
- `2023年` | section=获奖经历 | type=combobox | required=false | seen=1 | old=unmatched
- `2024年` | section=获奖经历 | type=combobox | required=false | seen=1 | old=unmatched
- `2025年` | section=获奖经历 | type=combobox | required=false | seen=1 | old=unmatched
- `奖惩情况` | section=获奖经历 | type=long_text | required=false | seen=1 | old=unmatched
- `其他证书` | section=证书 | type=text | required=false | seen=1 | old=unmatched canon=certificate.name
- `参加工作时间` | section=证书 | type=combobox | required=false | seen=1 | old=unmatched
- `是否存在竞业限制情况` | section=证书 | type=combobox | required=false | seen=1 | old=unmatched
- `是否存在脱密情况` | section=证书 | type=combobox | required=false | seen=1 | old=unmatched
- `现工作用工形式` | section=证书 | type=combobox | required=false | seen=1 | old=unmatched
- `职业资格` | section=证书 | type=combobox | required=false | seen=1 | old=unmatched
- `职业资格` | section=证书 | type=combobox | required=false | seen=1 | old=unmatched

### xyz.51job.com（16）

- `爱好特长(含学生会职务)` | section=基本信息 | type=long_text | required=false | seen=16 | old=unmatched
- `爱好特长(含学生会职务)` | section=基本信息 | type=long_text | required=false | seen=25 | old=unmatched
- `是否有专科教育经历` | section=教育经历 | type=select | required=false | seen=10 | old=unmatched
- `是否有专科教育经历` | section=教育经历 | type=select | required=false | seen=23 | old=unmatched
- `在校期间是否为学生干部` | section=证书 | type=select | required=false | seen=46 | old=unmatched
- `奖学金名称和等级` | section=证书 | type=long_text | required=false | seen=46 | old=unmatched
- `开始日期` | section=证书 | type=text | required=false | seen=5 | old=unmatched
- `技能` | section=证书 | type=select | required=false | seen=23 | old=unmatched
- `招聘信息来源渠道` | section=证书 | type=select | required=false | seen=34 | old=unmatched
- `时间` | section=证书 | type=select | required=false | seen=4 | old=review canon=certificate.date
- `是否有亲属在我行工作` | section=证书 | type=select | required=false | seen=34 | old=unmatched
- `是否获得优秀学生干部` | section=证书 | type=select | required=false | seen=46 | old=unmatched
- `校内活动` | section=证书 | type=long_text | required=false | seen=46 | old=unmatched
- `相关荣誉` | section=证书 | type=long_text | required=false | seen=46 | old=unmatched
- `竞赛描述` | section=证书 | type=long_text | required=false | seen=4 | old=unmatched
- `结束日期` | section=证书 | type=text | required=false | seen=5 | old=unmatched

### zhaopin.china-cdt.com（1）

- `地点` | section=- | type=combobox | required=false | seen=43 | old=unmatched

### zhaopin.sgcc.com.cn（38）

- `换一个` | section=- | type=text | required=false | seen=1 | old=unmatched
- `一月 二月 三月 四月 五月 六月 七月 八月 九月 十月` | section=其他信息 | type=select | required=false | seen=2 | old=unmatched
- `下月>` | section=其他信息 | type=select | required=false | seen=17 | old=unmatched
- `下月>` | section=其他信息 | type=select | required=false | seen=2 | old=unmatched
- `专业名称` | section=其他信息 | type=text | required=false | seen=3 | old=unmatched
- `QQ号` | section=基本信息 | type=text | required=false | seen=102 | old=unmatched
- `座机` | section=基本信息 | type=text | required=false | seen=102 | old=unmatched
- `是` | section=基本信息 | type=radio | required=false | seen=6 | old=unmatched
- `是` | section=基本信息 | type=radio | required=false | seen=6 | old=unmatched
- `是` | section=基本信息 | type=radio | required=false | seen=102 | old=unmatched
- `是` | section=基本信息 | type=radio | required=false | seen=102 | old=unmatched
- `年度及期次` | section=论文发表 | type=text | required=true | seen=9 | old=unmatched
- `专业名称` | section=证书 | type=text | required=true | seen=41 | old=unmatched
- `专业名称` | section=证书 | type=text | required=true | seen=3 | old=unmatched
- `专业排名` | section=证书 | type=text | required=false | seen=41 | old=unmatched
- `专业排名` | section=证书 | type=text | required=false | seen=41 | old=unmatched
- `专业排名` | section=证书 | type=text | required=false | seen=3 | old=unmatched
- `专业排名` | section=证书 | type=text | required=false | seen=3 | old=unmatched
- `其他备注` | section=证书 | type=long_text | required=false | seen=11 | old=review canon=certificate.description
- `其他备注` | section=证书 | type=long_text | required=false | seen=1 | old=ready canon=certificate.description
- `其他备注` | section=证书 | type=long_text | required=false | seen=6 | old=ready canon=certificate.description
- `学位证书号` | section=证书 | type=text | required=false | seen=41 | old=unmatched
- `学位证书号` | section=证书 | type=text | required=false | seen=3 | old=unmatched
- `学历证书号` | section=证书 | type=text | required=false | seen=41 | old=unmatched
- `学历证书号` | section=证书 | type=text | required=false | seen=3 | old=unmatched
- `成绩` | section=证书 | type=text | required=true | seen=11 | old=unmatched
- `成绩` | section=证书 | type=text | required=false | seen=1 | old=unmatched
- `级别` | section=证书 | type=text | required=false | seen=1 | old=unmatched
- `绩点` | section=证书 | type=text | required=false | seen=41 | old=unmatched
- `绩点` | section=证书 | type=text | required=false | seen=3 | old=unmatched
- `认证机构` | section=证书 | type=text | required=true | seen=11 | old=unmatched
- `证书名称` | section=证书 | type=text | required=false | seen=1 | old=ready
- `证书编号` | section=证书 | type=text | required=true | seen=11 | old=unmatched
- `证书编号` | section=证书 | type=text | required=false | seen=1 | old=unmatched
- `证书编号` | section=证书 | type=text | required=false | seen=6 | old=unmatched
- `证书获得时间` | section=证书 | type=combobox | required=true | seen=11 | old=review
- `证书获得时间` | section=证书 | type=combobox | required=true | seen=1 | old=incompatible
- `高考成绩` | section=证书 | type=text | required=false | seen=3 | old=unmatched

### zhonghuan.zhiye.com（1）

- `技能证书` | section=证书 | type=long_text | required=false | seen=15 | old=ready canon=certificate.name

## 冲突字段（ambiguous，共 2 条）

- recruitment.uco.com `开始时间` | section=- | type=text | 候选=education.startDate、experience.startDate、project.startDate | 同一名称命中多个资料字段
- recruitment.uco.com `结束时间` | section=- | type=text | 候选=education.endDate、experience.endDate、project.endDate | 同一名称命中多个资料字段

## 旧工具 ready 但新引擎未命中（回归，共 18 条）

- app.mokahr.com `证书名称` | section=证书 | type=text | 新状态=unmatched canon=certificate.name
- chinastock.zhiye.com `其他证书` | section=证书 | type=text | 新状态=unmatched canon=certificate.name
- chinastock.zhiye.com `其他证书` | section=证书 | type=text | 新状态=unmatched canon=certificate.name
- wecruit.hotjob.cn `专业` | section=基本信息 | type=text | 新状态=unmatched
- wecruit.hotjob.cn `专业` | section=基本信息 | type=text | 新状态=unmatched
- wecruit.hotjob.cn `专业` | section=基本信息 | type=text | 新状态=unmatched
- wecruit.hotjob.cn `专业` | section=基本信息 | type=text | 新状态=unmatched
- wecruit.hotjob.cn `是否与中国五矿系统内职工存在夫妻关系、直系血亲关系、三代以内旁系血亲以及近姻亲关系` | section=基本信息 | type=combobox | 新状态=unmatched
- wecruit.hotjob.cn `家庭成员姓名` | section=家庭信息 | type=text | 新状态=unmatched
- wecruit.hotjob.cn `获得时间` | section=证书 | type=date | 新状态=unmatched
- wecruit.hotjob.cn `证书名称` | section=证书 | type=text | 新状态=unmatched
- wecruit.hotjob.cn `证书名称` | section=证书 | type=text | 新状态=unmatched
- wecruit.hotjob.cn `说明` | section=证书 | type=text | 新状态=unmatched
- wecruit.hotjob.cn `说明` | section=证书 | type=text | 新状态=unmatched
- zhaopin.sgcc.com.cn `其他备注` | section=证书 | type=long_text | 新状态=unmatched canon=certificate.description
- zhaopin.sgcc.com.cn `其他备注` | section=证书 | type=long_text | 新状态=unmatched canon=certificate.description
- zhaopin.sgcc.com.cn `证书名称` | section=证书 | type=text | 新状态=unmatched
- zhonghuan.zhiye.com `技能证书` | section=证书 | type=long_text | 新状态=unmatched canon=certificate.name

## 安全禁止字段（blocked，共 2 条；这些必须保持禁止）

- app.mokahr.com `内推码` | section=基本信息 | 禁止自动填写：内推码/内推编号
- app.mokahr.com `推荐码` | section=申请信息 | 禁止自动填写：推荐码/推荐编码

