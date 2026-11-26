import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "./db/schema";
import { addBook, createTestApp, ORIGIN, ownerCookieHeader } from "./test-app";

// 书源契约测试：按 Legado 的方式使用导出的书源 JSON——
// 每个请求都带上 `header` 中的请求头，相对链接按当前请求地址补全，规则是 `$.x` / `$.x[*]` 形式的 JsonPath。

type BookSource = {
  bookSourceUrl: string;
  header: string;
  searchUrl: string;
  enabledExplore: boolean;
  exploreUrl: string;
  ruleSearch: Record<string, string>;
  ruleExplore: Record<string, string>;
  ruleBookInfo: Record<string, string>;
  ruleToc: Record<string, string>;
  ruleContent: Record<string, string>;
};

function jsonPath(data: unknown, rule: string): any {
  const match = /^\$\.(\w+)(\[\*\])?$/.exec(rule);
  if (!match) throw new Error(`unsupported rule ${rule}`);
  return (data as Record<string, unknown>)[match[1]!];
}

/** 一个只懂 JSON 书源的极简 Legado。 */
function legadoClient(source: BookSource, fetchApi: (url: string, init?: RequestInit) => Promise<Response>) {
  const headers = JSON.parse(source.header) as Record<string, string>;
  const requested: { url: string; authorization: string | undefined }[] = [];
  async function get(url: string) {
    requested.push({ url, authorization: headers.Authorization });
    const res = await fetchApi(url, { headers });
    expect(res.status, url).toBe(200);
    return { url, body: await res.json() };
  }
  return {
    requested,
    async search(key: string, page = 1) {
      const url = new URL(
        source.searchUrl.replace("{{key}}", encodeURIComponent(key)).replace("{{page}}", String(page)),
        source.bookSourceUrl,
      ).toString();
      const res = await get(url);
      return (jsonPath(res.body, source.ruleSearch.bookList!) as unknown[]).map((item) => ({
        name: jsonPath(item, source.ruleSearch.name!),
        author: jsonPath(item, source.ruleSearch.author!),
        lastChapter: jsonPath(item, source.ruleSearch.lastChapter!),
        bookUrl: new URL(jsonPath(item, source.ruleSearch.bookUrl!), url).toString(),
      }));
    },
    /** 发现页入口。exploreUrl 是 JSON 数组形式的 [{ title, url }]。 */
    exploreEntries() {
      expect(source.enabledExplore).toBe(true);
      return JSON.parse(source.exploreUrl) as { title: string; url: string }[];
    },
    async explore(entryUrl: string, page = 1) {
      const url = new URL(entryUrl.replace("{{page}}", String(page)), source.bookSourceUrl).toString();
      const res = await get(url);
      return (jsonPath(res.body, source.ruleExplore.bookList!) as unknown[]).map((item) => ({
        name: jsonPath(item, source.ruleExplore.name!) as string,
        kind: jsonPath(item, source.ruleExplore.kind!) as string,
        bookUrl: new URL(jsonPath(item, source.ruleExplore.bookUrl!), url).toString(),
      }));
    },
    async bookInfo(bookUrl: string) {
      const res = await get(bookUrl);
      return {
        name: jsonPath(res.body, source.ruleBookInfo.name!),
        intro: jsonPath(res.body, source.ruleBookInfo.intro!) as string,
        tocUrl: new URL(jsonPath(res.body, source.ruleBookInfo.tocUrl!), bookUrl).toString(),
      };
    },
    async toc(tocUrl: string) {
      const res = await get(tocUrl);
      return (jsonPath(res.body, source.ruleToc.chapterList!) as unknown[]).map((item) => ({
        name: jsonPath(item, source.ruleToc.chapterName!),
        url: new URL(jsonPath(item, source.ruleToc.chapterUrl!), tocUrl).toString(),
        isVolume: jsonPath(item, source.ruleToc.isVolume!) === true,
      }));
    },
    async content(chapterUrl: string) {
      const res = await get(chapterUrl);
      return jsonPath(res.body, source.ruleContent.content!) as string;
    },
  };
}

