# Workers AI 参考

AI 复核（见 GLOSSARY「AI 复核」、ADR 0007）用到的 Cloudflare Workers AI 模型。整理自 2026-11-25 的模型目录（`GET /accounts/{account_id}/ai/models/search`）与实测。模型处于研究预览阶段，实现前重新核对价格与 schema。

## 调用方式

- Cloudflare 部署：Worker 的 `ai` 绑定，`env.AI.run("@cf/cloudflare/clef", body)`。
- Docker 部署：`POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/cloudflare/{model}`，请求头 `Authorization: Bearer <API 令牌>`（令牌需 Workers AI 权限）。响应外层 `{success, errors, result}`。账户 ID 与令牌来自环境变量 `WORKERS_AI_ACCOUNT_ID`、`WORKERS_AI_TOKEN`。
- 只能从服务端调用，令牌不下发到网页。
- 客户端在 `apps/server/src/ai.ts`。错误按 [Workers AI 错误码](https://developers.cloudflare.com/workers-ai/platform/errors/) 归类：3036 额度用完 → `quota`；3040 或 HTTP 429 → `busy`；3007、3008、408 或 30 秒超时 → `timeout`；其他（含 5035 需要付费版）→ `unavailable`。AI 路由用 `requireAi` 检查开关，用 `aiErrorResponse` 返回 502 `ai_unavailable`。

## 模型

| 模型 | 用途 | 上下文 | 价格（每百万输入 token） |
|---|---|---|---|
| `@cf/cloudflare/clef` | 章节判断 | 65,536 | 0.24 美元 |
| `@cf/cloudflare/clef-flash` | 不用（准确率较低） | 24,576 | 0.038 美元 |
| `@cf/cloudflare/clairic` | 元数据识别 | 65,536 | 0.10 美元 |
| `@cf/cloudflare/clairic-flash` | 不用（只靠文件名时会截短书名） | 65,536 | 0.10 美元 |

### clef 请求

```json
{
  "state": "下面是从一本中文网络小说 TXT 中抽出的若干行。…",
  "questions": {
    "L0": {
      "type": "choice",
      "instructions": "判断这一行属于哪一类。上一行：…；本行：「…」；下一个非空行：…",
      "criteria": {
        "chapter": "章节标题：一章正文的标题",
        "volume": "卷名或篇名：其后紧跟若干章，用来分组",
        "notice": "作者公告的标题，例如请假、感言、悬赏、更新说明，不属于故事正文",
        "body": "正文内容的一行，例如对话、叙述、系统提示、图片"
      }
    }
  }
}
```

- 每次最多 64 题（`questions` 的 `maxProperties`）。题型还有 noul、score，本项目不用。
- 回答在 `result.answers.<id>`：`choice` 为选中项，`confidence` 为置信度；`result.usage.input_tokens` 为计费 token。
- 全角空格在题目中写成 `␣`，空行写成 `(空行)`，每行截取前 50 字。
- 接口 `POST /api/admin/ai/lines`（`apps/server/src/ai-lines.ts`）：请求 `{questions: [{id, prev, line, next, gap}]}`，最多 64 题；返回 `{results: {id: {kind, confidence}}}`。候选行由 core 的 `findCandidateLines` 在整理 Worker 中找出，前端逻辑在 `apps/web/src/lib/ai-review.ts` 与 `use-ai-review.ts`。

### clairic 请求

```json
{
  "state": "文件名：…\n文件开头：\n…",
  "fields": {
    "title": { "type": "text", "instructions": "小说的书名。不含书名号、括号里的附注（如完结、番外说明）和作者。没有就返回 null。" },
    "author": { "type": "text", "instructions": "小说作者的笔名。不含「作者：」前缀。没有就返回 null。" },
    "intro": { "type": "text", "instructions": "作者写的作品简介原文，不含「简介：」标签、网站广告和正文。没有就返回 null。" }
  }
}
```

- 回答在 `result.answers.<字段>.value`，另有 `confidence`、`p_null`。每次调用约 4 秒。
- 接口 `POST /api/admin/ai/metadata`（`apps/server/src/ai-metadata.ts`）：请求 `{fileName, head}`，`head` 由 core 的 `manuscriptHead` 取原稿开头 3,000 字。返回 `{suggestion: {title, author, intro}}`，空值、超长值为 null，简介去掉每行缩进。

## 实测（2026-11-25）

- 章节判断，实教原稿 106 个候选行（章节、卷名、作者公告、正文四类）：clef 加上下文准确率 97.2%；置信度 ≥0.8 的行全部正确，判错的行置信度都低于 0.25。clef-flash 只给编号时 79.2%，题目写出本行时 93.4%。
- 元数据识别，5 个样本（含 GBK 原稿、带广告的开头、无元数据的正文片段）：clairic 全部正确，会去掉广告，没有信息时返回 null。
- 全部实测花费约 0.02 美元。

## 额度

- 免费版与付费版每天都有 10,000 Neurons 免费额度，每天 00:00 UTC 清零。免费版用完后调用报错；付费版超出部分按量计费。
- 估算：clairic 识别 1 次约占每日免费额度 0.5%；clef 判断 1,000 行约占 45%。所以复核只发送候选行，单次上限 640 行。
- 尚未在免费账户上实测这些模型。
