# 匹配覆盖率对比：baseline → after

- 生成时间：2026-11-09T10:03:12.405Z
- 类型：offline-matching-diagnostic（**离线映射诊断：字段证据来自旧工具目录的 label/section/type 元数据（无 name/id/placeholder），候选资料为固定占位 UserProfile；不是真实页 DOM 提取，不是已部署扩展的端到端验收。**）
- 字段目录：`D:\PythonDemo_learn\tools\简历投递信息填写\diagnostics\coverage\field-catalog.json`（941 条）

## 总览

| 指标 | 改前 | 改后 | 变化 |
| --- | --- | --- | --- |
| matched | 541 | 668 | +127 |
| 覆盖率 | 57.5% | 71.0% | +13.5pp |
| blocked | 2 | 2 | 0 |
| ambiguous | 106 | 2 | -104 |
| unmatched | 292 | 269 | -23 |
| 旧ready未命中 | 48 | 18 | -30 |

## 按站点

| 站点 | 字段数 | 改前 matched | 改前覆盖 | 改后 matched | 改后覆盖 | 变化(pp) |
| --- | --- | --- | --- | --- | --- | --- |
| app.mokahr.com | 69 | 43 | 62.3% | 54 | 78.3% | +15.9 |
| careers.eccom.com.cn | 6 | 4 | 66.7% | 4 | 66.7% | +0.0 |
| chinastock.zhiye.com | 112 | 58 | 51.8% | 65 | 58.0% | +6.3 |
| recruitment.uco.com | 10 | 10 | 100.0% | 8 | 80.0% | -20.0 |
| scbank.hotjob.cn | 115 | 60 | 52.2% | 67 | 58.3% | +6.1 |
| starnet.zhiye.com | 41 | 27 | 65.9% | 31 | 75.6% | +9.8 |
| webhr.shccig.com | 10 | 4 | 40.0% | 6 | 60.0% | +20.0 |
| wecruit.hotjob.cn | 302 | 176 | 58.3% | 248 | 82.1% | +23.8 |
| xjnsyh2026.zhaopin.com | 55 | 28 | 50.9% | 38 | 69.1% | +18.2 |
| xyz.51job.com | 106 | 59 | 55.7% | 73 | 68.9% | +13.2 |
| zhaopin.china-cdt.com | 4 | 1 | 25.0% | 3 | 75.0% | +50.0 |
| zhaopin.sgcc.com.cn | 82 | 49 | 59.8% | 43 | 52.4% | -7.3 |
| zhonghuan.zhiye.com | 29 | 22 | 75.9% | 28 | 96.6% | +20.7 |

## 新命中字段（164 条）

