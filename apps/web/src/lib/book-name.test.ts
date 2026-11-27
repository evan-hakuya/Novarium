import { describe, expect, it } from "vitest";
import { guessBookName } from "./book-name";

describe("guessBookName", () => {
  it("Z-Library 文件名：去掉站点括号，最后一个括号是作者", () => {
    const name = "实教,我有人生模拟器 (正文完结+后日谈+个人番外四章) (这里是婴宁) (z-library.sk, 1lib.sk, z-lib.sk).txt";
    expect(guessBookName(name)).toEqual({ title: "实教,我有人生模拟器", author: "这里是婴宁" });
    expect(guessBookName("书名 (说明) (某人) (Z-Library).txt")).toEqual({ title: "书名", author: "某人" });
    // 只剩一个括号时不当作者，改看原稿开头。
    expect(guessBookName("书名 (上) (z-lib.sk).txt", "作者：某人")).toEqual({ title: "书名 (上)", author: "某人" });
    // 剩下的括号正是作者时，从书名里去掉。
    expect(guessBookName("诡秘之主 (爱潜水的乌贼) (z-library.sk).txt", "作者：爱潜水的乌贼")).toEqual({
      title: "诡秘之主",
      author: "爱潜水的乌贼",
    });
  });

  it("常见格式不变", () => {
    expect(guessBookName("《归藏试读》作者：无名氏.txt")).toEqual({ title: "归藏试读", author: "无名氏" });
    expect(guessBookName("书名 (上).txt")).toEqual({ title: "书名 (上)", author: "" });
  });

  it("文件名没有作者时，从原稿开头读取", () => {
    const head = "《实教，我有人生模拟器》（正文完结） 作者：这里是婴宁\n简介：";
    expect(guessBookName("实教.txt", head)).toEqual({ title: "实教", author: "这里是婴宁" });
    const late = `${"正文\n".repeat(30)}作者：不是他`;
    expect(guessBookName("实教.txt", late).author).toBe("");
    expect(guessBookName("实教.txt", "作者：\n简介：一本书").author).toBe("");
  });
});
