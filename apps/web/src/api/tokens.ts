import { request } from "./books";

export interface AccessToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** 是否保存了明文、可以再次查看书源。早期创建的令牌为 false。 */
  viewable: boolean;
}

export interface BookSourceInfo {
  bookSource: unknown;
  /** 网络导入地址，含访问令牌。 */
  importUrl: string;
}

export const tokensQueryKey = ["tokens"] as const;
export const bookSourceQueryKey = (id: string) => ["tokens", id, "book-source"] as const;

export const fetchTokens = () => request<{ tokens: AccessToken[] }>("/api/admin/tokens").then((r) => r.tokens);

export const fetchBookSource = (id: string) => request<BookSourceInfo>(`/api/admin/tokens/${id}/book-source`);

export const createToken = (name: string) =>
  request<{ token: AccessToken } & BookSourceInfo>("/api/admin/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });

export const revokeToken = (id: string) =>
  request<{ revoked: true }>(`/api/admin/tokens/${id}/revoke`, { method: "POST" });

export const deleteToken = (id: string) => request<{ deleted: true }>(`/api/admin/tokens/${id}`, { method: "DELETE" });

/** 「阅读」（Legado）的一键导入链接，在装有「阅读」的手机上打开。 */
export const legadoImportLink = (importUrl: string) =>
  `legado://import/bookSource?src=${encodeURIComponent(importUrl)}`;
