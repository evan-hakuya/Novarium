import { describe, expect, it } from "vitest";
import { ApiError } from "./books";
import { formatWait, scrapeFailureReason } from "./scrape";

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
});
