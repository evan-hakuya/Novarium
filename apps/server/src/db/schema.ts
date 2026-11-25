import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

// 访问令牌。鉴权按 tokenHash 查找；token 存明文，供所有者再次查看书源（迁移 0004 之前创建的令牌为空）。
// 撤销后保留记录，revokedAt 非空；所有者可以删除记录。
export const accessTokens = sqliteTable("access_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  token: text("token"),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

// 书库级别的键值设置，例如默认整理选项与过滤词表。
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// 书。原稿与当前版本的正文都存在对象存储中，键名见 storage/keys.ts。
export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull().default(""),
  originalName: text("original_name").notNull(),
  originalSize: integer("original_size").notNull(),
  /** 原稿在存储中的键名。为空时是导入时的 books/{id}/original；以新版本替换原稿后指向新文件。 */
  originalKey: text("original_key"),
  /** 简介，所有者编辑；空字符串表示没有简介。 */
  intro: text("intro").notNull().default(""),
  /** 封面在存储中的键名与图片类型；没有封面时为空。每次上传换一个键，旧键随后删除。 */
  coverKey: text("cover_key"),
  coverType: text("cover_type"),
  currentVersionId: text("current_version_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// 书的标签。tag 保存所有者输入的文本，(book_id, tag) 唯一。
export const bookTags = sqliteTable(
  "book_tags",
  {
    bookId: text("book_id").notNull(),
    tag: text("tag").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.tag] }), index("book_tags_tag_idx").on(t.tag)],
);

// 版本：一本书整理后的正文及其章节索引。options 记录生成它的整理选项。
export const versions = sqliteTable(
  "versions",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id").notNull(),
    options: text("options", { mode: "json" }).notNull(),
    textSize: integer("text_size").notNull(),
    chapterCount: integer("chapter_count").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("versions_book_id_idx").on(t.bookId)],
);

// 章节索引：正文在版本文件中的 UTF-8 字节范围。ord 是阅读顺序。
export const chapters = sqliteTable(
  "chapters",
  {
    versionId: text("version_id").notNull(),
    ord: integer("ord").notNull(),
    title: text("title").notNull(),
    number: integer("number"),
    byteOffset: integer("byte_offset").notNull(),
    byteLength: integer("byte_length").notNull(),
    // 所属卷名；没有卷时为 null。
    volume: text("volume"),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.ord] })],
);

// 已上传但尚未被提交的书引用的文件。提交成功时删除记录；超时仍在的视为孤立文件，由定时清理删除。
export const pendingUploads = sqliteTable(
  "pending_uploads",
  {
    key: text("key").primaryKey(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("pending_uploads_created_at_idx").on(t.createdAt)],
);

// 登录失败记录，用于限制登录尝试次数（见 login-limit.ts）。移出时间窗口的记录在下次登录失败时删除。
export const loginFailures = sqliteTable(
  "login_failures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ip: text("ip").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("login_failures_ip_created_at_idx").on(t.ip, t.createdAt),
    index("login_failures_created_at_idx").on(t.createdAt),
  ],
);
