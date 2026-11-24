import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

// D1 是异步驱动，better-sqlite3 是同步驱动；业务代码一律 await，两者都适用。
export type Db = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>;
