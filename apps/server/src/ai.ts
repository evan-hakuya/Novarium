// Workers AI 客户端（ADR 0007，`docs/agents/workers-ai.md`）。
// Cloudflare 部署用 `ai` 绑定，Docker 部署用 REST 接口；调用方不需要知道是哪一种。

/** 用到的模型。 */
export type AiModel = "clef" | "clairic";

/** AI 客户端的来源：Worker 的 `ai` 绑定，或带账户 ID 与 API 令牌的 REST 接口。 */
export type AiMode = "binding" | "rest";

export interface AiClient {
  readonly mode: AiMode;
  /** 调用模型，返回 `result` 部分。出错时抛出 AiError。 */
  run<T>(model: AiModel, input: Record<string, unknown>): Promise<T>;
}

/**
 * AI 调用失败的统一类型。
 * - quota：每日免费额度已用完（3036）。
 * - busy：容量不足或请求过多（3040、429）。
 * - timeout：超时（3007、3008、408，或本地计时器）。
 * - unavailable：其他错误，包括令牌无效、模型不可用、响应格式不对。
 */
export type AiErrorKind = "quota" | "busy" | "timeout" | "unavailable";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
  }
}

/** 单次调用的超时。clairic 实测约 4 秒，留足余量。 */
export const AI_TIMEOUT_MS = 30_000;

const modelId = (model: AiModel) => `@cf/cloudflare/${model}`;

/** 按 Workers AI 的内部错误码与 HTTP 状态归类。 */
export function classifyAiError(code: number | undefined, status: number | undefined): AiErrorKind {
  if (code === 3036) return "quota";
  if (code === 3040 || status === 429) return "busy";
  if (code === 3007 || code === 3008 || status === 408) return "timeout";
  return "unavailable";
}

/** 绑定抛出的错误只有文字，错误码写在开头，例如「3036: You have used up …」。 */
function codeInMessage(message: string): number | undefined {
  const match = /\b(3\d{3}|5\d{3})\b/.exec(message);
  return match ? Number(match[1]) : undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiError("timeout", `AI request timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** 最小的绑定接口，避免依赖生成的 Ai 类型中具体的模型列表。 */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export function createBindingAiClient(binding: AiBinding, timeoutMs = AI_TIMEOUT_MS): AiClient {
  return {
    mode: "binding",
    async run<T>(model: AiModel, input: Record<string, unknown>) {
      try {
        return (await withTimeout(binding.run(modelId(model), input), timeoutMs)) as T;
      } catch (error) {
        if (error instanceof AiError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new AiError(classifyAiError(codeInMessage(message), undefined), message);
      }
    },
  };
}

export interface RestAiConfig {
  accountId: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createRestAiClient({ accountId, token, fetch: doFetch = fetch, timeoutMs = AI_TIMEOUT_MS }: RestAiConfig): AiClient {
  return {
    mode: "rest",
    async run<T>(model: AiModel, input: Record<string, unknown>) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelId(model)}`;
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "TimeoutError" || name === "AbortError") throw new AiError("timeout", `AI request timed out after ${timeoutMs} ms`);
        throw new AiError("unavailable", error instanceof Error ? error.message : String(error));
      }
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; result?: unknown; errors?: { code?: number; message?: string }[] }
        | null;
      if (!res.ok || !body?.success) {
        const first = body?.errors?.[0];
        throw new AiError(classifyAiError(first?.code, res.status), first?.message ?? `HTTP ${res.status}`);
      }
      return body.result as T;
    },
  };
}

/** 按部署环境选择客户端：有绑定用绑定，否则有账户 ID 与令牌时用 REST，都没有时返回 null。 */
export function createAiClient(options: { binding?: AiBinding; accountId?: string; token?: string }): AiClient | null {
  if (options.binding) return createBindingAiClient(options.binding);
  if (options.accountId && options.token) return createRestAiClient({ accountId: options.accountId, token: options.token });
  return null;
}
