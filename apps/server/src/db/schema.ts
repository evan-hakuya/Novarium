import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

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
  currentVersionId: text("current_version_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

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
  },
  (t) => [primaryKey({ columns: [t.versionId, t.ord] })],
);
