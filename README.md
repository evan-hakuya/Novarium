# Novarium 归藏

自托管的私人书库。上传 TXT 原稿，整理成章节清晰的书，再通过 Legado（阅读）书源在手机上读。

- 一个部署实例只服务一个所有者。
- 整理在浏览器中完成：自动识别编码、清洗正文、按章节与卷分章，并检查章节序号。
- 「阅读」App 用访问令牌读取书库，可以搜索、浏览发现页、读目录和正文。

## 部署到 Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/evan-hakuya/Novarium)

1. 点击上面的按钮，用 Cloudflare 账户登录，并授权访问 GitHub。Cloudflare 会把仓库复制到你的 GitHub 账户。
2. 在设置页确认 D1 数据库和 R2 存储桶的名称（可以用默认值），它们会自动创建并绑定。
3. 在 `OWNER_PASSWORD` 中填写所有者密码，登录后台时使用。
4. 构建命令与部署命令保持预填的值（`package.json` 中的 `build` 与 `deploy` 脚本）。部署脚本先部署 Worker，再执行 D1 迁移。
5. 部署完成后打开 Worker 的地址，用所有者密码登录。

以后往复制出的仓库推送代码，Cloudflare 会自动重新部署。

R2 需要先在 Cloudflare 控制台中开通。没有开通时，部署会在创建存储桶时失败。

### 手动部署

```sh
pnpm install
pnpm --filter @novarium/server exec wrangler login   # 或设置 CLOUDFLARE_API_TOKEN
pnpm deploy:cf
pnpm --filter @novarium/server exec wrangler secret put OWNER_PASSWORD
```

`pnpm deploy:cf` 先构建网页，再执行 `wrangler deploy`，最后执行 D1 迁移。

## 用 Docker 自部署

镜像发布在 GHCR：`ghcr.io/evan-hakuya/novarium`，支持 amd64 与 arm64。

```sh
mkdir novarium && cd novarium
curl -O https://raw.githubusercontent.com/evan-hakuya/Novarium/main/compose.yaml
echo "OWNER_PASSWORD=$(openssl rand -base64 24)" > .env
docker compose up -d
```

打开 `http://<主机>:8080`，用 `.env` 中的密码登录。容器启动时自动执行数据库迁移。数据都在 `./data` 中，备份这个目录即可。

升级：`docker compose pull && docker compose up -d`。

放在反向代理后面时：

- 代理需要传递 `X-Forwarded-Proto` 与 `X-Forwarded-Host`，书源中的地址才会是外部地址。
- 设置环境变量 `TRUST_PROXY=true`，并让代理把客户端地址追加到 `X-Forwarded-For`。登录失败次数按来源 IP 限制；不设置时，所有请求都算作代理的 IP。没有反向代理时不要设置，否则客户端可以伪造来源 IP。

## AI 复核（可选）

整理时可以手动让 Cloudflare Workers AI 识别书名、作者、简介，并复核章节划分。原稿片段会发送到 Cloudflare 处理，所以默认关闭，在后台设置页开启。每个 Cloudflare 账户每天有 10,000 Neurons 免费额度。

- Cloudflare 部署：`wrangler.jsonc` 已包含 `ai` 绑定，不需要额外配置。
- Docker 部署：在 `.env` 中设置 `WORKERS_AI_ACCOUNT_ID`（Cloudflare 账户 ID）与 `WORKERS_AI_TOKEN`（有 Workers AI 权限的 API 令牌）。不设置时后台不显示 AI 功能。

设置页的「测试连接」会发出一道很小的测试题，确认配置可用。

## 登录保护

同一来源 IP 在 15 分钟内登录失败 5 次后，这个 IP 要等到窗口结束才能再登录（密码正确也不行）。全书库在 15 分钟内失败 50 次后，所有登录暂停到窗口结束。登录页会显示还需等待多久。

## 数据库迁移与发布顺序

Cloudflare 部署先执行 `wrangler deploy`，再执行 D1 迁移。首次部署时 D1 数据库由 `wrangler deploy` 自动创建，部署前数据库还不存在，所以迁移只能放在后面。迁移命令使用绑定名 `DB`，你给数据库起别的名字也能迁移。

这个顺序有一个风险：新代码上线后、迁移完成前，有一小段时间新代码在旧表结构上处理请求。因此表结构变更分两次发布（先扩展、后收缩）：

1. **扩展**：只加新列或新表，新代码在新列不存在或为空时也能工作。
2. **收缩**：等所有实例都完成上一步的迁移后，再发布删除旧列、旧表或加约束的迁移。

不要在一次发布中改列名或删除仍被旧代码使用的列。

## 开发

```sh
pnpm install
cp .dev.vars.example .dev.vars        # 修改 OWNER_PASSWORD
pnpm --filter @novarium/web build
cd apps/server && pnpm dev            # http://localhost:8787
```

- `pnpm typecheck`、`pnpm test`：类型检查与测试。
- `packages/core`：整理引擎；`apps/server`：API（Cloudflare Workers 与 Node.js 两个入口）；`apps/web`：后台。
- 领域术语见 [GLOSSARY.md](GLOSSARY.md)，架构决策见 [docs/adr](docs/adr)。

## 许可

[MIT](LICENSE)
