# 第一版只支持 Cloudflare Workers 与 Docker 部署

第一版的部署目标只有 Cloudflare Workers（D1 + R2）和 Docker 自部署（本地 SQLite + 本地文件系统），Vercel 延后支持。Vercel 的默认数据库是 PostgreSQL（Neon），同时支持它就要维护第二套 Drizzle schema 与迁移，还要增加存储适配器；两个 SQLite 目标可以共用一套 schema。处理引擎、存储接口与数据库访问仍保持不依赖平台，以便以后加入 Vercel。