- app.mokahr.com `起止时间` | section=实习经历 | type=month | → key=education.exchangePeriod | old=unmatched
- app.mokahr.com `起止时间` | section=实习经历 | type=month | → key=education.exchangePeriod | old=unmatched
- app.mokahr.com `起止时间` | section=项目经历 | type=combobox | → key=education.exchangePeriod | old=review
- app.mokahr.com `起止时间` | section=项目经历 | type=combobox | → key=education.exchangePeriod | old=review
- app.mokahr.com `起止时间` | section=项目经历 | type=combobox | → key=education.exchangePeriod | old=review
- app.mokahr.com `起止时间` | section=项目经历 | type=combobox | → key=education.exchangePeriod | old=review
- app.mokahr.com `起止时间` | section=项目经历 | type=combobox | → key=education.exchangePeriod | old=review
- app.mokahr.com `入学性质` | section=教育经历 | type=combobox | → key=education.admissionType | old=incompatible
- app.mokahr.com `入学性质` | section=教育经历 | type=combobox | → key=education.admissionType | old=incompatible
- app.mokahr.com `项目中职责` | section=项目经历 | type=long_text | → key=project.personalDuty | old=review
- app.mokahr.com `项目中职责` | section=项目经历 | type=long_text | → key=project.personalDuty | old=review
- app.mokahr.com `意向工作城市` | section=申请信息 | type=combobox | → key=module.jobIntent.cities | old=unmatched
- app.mokahr.com `语言类型` | section=语言能力 | type=text | → key=module.languages.language | old=ready
- chinastock.zhiye.com `成绩排名` | section=证书 | type=text | → key=education.ranking | old=unmatched
- chinastock.zhiye.com `成绩排名` | section=证书 | type=text | → key=education.ranking | old=unmatched
- chinastock.zhiye.com `成绩排名` | section=证书 | type=text | → key=education.ranking | old=unmatched
- chinastock.zhiye.com `成绩排名` | section=证书 | type=text | → key=education.ranking | old=unmatched
- chinastock.zhiye.com `发布时间` | section=论文发表 | type=combobox | → key=module.papers.publishedAt | old=missing
- chinastock.zhiye.com `紧急联系人手机号` | section=基本信息 | type=text | → key=personal.emergencyPhone | old=ready
- chinastock.zhiye.com `其他外语` | section=语言能力 | type=combobox | → key=module.languages.language | old=incompatible
- chinastock.zhiye.com `其他外语水平` | section=语言能力 | type=combobox | → key=module.languages.level | old=missing
- chinastock.zhiye.com `生源地` | section=基本信息 | type=combobox | → key=personal.studentOrigin | old=incompatible
- chinastock.zhiye.com `是否接受外派` | section=证书 | type=combobox | → key=module.jobIntent.overseas | old=unmatched
- chinastock.zhiye.com `是否接受外派` | section=证书 | type=combobox | → key=module.jobIntent.overseas | old=unmatched
- chinastock.zhiye.com `所属期刊` | section=论文发表 | type=text | → key=module.papers.venue | old=ready
- chinastock.zhiye.com `通讯地址/现居住地` | section=基本信息 | type=text | → key=personal.mailingAddress | old=ready
- chinastock.zhiye.com `学术成果名称` | section=论文发表 | type=text | → key=module.papers.title | old=ready
- chinastock.zhiye.com `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=incompatible
- chinastock.zhiye.com `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=review
- chinastock.zhiye.com `英语成绩` | section=语言能力 | type=text | → key=module.languages.score | old=missing
- chinastock.zhiye.com `英语水平` | section=语言能力 | type=combobox | → key=personal.englishLevel | old=incompatible
- chinastock.zhiye.com `最高学历院校类型` | section=基本信息 | type=combobox | → key=personal.highestEducation | old=unmatched
- scbank.hotjob.cn `(按时间顺序,从高中填起,毕业学校应填写完整学校名称;如毕业学校存在更名情况,应填写学历学位证上的学校名称;如毕业学校为独立学院,应完整填写独立学院名称;仅获得单证的,需备注说明相关情况;学历学位证书由不同学校颁发或存在转学等情况的,需分别填写完整或予以说明;属于专升本的,应分别填写完整或予以说明;学习起止时间、专业名称、学习形式等相关信息应与学历学位证上保持一致。如有延迟毕业请注明具体原因。所有涉及填写时间的,均须具体到月,填写格式为XXXX年XX月。)` | section=教育经历 | type=custom_radio | → key=education.educationType | old=unmatched
- scbank.hotjob.cn `(按时间顺序,从高中填起,毕业学校应填写完整学校名称;如毕业学校存在更名情况,应填写学历学位证上的学校名称;如毕业学校为独立学院,应完整填写独立学院名称;仅获得单证的,需备注说明相关情况;学历学位证书由不同学校颁发或存在转学等情况的,需分别填写完整或予以说明;属于专升本的,应分别填写完整或予以说明;学习起止时间、专业名称、学习形式等相关信息应与学历学位证上保持一致。如有延迟毕业请注明具体原因。所有涉及填写时间的,均须具体到月,填写格式为XXXX年XX月。)` | section=教育经历 | type=custom_radio | → key=education.educationType | old=unmatched
- scbank.hotjob.cn `成绩排名` | section=基本信息 | type=text | → key=education.ranking | old=unmatched
- scbank.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=incompatible
- scbank.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=incompatible
- scbank.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=incompatible
- scbank.hotjob.cn `英语水平` | section=基本信息 | type=text | → key=personal.englishLevel | old=unmatched
- scbank.hotjob.cn `专业` | section=教育经历 | type=combobox | → key=education.major | old=incompatible
- starnet.zhiye.com `毕业时间` | section=教育经历 | type=combobox | → key=education.endDate | old=incompatible
- starnet.zhiye.com `毕业时间` | section=教育经历 | type=combobox | → key=education.endDate | old=incompatible
- starnet.zhiye.com `期望月薪(税前)` | section=求职意向 | type=combobox | → key=module.jobIntent.salaryExpected | old=missing
- starnet.zhiye.com `英语等级` | section=基本信息 | type=combobox | → key=personal.englishLevel | old=unmatched
- webhr.shccig.com `请输入职位名称/专业名称` | section=- | type=combobox | → key=experience.position | old=unmatched
- webhr.shccig.com `请输入职位名称/专业名称` | section=- | type=combobox | → key=experience.position | old=unmatched
- wecruit.hotjob.cn `毕业时间?` | section=基本信息 | type=date | → key=education.endDate | old=incompatible
- wecruit.hotjob.cn `毕业时间?` | section=基本信息 | type=date | → key=education.endDate | old=incompatible
- wecruit.hotjob.cn `毕业时间*?` | section=基本信息 | type=combobox | → key=education.endDate | old=incompatible
- wecruit.hotjob.cn `毕业时间*?` | section=基本信息 | type=combobox | → key=education.endDate | old=incompatible
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=ready
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=ready
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=review
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=review
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=review
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=review
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=review
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=incompatible
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=review
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=review
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=review
- wecruit.hotjob.cn `城市` | section=教育经历 | type=combobox | → key=education.schoolCity | old=review
- wecruit.hotjob.cn `高考所在地` | section=基本信息 | type=combobox | → key=personal.gaokaoLocation | old=ready
- wecruit.hotjob.cn `高考所在地` | section=基本信息 | type=combobox | → key=personal.gaokaoLocation | old=ready
- wecruit.hotjob.cn `高考所在地` | section=基本信息 | type=combobox | → key=personal.gaokaoLocation | old=ready
- wecruit.hotjob.cn `高考所在地` | section=基本信息 | type=combobox | → key=personal.gaokaoLocation | old=ready
- wecruit.hotjob.cn `高考所在地(省/地区)` | section=基本信息 | type=combobox | → key=personal.gaokaoLocation | old=review
- wecruit.hotjob.cn `高考所在地(市/区)` | section=基本信息 | type=combobox | → key=personal.gaokaoLocation | old=review
- wecruit.hotjob.cn `技能名称&掌握程度` | section=求职意向 | type=combobox | → key=module.languages.level | old=unmatched
- wecruit.hotjob.cn `技能名称&掌握程度` | section=求职意向 | type=combobox | → key=module.languages.level | old=unmatched
- wecruit.hotjob.cn `技能名称&掌握程度` | section=求职意向 | type=combobox | → key=module.languages.level | old=unmatched
- wecruit.hotjob.cn `技能名称&掌握程度` | section=求职意向 | type=combobox | → key=module.languages.level | old=unmatched
- wecruit.hotjob.cn `技能名称&掌握程度` | section=求职意向 | type=combobox | → key=module.languages.level | old=unmatched
- wecruit.hotjob.cn `技能名称&掌握程度` | section=求职意向 | type=combobox | → key=module.languages.level | old=unmatched
- wecruit.hotjob.cn `技能名称&掌握程度` | section=求职意向 | type=combobox | → key=module.languages.level | old=unmatched
- wecruit.hotjob.cn `技能名称&掌握程度` | section=求职意向 | type=combobox | → key=module.languages.level | old=unmatched
- wecruit.hotjob.cn `目前所在地(省/地区)` | section=基本信息 | type=combobox | → key=personal.currentAddress | old=review
- wecruit.hotjob.cn `目前所在地(市/区)` | section=基本信息 | type=combobox | → key=personal.currentAddress | old=review
- wecruit.hotjob.cn `期望年薪` | section=求职意向 | type=combobox | → key=module.jobIntent.salaryExpected | old=missing
- wecruit.hotjob.cn `期望年薪` | section=求职意向 | type=combobox | → key=module.jobIntent.salaryExpected | old=missing
- wecruit.hotjob.cn `期望年薪` | section=求职意向 | type=combobox | → key=module.jobIntent.salaryExpected | old=missing
- wecruit.hotjob.cn `期望薪酬` | section=求职意向 | type=combobox | → key=module.jobIntent.salaryExpected | old=missing
- wecruit.hotjob.cn `期望职位` | section=求职意向 | type=text | → key=module.jobIntent.positions | old=missing
- wecruit.hotjob.cn `是否海外留学生` | section=基本信息 | type=combobox | → key=personal.overseasExperience | old=incompatible
- wecruit.hotjob.cn `是否海外留学生` | section=基本信息 | type=combobox | → key=personal.overseasExperience | old=incompatible
- wecruit.hotjob.cn `是否海外留学生` | section=基本信息 | type=combobox | → key=personal.overseasExperience | old=ready
- wecruit.hotjob.cn `熟练程度` | section=语言能力 | type=combobox | → key=module.languages.level | old=incompatible
- wecruit.hotjob.cn `熟练程度` | section=语言能力 | type=combobox | → key=module.languages.level | old=ready
- wecruit.hotjob.cn `熟练程度` | section=语言能力 | type=combobox | → key=module.languages.level | old=incompatible
- wecruit.hotjob.cn `熟练程度` | section=语言能力 | type=combobox | → key=module.languages.level | old=ready
- wecruit.hotjob.cn `熟练程度` | section=语言能力 | type=combobox | → key=module.languages.level | old=ready
- wecruit.hotjob.cn `熟练程度` | section=语言能力 | type=combobox | → key=module.languages.level | old=ready
- wecruit.hotjob.cn `学位` | section=基本信息 | type=combobox | → key=personal.highestDegree | old=incompatible
- wecruit.hotjob.cn `学位` | section=基本信息 | type=combobox | → key=personal.highestDegree | old=incompatible
- wecruit.hotjob.cn `学位` | section=基本信息 | type=combobox | → key=personal.highestDegree | old=incompatible
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=incompatible
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=ready
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=missing
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=incompatible
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=review
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=review
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=incompatible
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=missing
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=review
- wecruit.hotjob.cn `学位` | section=教育经历 | type=combobox | → key=education.academicDegree | old=review
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=incompatible
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=ready
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=review
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=ready
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=review
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=ready
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=review
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=incompatible
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=review
- wecruit.hotjob.cn `学校` | section=教育经历 | type=combobox | → key=education.school | old=review
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=ready
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=ready
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=missing
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=ready
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=review
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=ready
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=review
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=missing
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=review
- wecruit.hotjob.cn `专业` | section=教育经历 | type=text | → key=education.major | old=review
- xjnsyh2026.zhaopin.com `毕业时间` | section=教育经历 | type=combobox | → key=education.endDate | old=review
- xjnsyh2026.zhaopin.com `毕业时间` | section=教育经历 | type=combobox | → key=education.endDate | old=review
- xjnsyh2026.zhaopin.com `家庭住址` | section=家庭信息 | type=text | → key=personal.mailingAddress | old=unmatched
- xjnsyh2026.zhaopin.com `满分绩点` | section=教育经历 | type=combobox | → key=education.gpaScale | old=unmatched
- xjnsyh2026.zhaopin.com `满分绩点` | section=教育经历 | type=combobox | → key=education.gpaScale | old=unmatched
- xjnsyh2026.zhaopin.com `外语水平` | section=证书 | type=text | → key=module.languages.level | old=unmatched
- xjnsyh2026.zhaopin.com `专业` | section=教育经历 | type=combobox | → key=education.major | old=review
- xjnsyh2026.zhaopin.com `专业` | section=教育经历 | type=combobox | → key=education.major | old=incompatible
- xjnsyh2026.zhaopin.com `专业` | section=教育经历 | type=combobox | → key=education.major | old=review
- xjnsyh2026.zhaopin.com `专业` | section=教育经历 | type=text | → key=education.major | old=review
- xyz.51job.com `本科是否为全日制` | section=教育经历 | type=select | → key=education.educationType | old=ready
- xyz.51job.com `本科受教类型` | section=教育经历 | type=select | → key=education.educationType | old=ready
- xyz.51job.com `本科学习成绩排名` | section=教育经历 | type=select | → key=education.ranking | old=ready
- xyz.51job.com `第 1志愿` | section=- | type=combobox | → key=module.jobIntent.positions | old=unmatched
- xyz.51job.com `公司` | section=- | type=text | → key=experience.company | old=missing
- xyz.51job.com `基层锻炼期望工作地1` | section=基本信息 | type=select | → key=module.jobIntent.cities | old=unmatched
- xyz.51job.com `基层锻炼期望工作地1` | section=基本信息 | type=select | → key=module.jobIntent.cities | old=unmatched
- xyz.51job.com `基层锻炼期望工作地2` | section=基本信息 | type=select | → key=module.jobIntent.cities | old=unmatched
- xyz.51job.com `基层锻炼期望工作地2` | section=基本信息 | type=select | → key=module.jobIntent.cities | old=unmatched
- xyz.51job.com `论文内容简述` | section=证书 | type=long_text | → key=module.papers.abstract | old=unmatched
- xyz.51job.com `硕士是否为全日制` | section=教育经历 | type=select | → key=education.educationType | old=review
- xyz.51job.com `硕士受教类型` | section=教育经历 | type=select | → key=education.educationType | old=ready
- xyz.51job.com `硕士学习成绩排名` | section=教育经历 | type=select | → key=education.ranking | old=ready
- xyz.51job.com `最高学历毕业论文题目` | section=证书 | type=text | → key=education.endDate | old=unmatched
- zhaopin.china-cdt.com `岗位` | section=- | type=combobox | → key=experience.position | old=unmatched
- zhaopin.china-cdt.com `专业` | section=- | type=combobox | → key=education.major | old=unmatched
- zhaopin.sgcc.com.cn `毕业时间` | section=证书 | type=combobox | → key=education.endDate | old=unmatched
- zhaopin.sgcc.com.cn `毕业时间` | section=证书 | type=combobox | → key=education.endDate | old=unmatched
- zhaopin.sgcc.com.cn `家庭住址` | section=家庭信息 | type=text | → key=personal.mailingAddress | old=unmatched
- zhaopin.sgcc.com.cn `论文索引号` | section=论文发表 | type=text | → key=module.papers.doi | old=unmatched
- zhaopin.sgcc.com.cn `期刊/收录 机构名` | section=论文发表 | type=text | → key=module.papers.venue | old=unmatched
- zhaopin.sgcc.com.cn `邮政编码` | section=基本信息 | type=text | → key=personal.postalCode | old=ready
- zhaopin.sgcc.com.cn `作者排序` | section=论文发表 | type=text | → key=module.papers.authorRank | old=ready
- zhonghuan.zhiye.com `其他外语能力` | section=语言能力 | type=text | → key=module.languages.level | old=unmatched
- zhonghuan.zhiye.com `意向工作城市` | section=基本信息 | type=combobox | → key=module.jobIntent.cities | old=unmatched
- zhonghuan.zhiye.com `英语等级` | section=基本信息 | type=combobox | → key=personal.englishLevel | old=unmatched
- zhonghuan.zhiye.com `英语等级成绩` | section=基本信息 | type=text | → key=module.languages.score | old=unmatched
- zhonghuan.zhiye.com `在校职务名称` | section=教育经历 | type=text | → key=module.campus.position | old=unmatched
- zhonghuan.zhiye.com `在校职务名称` | section=教育经历 | type=text | → key=module.campus.position | old=unmatched

