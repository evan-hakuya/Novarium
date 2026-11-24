import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// 书库级别的键值设置，例如默认整理选项与过滤词表。
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
