# AI 面试教练

覆盖 6 大行业、113 个岗位的中文 AI 模拟面试平台。免费、隐私本地、无需注册即可开练。

## 功能

- **实时模拟面试**：选岗位 + 公司档位，AI 面试官与你对话、在你回答后追问
- **标准面试结构**：5 道岗位题 + 1 道动机题，动机题按卷号变化、不重题
- **评分报告**：AI 语义评分 + 规则兜底，逐题给出得分、关键词命中与改进建议
- **配套模块**：题库浏览 / 分档攻略（大厂·创业·外企·体制内）/ 历史记录 / 自创面试官 / 参与共建
- **隐私优先**：作答内容仅存浏览器本地（localStorage），不上云；仅收集匿名使用统计

## 技术栈

纯静态前端（HTML / CSS / 原生 JS），无构建步骤。

```
index.html              首页（选岗、价值说明、SEO）
interview.html          模拟面试间
report.html             评分报告
question-bank.html      题库 / 知识点
tiers.html              分档攻略
history.html            我的历史
custom.html             自创面试官
contribute.html         参与共建（纠错 / 投稿）
data/                   题库与评分配置（JSON）
assets/js/              前端逻辑（面试 / 评分 / 报告 / 云端 / 埋点）
assets/css/             样式
robots.txt / sitemap.xml  搜索引擎收录
```

AI 语义评分、云端纠错 / 共建、使用统计依赖一个后端服务（本仓库对接 WorkBuddy 云）。
自部署时，替换 `assets/js/cloud.js` 中的后端配置即可接入你自己的服务。

## 本地运行

直接用浏览器打开 `index.html` 即可体验界面与本地规则评分；
AI 语义评分与云端功能需后端支持（接入上述云服务或自建后端）。

## 线上演示

https://ai-interview-58714.app.workbuddy.host/?sharecode=3O2ZVIAQ57

## 隐私说明

- 作答内容仅保存在你自己的浏览器本地，不上传任何服务器
- 仅记录匿名使用事件（页面访问、开始 / 完成面试等事件名与元信息），不含任何作答文本

## License

[MIT](./LICENSE)