## 回归（改前命中、改后未命中，37 条；应为 0）

- app.mokahr.com `关系` | section=其他 | 改后状态=unmatched | 没有唯一可靠规则
- app.mokahr.com `证书颁发机构` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `职务` | section=论文发表 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `职务` | section=论文发表 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `专业名称(中文)` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `专业名称(中文)` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `学习形式` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `学习形式` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `学习形式` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `学习形式` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `成绩` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `成绩` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `成绩` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- chinastock.zhiye.com `成绩` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- recruitment.uco.com `开始时间` | section=- | 改后状态=ambiguous | 同一名称命中多个资料字段
- recruitment.uco.com `结束时间` | section=- | 改后状态=ambiguous | 同一名称命中多个资料字段
- scbank.hotjob.cn `请输入专业名称` | section=论文发表 | 改后状态=unmatched | 没有唯一可靠规则
- wecruit.hotjob.cn `请选择开始时间` | section=教育经历 | 改后状态=unmatched | 没有唯一可靠规则
- wecruit.hotjob.cn `请选择结束时间` | section=教育经历 | 改后状态=unmatched | 没有唯一可靠规则
- wecruit.hotjob.cn `获得时间` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- wecruit.hotjob.cn `获得时间` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- wecruit.hotjob.cn `请输入专业名称` | section=语言能力 | 改后状态=unmatched | 没有唯一可靠规则
- wecruit.hotjob.cn `请选择开始时间` | section=语言能力 | 改后状态=unmatched | 没有唯一可靠规则
- wecruit.hotjob.cn `请选择结束时间` | section=语言能力 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `专业名称` | section=其他信息 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `专业名称` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `专业名称` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `专业排名` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `专业排名` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `专业排名` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `专业排名` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `成绩` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `成绩` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `绩点` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `绩点` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `证书获得时间` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则
- zhaopin.sgcc.com.cn `证书获得时间` | section=证书 | 改后状态=unmatched | 没有唯一可靠规则

