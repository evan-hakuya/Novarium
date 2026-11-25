import { beforeEach, describe, expect, it } from "vitest";
import { originalKey, versionTextKey } from "./storage/keys";
import { addBook, createTestApp, ORIGIN, ownerCookieHeader } from "./test-app";

const BOOK = "11111111-1111-4111-8111-111111111111";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);

describe("书的元数据与删除", () => {
  let app: ReturnType<typeof createTestApp>;
  let cookie: string;
  let auth: Record<string, string>;

  const admin = (path: string, init: RequestInit = {}) =>
    app.fetchApi(path, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) } });
  const patch = (body: unknown) =>
    admin(`/api/admin/books/${BOOK}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const putCover = (bytes: Uint8Array) =>
    admin(`/api/admin/books/${BOOK}/cover`, {
      method: "PUT",
      headers: { "content-length": String(bytes.byteLength) },
      body: bytes as Uint8Array<ArrayBuffer>,
    });
  const source = async (path: string) => (await app.fetchApi(path, { headers: auth })).json() as Promise<any>;

  beforeEach(async () => {
    app = createTestApp();
    cookie = await ownerCookieHeader();
    await addBook(app.deps, BOOK, "旧书名", "旧作者", [["第一章", "第一章\n正文。\n"]]);
    await app.deps.storage.put(originalKey(BOOK), new TextEncoder().encode("原稿"));
    const res = await admin("/api/admin/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name: "测试" }),
    });
    auth = JSON.parse(((await res.json()) as { bookSource: { header: string } }).bookSource.header);
  });

  it("编辑书名、作者、简介与标签；书源搜索按新书名与作者匹配", async () => {
    expect((await patch({ title: " 新书名 ", author: "新作者", intro: "一段简介", tags: ["校园", " 校园 ", "轻小说"] })).status).toBe(200);
    const detail = (await (await admin(`/api/admin/books/${BOOK}`)).json()) as { book: Record<string, unknown> };
    expect(detail.book).toMatchObject({ title: "新书名", author: "新作者", intro: "一段简介", tags: ["校园", "轻小说"] });

    expect((await source("/api/source/search?q=旧书名")).books).toEqual([]);
    const [hit] = (await source("/api/source/search?q=新作者")).books;
    expect(hit).toMatchObject({ title: "新书名", author: "新作者", intro: "一段简介", kind: "校园,轻小说", coverUrl: "" });

    expect((await patch({ tags: [] })).status).toBe(200);
    expect(((await (await admin(`/api/admin/books/${BOOK}`)).json()) as { book: { tags: string[] } }).book.tags).toEqual([]);
  });

  it("拒绝无效的元数据", async () => {
    expect((await patch({ title: " " })).status).toBe(400);
    expect((await patch({ tags: "校园" })).status).toBe(400);
    expect((await patch({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400);
    expect((await patch({ intro: "x".repeat(5001) })).status).toBe(400);
    expect((await app.fetchApi(`/api/admin/books/${BOOK}`, { method: "PATCH", body: "{}" })).status).toBe(401);
  });

  it("上传与替换封面；书源返回封面地址并能读取；旧封面被删除", async () => {
    expect((await putCover(new TextEncoder().encode("not an image"))).status).toBe(415);
    const first = (await (await putCover(PNG)).json()) as { coverKey: string };
    const [hit] = (await source("/api/source/search?q=旧书名")).books;
    expect(hit.coverUrl).toBe(`/api/covers/${BOOK}/${first.coverKey.split("/").pop()}`);
    // 不带访问令牌也能读取：阅读客户端的图片请求不一定带书源请求头。
    const cover = await app.fetchApi(new URL(hit.coverUrl, ORIGIN).toString());
    expect(cover.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await cover.arrayBuffer())).toEqual(PNG);
    expect((await app.fetchApi(`/api/covers/${BOOK}/${crypto.randomUUID()}`)).status).toBe(404);

    expect((await putCover(JPEG)).status).toBe(201);
    expect(await app.deps.storage.exists(first.coverKey)).toBe(false);
    expect((await app.fetchApi(new URL(hit.coverUrl, ORIGIN).toString())).status).toBe(404);
    const info = await source(`/api/source/books/${BOOK}`);
    expect(info.coverUrl).not.toBe(hit.coverUrl);
    expect((await admin(`/api/admin/books/${BOOK}/cover`)).headers.get("content-type")).toBe("image/jpeg");

    expect((await admin(`/api/admin/books/${BOOK}/cover`, { method: "DELETE" })).status).toBe(200);
    expect((await admin(`/api/admin/books/${BOOK}/cover`)).status).toBe(404);
  });

  it("删除书：同时删除原稿、版本正文、封面与数据库记录", async () => {
    await patch({ tags: ["校园"] });
    const { coverKey } = (await (await putCover(PNG)).json()) as { coverKey: string };
    const { db, storage } = app.deps;
    const versionId = (await db.all<{ id: string }>(`select id from versions where book_id = '${BOOK}'`))[0]!.id;

    expect((await admin(`/api/admin/books/${BOOK}`, { method: "DELETE" })).status).toBe(200);
    expect((await admin(`/api/admin/books/${BOOK}`, { method: "DELETE" })).status).toBe(404);
    for (const key of [originalKey(BOOK), versionTextKey(BOOK, versionId), coverKey]) expect(await storage.exists(key)).toBe(false);
    const [counts] = await db.all<Record<string, number>>(
      `select (select count(*) from books) b, (select count(*) from versions) v, (select count(*) from chapters) c,
              (select count(*) from book_tags) t, (select count(*) from pending_uploads) p`,
    );
    expect(counts).toEqual({ b: 0, v: 0, c: 0, t: 0, p: 0 });
    expect((await source("/api/source/search?q=旧书名")).books).toEqual([]);
  });
});
