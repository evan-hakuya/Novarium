import { describe, expect, it } from "vitest";
import { ApiError } from "./books";
import { costText, formatFacet, formatWait, formatWordCount, platformName, scrapeFailureReason } from "./scrape";

describe("点数提示", () => {
  it("按缓存状态说明是否消耗点数", () => {
    expect([costText("fresh", 5), costText("stale", 5), costText("none", 5)]).toEqual([
      "已缓存，不消耗点数",
      "已缓存，内容没变时不消耗点数",
      "消耗 5 点",
    ]);
  });
});

describe("平台标记的中文", () => {
  const f = (key: string, label: string, value: string, raw?: string) => ({ key, label, value, ...(raw ? { raw } : {}) });

  it("是或否的标记只显示名称，读者与阅读方式只显示值，其他显示名称和值", () => {
    expect(
      [
        f("audience", "Audience", "Male", "male"),
        f("signed", "Signed", "Signed", "true"),
        f("author_tier", "Author tier", "Platinum", "Platinum"),
        f("pov", "POV", "Female Lead", "女主"),
        f("access", "Access", "Paid (VIP)", "paid"),
        f("paid_vip", "Paid (VIP)", "Paid (VIP)", "true"),
        f("age", "Age", "13+", "13+"),
        f("first_published", "First published", "Dec 2019", "2019-12"),
      ].map(formatFacet),
    ).toEqual(["男频", "签约", "作家等级 白金", "视角 女主", "VIP付费", "VIP付费", "年龄 13+", "首发月份 2019年12月"]);
    expect(formatFacet(f("signed", "Signed", "No", "false"))).toBeNull();
  });

  it("#99 之前保存的没有原值，按英文对照；没见过的值与 key 显示源站文字", () => {
    expect([f("audience", "Audience", "Male"), f("signed", "Signed", "Signed"), f("author_tier", "Author tier", "Great God")].map(formatFacet)).toEqual([
      "男频",
      "签约",
      "作家等级 Great God",
    ]);
    expect(formatFacet(f("new_key", "New thing", "Yes", "yes"))).toBe("New thing Yes");
  });
});

describe("刮削错误文字", () => {
  const failed = (kind: string, retryAfterSeconds?: number) => new ApiError(502, "scrape_unavailable", undefined, kind, retryAfterSeconds);

  it("按 kind 显示原因，有等待时间时附上", () => {
    expect(scrapeFailureReason(failed("invalid_key"))).toBe("密钥无效或已撤销，请在 DaoSearch 账号页检查");
    expect(scrapeFailureReason(failed("rate_limited", 30))).toBe("请求过于频繁，30 秒后重试");
    expect(scrapeFailureReason(failed("quota", 7200))).toBe("今日点数已用完，2 小时后重试");
    expect(scrapeFailureReason(failed("something_new"))).toBe("DaoSearch 暂时不可用");
  });

  it("未填写密钥与其他错误", () => {
    expect(scrapeFailureReason(new ApiError(409, "scrape_not_configured"))).toBe("还没有填写 DaoSearch 密钥");
    expect(scrapeFailureReason(new ApiError(401, "unauthorized"))).not.toContain("DaoSearch");
    expect(scrapeFailureReason(new TypeError("Failed to fetch"))).toBe("Failed to fetch");
  });

  it("等待时间分秒、分钟、小时三档", () => {
    expect(formatWait(59)).toBe("59 秒");
    expect(formatWait(61)).toBe("2 分钟");
    expect(formatWait(3601)).toBe("2 小时");
  });

  it("字数与平台名", () => {
    expect(formatWordCount(4465000)).toBe("446.5 万字");
    expect(formatWordCount(20000)).toBe("2 万字");
    expect(formatWordCount(9999)).toBe("9999 字");
    expect(formatWordCount(null)).toBeNull();
    expect(platformName("qidian")).toBe("起点");
    expect(platformName("new_site")).toBe("new_site");
  });
});
