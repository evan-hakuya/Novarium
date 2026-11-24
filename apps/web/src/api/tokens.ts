import { request } from "./books";

export interface AccessToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const tokensQueryKey = ["tokens"] as const;
export const fetchTokens = () => request<{ tokens: AccessToken[] }>("/api/admin/tokens").then((r) => r.tokens);

/** 创建访问令牌。返回的书源 JSON 含明文令牌，只有这一次能拿到。 */
export const createToken = (name: string) =>
  request<{ token: AccessToken; bookSource: unknown }>("/api/admin/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });

export const revokeToken = (id: string) =>
  request<{ revoked: true }>(`/api/admin/tokens/${id}/revoke`, { method: "POST" });
