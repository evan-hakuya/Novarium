import { DEFAULT_PROCESS_OPTIONS } from "@novarium/core/validate";
import { beforeEach, describe, expect, it } from "vitest";
import { originalKey, replacementOriginalKey, versionTextKey } from "./storage/keys";
import { createTestApp, ownerCookieHeader } from "./test-app";

// 重新整理：上传新版本正文，提交章节索引，切换当前版本，删除旧版本。

const encoder = new TextEncoder();

/** 由章节正文拼出版本正文与章节索引。 */
function draft(chapterTexts: [string, string][]) {
  let offset = 0;
  const chapters = chapterTexts.map(([title, body], order) => {
    const byteLength = encoder.encode(body).length;
    const entry = { order, title, number: order + 1, byteOffset: offset, byteLength };
    offset += byteLength;
    return entry;
  });
  return { text: encoder.encode(chapterTexts.map(([, body]) => body).join("")), chapters };
}

describe("重新整理", () => {
  let app: ReturnType<typeof createTestApp>;
  let cookie: string;
  const bookId = crypto.randomUUID();
  let oldVersionId: string;
  const original = encoder.encode("第一章 甲\n正文一。\n第二章 乙\n正文二。\n");

  const put = (path: string, body: Uint8Array) =>
    app.fetchApi(path, {
      method: "PUT",
      headers: { cookie, "content-length": String(body.byteLength) },
      body: body as Uint8Array<ArrayBuffer>,
    });
  const post = (path: string, body: unknown) =>
    app.fetchApi(path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  const detail = async () =>
    (await (await app.fetchApi(`/api/admin/books/${bookId}`, { headers: { cookie } })).json()) as {
      version: { id: string; options: unknown };
      chapters: { title: string; notice: boolean }[];
    };

  async function uploadVersion(chapterTexts: [string, string][]) {
    const versionId = crypto.randomUUID();
    const d = draft(chapterTexts);
    expect((await put(`/api/admin/books/${bookId}/versions/${versionId}/text`, d.text)).status).toBe(201);
    return { versionId, chapters: d.chapters };
  }

  const newOptions = { ...DEFAULT_PROCESS_OPTIONS, chapterPattern: "^卷.+$" };
  const newChapters: [string, string][] = [["卷一 全", "卷一 全\n正文一。正文二。\n"]];

  beforeEach(async () => {
    app = createTestApp();
    cookie = await ownerCookieHeader();
    expect((await put(`/api/admin/books/${bookId}/original`, original)).status).toBe(201);
    const v = await uploadVersion([
      ["第一章 甲", "第一章 甲\n正文一。\n"],
      ["第二章 乙", "第二章 乙\n正文二。\n"],
    ]);
    oldVersionId = v.versionId;
    const res = await post("/api/admin/books", {
      id: bookId,
      versionId: v.versionId,
      title: "测试",
      originalName: "测试.txt",
      options: DEFAULT_PROCESS_OPTIONS,
      chapters: v.chapters,
    });
    expect(res.status).toBe(201);
  });

  it("可以下载原稿", async () => {
    const res = await app.fetchApi(`/api/admin/books/${bookId}/original`, { headers: { cookie } });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(original);
    expect((await app.fetchApi(`/api/admin/books/${bookId}/original`)).status).toBe(401);
  });

  it("切换到新版本，删除旧版本的正文与索引，原稿不变", async () => {
    // 早期客户端不提交作者公告，视为不是公告。
    expect((await detail()).chapters.map((c) => c.notice)).toEqual([false, false]);
    const v = await uploadVersion(newChapters);
    const chapters = [{ ...v.chapters[0]!, notice: true }];
    expect((await post(`/api/admin/books/${bookId}/versions`, { versionId: v.versionId, options: newOptions, chapters })).status).toBe(201);

    const d = await detail();
    expect(d.version).toMatchObject({ id: v.versionId, options: newOptions });
    expect(d.chapters.map((c) => [c.title, c.notice])).toEqual([["卷一 全", true]]);

    const { storage, db } = app.deps;
    expect(await storage.exists(versionTextKey(bookId, oldVersionId))).toBe(false);
    expect(await storage.size(originalKey(bookId))).toBe(original.byteLength);
    const leftovers = await db.all<{ n: number }>(
      `select (select count(*) from versions where id = '${oldVersionId}')
            + (select count(*) from chapters where version_id = '${oldVersionId}')
            + (select count(*) from pending_uploads) as n`,
    );
    expect(leftovers[0]!.n).toBe(0);

    const chapter = await app.fetchApi(`/api/admin/books/${bookId}/chapters/0`, { headers: { cookie } });
    expect(((await chapter.json()) as { content: string }).content).toBe("卷一 全\n正文一。正文二。\n");
  });

  it("新版本不完整时不切换", async () => {
    const missing = crypto.randomUUID();
    const v = await uploadVersion(newChapters);
    const bad = [{ ...v.chapters[0]!, byteLength: 9999 }];
    expect((await post(`/api/admin/books/${bookId}/versions`, { versionId: missing, options: newOptions, chapters: v.chapters })).status).toBe(400);
    expect((await post(`/api/admin/books/${bookId}/versions`, { versionId: v.versionId, options: newOptions, chapters: bad })).status).toBe(400);
    expect((await post(`/api/admin/books/${bookId}/versions`, { versionId: v.versionId, options: newOptions, chapters: [{ ...v.chapters[0]!, notice: "yes" }] })).status).toBe(400);
    expect((await post(`/api/admin/books/${bookId}/versions`, { versionId: v.versionId, options: { bad: 1 }, chapters: v.chapters })).status).toBe(400);
    expect((await post(`/api/admin/books/${crypto.randomUUID()}/versions`, { versionId: v.versionId, options: newOptions, chapters: v.chapters })).status).toBe(404);

    const d = await detail();
    expect(d.version.id).toBe(oldVersionId);
    expect(d.chapters).toHaveLength(2);
    expect(await app.deps.storage.exists(versionTextKey(bookId, oldVersionId))).toBe(true);
  });

  it("读章节时恰好切换版本、旧正文已删除：改读新版本，不报错", async () => {
    const v = await uploadVersion(newChapters);
    const { storage } = app.deps;
    const realGet = storage.get.bind(storage);
    let switched = false;
    storage.get = async (key, range) => {
      if (!switched && key === versionTextKey(bookId, oldVersionId)) {
        switched = true;
        await post(`/api/admin/books/${bookId}/versions`, { versionId: v.versionId, options: newOptions, chapters: v.chapters });
      }
      return realGet(key, range);
    };
    const res = await app.fetchApi(`/api/admin/books/${bookId}/chapters/0`, { headers: { cookie } });
    expect(switched).toBe(true);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { title: string }).title).toBe("卷一 全");
  });

  it("按书名与作者找出重复的书", async () => {
    const find = async (q: string) =>
      ((await (await app.fetchApi(`/api/admin/books/duplicates?${q}`, { headers: { cookie } })).json()) as { books: { id: string }[] }).books;
    expect((await find("title=%20测试%20&author=")).map((b) => b.id)).toEqual([bookId]);
    expect(await find("title=测试&author=某人")).toEqual([]);
    expect(await find("title=测&author=")).toEqual([]);
    expect((await app.fetchApi("/api/admin/books/duplicates?title=测试")).status).toBe(401);
  });

  it("作为新版本导入：替换原稿并切换版本，旧原稿与旧正文被删除", async () => {
    const uploadId = crypto.randomUUID();
    const newOriginal = encoder.encode("卷一 全\n正文一。正文二。\n");
    expect((await put(`/api/admin/books/${bookId}/originals/${uploadId}`, newOriginal)).status).toBe(201);
    const v = await uploadVersion(newChapters);
    const res = await post(`/api/admin/books/${bookId}/versions`, {
      versionId: v.versionId,
      options: newOptions,
      chapters: v.chapters,
      original: { uploadId, name: "测试（修订）.txt" },
    });
    expect(res.status).toBe(201);

    const book = (await (await app.fetchApi(`/api/admin/books/${bookId}`, { headers: { cookie } })).json()) as {
      book: { originalName: string; originalSize: number };
    };
    expect(book.book).toMatchObject({ originalName: "测试（修订）.txt", originalSize: newOriginal.byteLength });
    const downloaded = await app.fetchApi(`/api/admin/books/${bookId}/original`, { headers: { cookie } });
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(newOriginal);

    const { storage, db } = app.deps;
    expect(await storage.exists(originalKey(bookId))).toBe(false);
    expect(await storage.exists(versionTextKey(bookId, oldVersionId))).toBe(false);
    expect(await storage.exists(replacementOriginalKey(bookId, uploadId))).toBe(true);
    expect((await db.all<{ n: number }>("select count(*) as n from pending_uploads"))[0]!.n).toBe(0);
  });

  it("新原稿缺失时不切换，也不替换原稿", async () => {
    const v = await uploadVersion(newChapters);
    const res = await post(`/api/admin/books/${bookId}/versions`, {
      versionId: v.versionId,
      options: newOptions,
      chapters: v.chapters,
      original: { uploadId: crypto.randomUUID(), name: "x.txt" },
    });
    expect(res.status).toBe(400);
    expect((await detail()).version.id).toBe(oldVersionId);
    expect(await app.deps.storage.exists(originalKey(bookId))).toBe(true);
    expect((await put(`/api/admin/books/${crypto.randomUUID()}/originals/${crypto.randomUUID()}`, encoder.encode("x"))).status).toBe(404);
  });
});