describe("书源", () => {
  let app: ReturnType<typeof createTestApp>;
  let ownerCookie: string;

  async function createToken(name: string) {
    const res = await app.fetchApi("/api/admin/tokens", {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { token: { id: string }; bookSource: BookSource; importUrl: string };
  }

  beforeEach(async () => {
    app = createTestApp();
    ownerCookie = await ownerCookieHeader();
    await addBook(app.deps, "11111111-1111-4111-8111-111111111111", "归藏试读", "无名氏", [
      ["第一章 开端", "第一章 开端\n正文一。\n"],
      ["第二章 归来", "第二章 归来\n正文二，含中文与 emoji 🌙。\n"],
    ]);
    await addBook(app.deps, "22222222-2222-4222-8222-222222222222", "100%_纯净", "张三", [["序", "序\n内容\n"]]);
  });

  it("按 Legado 的方式完成搜索、详情、目录与正文，每个请求都带访问令牌", async () => {
    const { bookSource } = await createToken("我的手机");
    expect(bookSource.bookSourceUrl).toBe(ORIGIN);
    expect(JSON.stringify(bookSource)).not.toMatch(/[?&]token=/);
    const client = legadoClient(bookSource, app.fetchApi);

    const results = await client.search("归藏");
    expect(results).toEqual([
      {
        name: "归藏试读",
        author: "无名氏",
        lastChapter: "第二章 归来",
        bookUrl: `${ORIGIN}/api/source/books/11111111-1111-4111-8111-111111111111`,
      },
    ]);
    const info = await client.bookInfo(results[0]!.bookUrl);
    expect(info.name).toBe("归藏试读");
    const toc = await client.toc(info.tocUrl);
    expect(toc.map((ch) => ch.name)).toEqual(["第一章 开端", "第二章 归来"]);
    expect(toc.some((ch) => ch.isVolume)).toBe(false);
    expect(await client.content(toc[1]!.url)).toBe("第二章 归来\n正文二，含中文与 emoji 🌙。\n");

    expect(client.requested).toHaveLength(4);
    for (const req of client.requested) {
      expect(req.url.startsWith(ORIGIN)).toBe(true);
      expect(req.url).not.toContain("nvr_");
    }
  });

  it("刮削过的书，简介末尾附 DaoSearch 署名链接；没有刮削过的书不变", async () => {
    const client = legadoClient((await createToken("我的手机")).bookSource, app.fetchApi);
    const [book] = await client.search("归藏");
    expect((await client.bookInfo(book!.bookUrl)).intro).toBe("共 2 章");

    const url = "https://daosearch.io/qidian/book/1/x";
    await app.deps.db
      .update(schema.books)
      .set({ intro: "所有者写的简介", scrapeSource: "daosearch", scrapeRef: "qidian/1", scrapeUrl: url, scrapedAt: new Date() })
      .where(eq(schema.books.id, "11111111-1111-4111-8111-111111111111"));
    expect((await client.bookInfo(book!.bookUrl)).intro).toBe(`所有者写的简介\n\n资料来源：DaoSearch ${url}`);
    const [other] = await client.search("纯净");
    expect((await client.bookInfo(other!.bookUrl)).intro).toBe("共 1 章");
  });

  describe("发现页", () => {
    const tag = (bookId: string, ...tags: string[]) =>
      app.deps.db.insert(schema.bookTags).values(tags.map((t) => ({ bookId, tag: t })));

    it("为每个标签列出入口，点进去列出带这个标签的书", async () => {
      await tag("11111111-1111-4111-8111-111111111111", "短篇", "试读 & 样章");
      await tag("22222222-2222-4222-8222-222222222222", "短篇");
      const client = legadoClient((await createToken("平板")).bookSource, app.fetchApi);
      const entries = client.exploreEntries();
      expect(entries.map((e) => e.title)).toEqual(["全部", "短篇", "试读 & 样章"]);

      const names = async (url: string) => (await client.explore(url)).map((b) => b.name).sort();
      expect(await names(entries[0]!.url)).toEqual(["100%_纯净", "归藏试读"]);
      expect(await names(entries[1]!.url)).toEqual(["100%_纯净", "归藏试读"]);
      const special = await client.explore(entries[2]!.url);
      expect(special).toEqual([
        {
          name: "归藏试读",
          kind: "短篇,试读 & 样章",
          bookUrl: `${ORIGIN}/api/source/books/11111111-1111-4111-8111-111111111111`,
        },
      ]);
      expect((await client.bookInfo(special[0]!.bookUrl)).name).toBe("归藏试读");
    });

    it("分页，每页 20 本", async () => {
      for (let i = 0; i < 21; i++) {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        await addBook(app.deps, id, `长篇${i}`, "某人", [["第一章", "正文\n"]]);
        await tag(id, "长篇");
      }
      const client = legadoClient((await createToken("平板")).bookSource, app.fetchApi);
      const entry = client.exploreEntries().find((e) => e.title === "长篇")!;
      const first = await client.explore(entry.url, 1);
      const second = await client.explore(entry.url, 2);
      expect(first).toHaveLength(20);
      expect(second).toHaveLength(1);
      expect(new Set([...first, ...second].map((b) => b.name)).size).toBe(21);
      expect(await client.explore(entry.url, 3)).toEqual([]);
    });

    it("标签变化后，重新导入书源即可看到新的入口", async () => {
      const { importUrl } = await createToken("平板");
      const importSource = async () => ((await (await app.fetchApi(importUrl)).json()) as BookSource[])[0]!;
      expect(legadoClient(await importSource(), app.fetchApi).exploreEntries().map((e) => e.title)).toEqual(["全部"]);

      await tag("22222222-2222-4222-8222-222222222222", "新标签");
      expect(legadoClient(await importSource(), app.fetchApi).exploreEntries().map((e) => e.title)).toEqual([
        "全部",
        "新标签",
      ]);
    });
  });

  it("目录在每卷第一章前插入卷条目", async () => {
    await addBook(app.deps, "33333333-3333-4333-8333-333333333333", "分卷之书", "某人", [
      ["第一章 起", "第一章 起\n甲\n", "第一卷 春"],
      ["第二章 承", "第二章 承\n乙\n", "第一卷 春"],
      ["第一章 转", "第一章 转\n丙\n", "第二卷 秋"],
    ]);
    const client = legadoClient((await createToken("平板")).bookSource, app.fetchApi);
    const [book] = await client.search("分卷之书");
    const toc = await client.toc((await client.bookInfo(book!.bookUrl)).tocUrl);
    expect(toc.map((ch) => [ch.name, ch.isVolume])).toEqual([
      ["第一卷 春", true],
      ["第一章 起", false],
      ["第二章 承", false],
      ["第二卷 秋", true],
      ["第一章 转", false],
    ]);
    expect(await client.content(toc[4]!.url)).toBe("第一章 转\n丙\n");
    expect(new Set(toc.map((ch) => ch.url)).size).toBe(toc.length);
    expect(await client.content(toc[0]!.url)).toBe("");
  });

  it("按作者搜索，并把 % 与 _ 当作普通字符", async () => {
    const client = legadoClient((await createToken("平板")).bookSource, app.fetchApi);
    expect((await client.search("张三")).map((b) => b.name)).toEqual(["100%_纯净"]);
    expect((await client.search("%_")).map((b) => b.name)).toEqual(["100%_纯净"]);
    expect(await client.search("%")).toHaveLength(1);
    expect(await client.search("不存在")).toEqual([]);
    expect(await client.search("归藏", 2)).toEqual([]);
  });

  it("拒绝缺少、错误和已撤销的访问令牌", async () => {
    const { token, bookSource } = await createToken("旧手机");
    const headers = JSON.parse(bookSource.header) as Record<string, string>;
    const searchPath = "/api/source/search?q=%E5%BD%92";

    expect((await app.fetchApi(searchPath)).status).toBe(401);
    expect((await app.fetchApi(searchPath, { headers: { Authorization: "Bearer nvr_wrong" } })).status).toBe(401);
    expect((await app.fetchApi(searchPath, { headers })).status).toBe(200);

    const revoke = await app.fetchApi(`/api/admin/tokens/${token.id}/revoke`, {
      method: "POST",
      headers: { cookie: ownerCookie },
    });
    expect(revoke.status).toBe(200);
    expect((await app.fetchApi(searchPath, { headers })).status).toBe(401);
    expect((await app.fetchApi("/api/source/books/11111111-1111-4111-8111-111111111111/chapters/0", { headers })).status).toBe(401);
  });

  it("所有者列出访问令牌，列表不含明文与哈希", async () => {
    await createToken("我的手机");
    const { token } = await createToken("平板");
    await app.fetchApi(`/api/admin/tokens/${token.id}/revoke`, { method: "POST", headers: { cookie: ownerCookie } });
    const res = await app.fetchApi("/api/admin/tokens", { headers: { cookie: ownerCookie } });
    const body = (await res.json()) as { tokens: Record<string, unknown>[] };
    expect(body.tokens.map((t) => [t.name, t.revokedAt !== null])).toEqual([
      ["平板", true],
      ["我的手机", false],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/nvr_|tokenHash/);
  });

  it("管理访问令牌需要所有者登录", async () => {
    expect((await app.fetchApi("/api/admin/tokens")).status).toBe(401);
    expect((await app.fetchApi("/api/admin/tokens", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("不存在的书与章节返回 404", async () => {
    const headers = JSON.parse((await createToken("手机")).bookSource.header) as Record<string, string>;
    const id = "11111111-1111-4111-8111-111111111111";
    expect((await app.fetchApi(`/api/source/books/${crypto.randomUUID()}`, { headers })).status).toBe(404);
    expect((await app.fetchApi(`/api/source/books/${id}/chapters/9`, { headers })).status).toBe(404);
    expect((await app.fetchApi(`/api/source/books/${id}/chapters/-1`, { headers })).status).toBe(404);
  });

  it("所有者可以再次查看书源；撤销后不能再查看", async () => {
    const created = await createToken("我的手机");
    const view = () => app.fetchApi(`/api/admin/tokens/${created.token.id}/book-source`, { headers: { cookie: ownerCookie } });
    const res = await view();
    expect(res.status).toBe(200);
    const again = (await res.json()) as { bookSource: BookSource; importUrl: string };
    expect(again.bookSource.header).toBe(created.bookSource.header);
    expect(again.importUrl).toBe(created.importUrl);

    await app.fetchApi(`/api/admin/tokens/${created.token.id}/revoke`, { method: "POST", headers: { cookie: ownerCookie } });
    expect((await view()).status).toBe(409);
  });

  it("删除访问令牌记录后，令牌立即失效并从列表消失", async () => {
    const { token, bookSource } = await createToken("我的手机");
    const headers = JSON.parse(bookSource.header) as Record<string, string>;
    const del = () => app.fetchApi(`/api/admin/tokens/${token.id}`, { method: "DELETE", headers: { cookie: ownerCookie } });
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(404);
    expect((await app.fetchApi("/api/source/search?q=x", { headers })).status).toBe(401);
    const list = (await (await app.fetchApi("/api/admin/tokens", { headers: { cookie: ownerCookie } })).json()) as { tokens: unknown[] };
    expect(list.tokens).toEqual([]);
    expect((await app.fetchApi(`/api/admin/tokens/${token.id}`, { method: "DELETE" })).status).toBe(401);
  });

  it("网络导入：不带请求头下载书源，导入后可以读书", async () => {
    const { token, importUrl } = await createToken("我的手机");
    expect(importUrl).toMatch(new RegExp(`^${ORIGIN}/api/book-sources/nvr_`));

    // 阅读客户端从另一个地址访问时，书源地址跟随导入请求。
    const res = await app.fetchApi(importUrl.replace(ORIGIN, "http://host.docker.internal:8787"));
    expect(res.status).toBe(200);
    const imported = (await res.json()) as BookSource[];
    expect(imported).toHaveLength(1);
    expect(imported[0]!.bookSourceUrl).toBe("http://host.docker.internal:8787");

    const client = legadoClient({ ...imported[0]!, bookSourceUrl: ORIGIN }, app.fetchApi);
    const [book] = await client.search("无名氏");
    expect(book!.name).toBe("归藏试读");

    const proxied = await app.fetchApi(importUrl, { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "books.example" } });
    expect(((await proxied.json()) as BookSource[])[0]!.bookSourceUrl).toBe("https://books.example");

    await app.fetchApi(`/api/admin/tokens/${token.id}/revoke`, { method: "POST", headers: { cookie: ownerCookie } });
    expect((await app.fetchApi(importUrl)).status).toBe(404);
    expect((await app.fetchApi("/api/book-sources/nvr_wrong")).status).toBe(404);
  });
});