## 新增冲突（2 条；应尽量为 0，冲突必须人工复核）

- recruitment.uco.com `开始时间` | candidates=education.startDate、experience.startDate、project.startDate | 同一名称命中多个资料字段
- recruitment.uco.com `结束时间` | candidates=education.endDate、experience.endDate、project.endDate | 同一名称命中多个资料字段

## 新增禁止（0 条；安全策略收紧，人工确认合理）


## 规则指纹变化

| 文件 | 改前 | 改后 |
| --- | --- | --- |
| `extension-src/src/shared/profileFieldRegistry.ts` | `28bca50cfc7bc42f` | `65f20f2f288ed80e` |
| `extension-src/src/shared/blockedFields.ts` | `db302effd1fa5222` | `db302effd1fa5222` |
| `extension-src/src/shared/profilePresets.ts` | `0503cabd66d26b91` | `c46fa6c125c3ce1c` |
| `extension-src/src/utils/fieldMatcher.ts` | `ea221fc4ad3bf7e6` | `57476e641ecf26fb` |
| `extension-src/src/utils/fieldText.ts` | `b5184e23f56c8b45` | `b5184e23f56c8b45` |
| `extension-src/src/shared/profileAnswerCandidates.ts` | `c4684b570ea3fa08` | `c4684b570ea3fa08` |

