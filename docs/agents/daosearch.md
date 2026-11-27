# DaoSearch API 参考

刮削（见 GLOSSARY「刮削」、ADR 0006）用到的 DaoSearch 接口。整理自 2026-11-25 的开发者文档 <https://daosearch.io/developers?lang=zh> 与 OpenAPI <https://daosearch.io/api/v1/openapi.json>（无需密钥即可下载）。实现前重新核对，以 OpenAPI 为准。

## 调用方式

- 基础地址 `https://daosearch.io/api/v1`，只读，仅 GET / HEAD。
- 请求头：`Authorization: Bearer <密钥>`；`User-Agent` 写明工具名，例如 `Novarium/<版本> (+https://github.com/evan-hakuya/Novarium)`。密钥不能放在 URL 中（返回 400）。
- 只能从服务端调用：浏览器跨域请求会被拒绝（403 `cors_not_allowed`）。所以刮削请求经由我们的 API 转发，密钥不下发到网页。
- 响应外层 `{"data": ...}`；错误 `{"error": {code, status, message, param?}}`，按 `code` 分支处理。
- 文本字段是 `{"en": ..., "zh": ...}`，取 `zh`。缺失为 null，不会是 0 或空字符串。

## 限额

- 每账号每分钟 60 次请求、每天 5000 点；注册后前 14 天每天 1000 点。同时进行中的请求最多 8 个。
- 消耗：单本作品 1 点；搜索 5 点；`/limits/me` 0 点。
- 超限返回 429（`rate_limited` / `quota_exceeded`）并带 `Retry-After`。每个成功响应带 `RateLimit-Remaining`。
- 200 响应带 `ETag`，用 `If-None-Match` 发回，未变化时返回免费的 304。

## 用到的接口

| 接口 | 用途 | 消耗 |
|---|---|---|
| `GET /limits/me` | 设置页「测试连接」，显示当天剩余点数 | 0 |
| `GET /search?q=<书名或链接>&limit=10` | 刮削对话框的候选列表。`q` 也接受 DaoSearch 或源站的书页链接。只返回书名、作者、封面 | 5 |
| `GET /books/{source}/{source_book_id}` | 点击候选后读取详情；再次刮削按已保存的 ID 读取。ID 合并时返回 301 | 1 |
| `GET /sources` | 快照里数据项的中文名（`metrics[].zh`）与评分满分（`score_scale`）。读取失败时改用作品响应里的英文名，不影响刮削 | 1 |

一次刮削约 6 点：搜索 5 点，查看一个候选的详情 1 点。写入前服务端按作品 ID 重新读取，命中缓存，不扣点。搜索后不批量读取候选详情。`/sources` 与其他响应一起缓存，6 小时内最多 1 点。

再次刮削（#43）：已刮削过的书直接按保存的 `scrapeRef` 读取作品（1 点），不搜索；对话框里有「重新搜索」可以换成另一部作品。ID 合并时 fetch 跟随 301，写入时 `scrapeRef` 更新为响应里的新 ID。作品不存在（404）时提示所有者，书的数据与快照不变。

缓存：搜索与作品响应按请求路径存在 `scrape_cache` 表。6 小时内（与 `x-cache-seconds` 一致）直接用缓存；过期后带 `If-None-Match` 重新验证，304 不扣点。请求出错时不写缓存。30 天没有使用的缓存由定时清理删除。浏览器内另有 30 分钟的查询缓存。

点数提示（#117）：刮削对话框在搜索前用 `GET /api/admin/scrape/search/status?q=` 查这次搜索的缓存状态，搜索结果的每个候选带 `cached`（详情的缓存状态，取作品与 `/sources` 两者中较差的）。两者只查 `scrape_cache` 表，不请求 DaoSearch。状态 `fresh`（未过期，不扣点）、`stale`（已过期，内容没变时 304 不扣点）、`none`（没有缓存或格式不对，扣点）。搜索词要完全一致（去掉首尾空白后）才算命中。

`source` 取值：qidian、fanqie、jjwxc、faloo、qimao、zongheng、seventeenk、sfacg、ciweimao。

## Book 字段与用法

| 字段 | 用法 |
|---|---|
| `title.zh` `author.zh` `synopsis_zh` `tags[].zh` `cover_url` | 写入书名、作者、简介、标签（合并）、封面（下载后存入自己的存储） |
| `genre.zh` `subgenre.zh` `status` `word_count` `released` `updated_at` `other_names` `title.en` `author.en` `facets` `mature` `source_url` `also_on` | 描述字段（#42），存在 `books` 表。别名取 `other_names[].name`（没有中文时取 `name_translated`）与 `title.en`，合并进现有别名。`facets` 保存 `key`、`label`、`value_label`（存为 `value`）与原值 `value`（存为 `raw`，#99 起）。API 只返回英文，后台按 `key` 与原值显示成中文胶囊，排在标签上方，与 DaoSearch 书页一致；对照表只收实测见过的值，未知的值显示源站文字。实测取值见下方「平台标记」。`source_url` 与 `also_on[].url` 只接受 https。分类、子分类、连载状态与别名可由所有者编辑。书源的 `kind` 为「分类,子分类,标签」，`wordCount` 取 `word_count`，搜索也匹配别名 |
| `source` `source_book_id` `url` | 刮削来源 ID 与署名链接 |
| `metrics` `rankings` `source_rating_count` `source_comment_count` `booklist_count` `pace` `availability` `refreshed_at` | 快照（#43），存在 `books.snapshot`，每次刮削整体替换，不需要勾选。`metrics` 保留 `key`、`value`、`period`，名称取 `/sources` 的中文名；`rankings` 取 `board_zh`、`channel_zh`（没有时取英文名）与 `position`、`url`。保存但后台不显示（#119） |
| `latest_chapter(_en)` `chapter_count` `synopsis_en` `english_translation` `licences` `translated_by` `*_url` | 不用 |

### 平台标记

DaoSearch 中文书页的标签区先显示平台标记，再显示普通标签。是或否的标记只显示名称（签约），读者与阅读方式只显示值（男频、VIP付费），其余显示名称和值（作家等级 白金）。2026-11-27 实测的取值：

| 平台 | key=原值（value_label） | 中文 |
|---|---|---|
| 起点 | audience=male (Male)、signed=true、author_tier=Platinum | 男频、签约、作家等级 白金 |
| 晋江 | theme=Love、pov=女主 (Female Lead)、age=13+、signed=true、access=paid (Paid (VIP)) | 主题 爱情、视角 女主、年龄 13+、签约、VIP付费 |
| 七猫 | audience=male、licensed_from=Chinese Online | 男频、版权方 中文在线 |
| SF 轻小说 | paid_vip=true、first_published=2019-12 (Dec 2019) | VIP付费（首发月份 DaoSearch 书页不显示） |

## 条款要点

- 免费，面向个人、研究与社区工具；商业用途须先获许可。
- 展示其数据的页面要有指向该书 `url` 的可见链接。
- 保存或展示超过 20,000 本书的数据须先获许可。
- 每个项目一个账号一个密钥；不要把密钥放进公开网页或代码仓库。
