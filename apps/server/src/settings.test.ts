import { DEFAULT_PROCESS_OPTIONS } from "@novarium/core/validate";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, ownerCookieHeader } from "./test-app";

describe("整理选项", () => {
  let app: ReturnType<typeof createTestApp>;
  let cookie: string;
  const json = (body: unknown) => ({ "content-type": "application/json", cookie, body: JSON.stringify(body) });

  async function getDefaults() {
    const res = await app.fetchApi("/api/admin/settings/process-options", { headers: { cookie } });
    expect(res.status).toBe(200);
    return ((await res.json()) as { options: typeof DEFAULT_PROCESS_OPTIONS }).options;
  }

  async function putDefaults(options: unknown) {
    const { body, ...headers } = json({ options });
    return app.fetchApi("/api/admin/settings/process-options", { method: "PUT", headers, body });
  }

  beforeEach(async () => {
    app = createTestApp();
    cookie = await ownerCookieHeader();
  });

  it("未保存时返回内置默认值", async () => {
    expect(await getDefaults()).toEqual(DEFAULT_PROCESS_OPTIONS);
  });

  it("保存默认整理选项与过滤词表；默认值不保存章节正则", async () => {
    const res = await putDefaults({
      ...DEFAULT_PROCESS_OPTIONS,
      indent: false,
      filterWords: ["加群", " 加群 ", "最新章节"],
      filterMaxLineLength: 30,
      chapterPattern: "^卷.+$",
    });
    expect(res.status).toBe(200);
    expect(await getDefaults()).toEqual({
      ...DEFAULT_PROCESS_OPTIONS,
      indent: false,
      filterWords: ["加群", "最新章节"],
      filterMaxLineLength: 30,
      chapterPattern: null,
    });
  });

  it("拒绝无效的整理选项", async () => {
    expect((await putDefaults({ ...DEFAULT_PROCESS_OPTIONS, filterMaxLineLength: -1 })).status).toBe(400);
    expect((await putDefaults(null)).status).toBe(400);
    expect(await getDefaults()).toEqual(DEFAULT_PROCESS_OPTIONS);
  });

  it("需要所有者登录", async () => {
    expect((await app.fetchApi("/api/admin/settings/process-options")).status).toBe(401);
  });

  it("导入时版本记录所用的整理选项；无效选项被拒绝", async () => {
    const options = { ...DEFAULT_PROCESS_OPTIONS, filterWords: ["加群"], chapterPattern: "^卷.+$" };
    // 整理在浏览器中完成；这里直接给出整理结果。
    const original = new TextEncoder().encode("卷一 出发\n他推开门。\n卷二 归来\n他回来了。\n");
    const text = original;
    const chapters = [
      { order: 0, title: "卷一 出发", number: 1, byteOffset: 0, byteLength: 30 },
      { order: 1, title: "卷二 归来", number: 2, byteOffset: 30, byteLength: 30 },
    ];
    const id = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const put = (path: string, body: Uint8Array) =>
      app.fetchApi(path, {
        method: "PUT",
        headers: { cookie, "content-length": String(body.byteLength) },
        body: body as Uint8Array<ArrayBuffer>,
      });
    expect((await put(`/api/admin/books/${id}/original`, original)).status).toBe(201);
    expect((await put(`/api/admin/books/${id}/versions/${versionId}/text`, text)).status).toBe(201);

    const submit = (opts: unknown) => {
      const { body, ...headers } = json({ id, versionId, title: "卷书", originalName: "卷书.txt", options: opts, chapters });
      return app.fetchApi("/api/admin/books", { method: "POST", headers, body });
    };
    expect((await submit({ ...options, chapterPattern: "(" })).status).toBe(400);
    expect((await submit(options)).status).toBe(201);

    const detail = (await (await app.fetchApi(`/api/admin/books/${id}`, { headers: { cookie } })).json()) as {
      version: { options: unknown };
      chapters: { title: string }[];
    };
    expect(detail.version.options).toEqual(options);
    expect(detail.chapters.map((c) => c.title)).toEqual(["卷一 出发", "卷二 归来"]);
  });
});
