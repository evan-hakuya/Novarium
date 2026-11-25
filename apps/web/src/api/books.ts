import type { ChapterDraft, ProcessOptions } from "@novarium/core";

/** 单个上传文件的上限，与服务端一致。 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface BookSummary {
  id: string;
  title: string;
  author: string;
  chapterCount: number;
  textSize: number;
  createdAt: string;
  coverKey: string | null;
}

export interface BookDetail {
  book: {
    id: string;
    title: string;
    author: string;
    intro: string;
    tags: string[];
    coverKey: string | null;
    originalName: string;
    originalSize: number;
  };
  /** 当前版本。options 是生成它的整理选项。 */
  version: { id: string; options: ProcessOptions; createdAt: string };
  chapters: { order: number; title: string; number: number | null; byteLength: number; volume: string | null }[];
}

export interface ChapterContent {
  order: number;
  title: string;
  content: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: string[];

  constructor(status: number, code: string, details?: string[]) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => null)) as ({ error?: string; details?: string[] } & T) | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `http_${res.status}`, body?.details);
  return body as T;
}

export const booksQueryKey = ["books"] as const;
export const fetchBooks = () => request<{ books: BookSummary[] }>("/api/admin/books").then((r) => r.books);
export const fetchBook = (id: string) => request<BookDetail>(`/api/admin/books/${id}`);
export const fetchChapter = (id: string, order: number) =>
  request<ChapterContent>(`/api/admin/books/${id}/chapters/${order}`);

/** 封面图片地址；键名放进地址，换封面后浏览器不会显示缓存的旧图。 */
export const coverUrl = (book: { id: string; coverKey: string | null }) =>
  book.coverKey ? `/api/admin/books/${book.id}/cover?v=${book.coverKey.split("/").pop()}` : null;

export const MAX_COVER_BYTES = 5 * 1024 * 1024;

export interface BookMetadata {
  title: string;
  author: string;
  intro: string;
  tags: string[];
}

export const updateBook = (id: string, metadata: BookMetadata) =>
  request<{ ok: true }>(`/api/admin/books/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(metadata),
  });

export const uploadCover = (id: string, file: File) =>
  request<{ coverKey: string }>(`/api/admin/books/${id}/cover`, { method: "PUT", body: file });

export const removeCover = (id: string) => request<{ ok: true }>(`/api/admin/books/${id}/cover`, { method: "DELETE" });

export const deleteBook = (id: string) => request<{ deleted: true }>(`/api/admin/books/${id}`, { method: "DELETE" });

export interface NewBook {
  title: string;
  author: string;
  original: File;
  text: Uint8Array;
  chapters: ChapterDraft[];
  options: ProcessOptions;
}

/** 下载一本书的原稿，用于重新整理。 */
export async function fetchOriginal(bookId: string): Promise<ArrayBuffer> {
  const res = await fetch(`/api/admin/books/${bookId}/original`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `http_${res.status}`);
  }
  return res.arrayBuffer();
}

/** 重新整理后保存为新版本：先上传正文，再提交章节索引；服务端随后切换当前版本并删除旧版本。 */
export async function saveNewVersion(
  bookId: string,
  draft: { text: Uint8Array; chapters: ChapterDraft[]; options: ProcessOptions },
  onStep?: (step: "original" | "text" | "index") => void,
  /** 同时替换原稿：把重复导入的原稿作为这本书的新版本。 */
  original?: File,
) {
  const versionId = crypto.randomUUID();
  let replacement: { uploadId: string; name: string } | undefined;
  if (original) {
    const uploadId = crypto.randomUUID();
    onStep?.("original");
    await request(`/api/admin/books/${bookId}/originals/${uploadId}`, { method: "PUT", body: original });
    replacement = { uploadId, name: original.name };
  }
  onStep?.("text");
  await request(`/api/admin/books/${bookId}/versions/${versionId}/text`, {
    method: "PUT",
    body: draft.text as Uint8Array<ArrayBuffer>,
  });
  onStep?.("index");
  await request(`/api/admin/books/${bookId}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId, options: draft.options, chapters: draft.chapters, original: replacement }),
  });
  return versionId;
}

export interface DuplicateBook {
  id: string;
  title: string;
  author: string;
  originalName: string;
  chapterCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 书库中与给定书名、作者完全相同的书。 */
export const findDuplicates = (title: string, author: string) =>
  request<{ books: DuplicateBook[] }>(
    `/api/admin/books/duplicates?${new URLSearchParams({ title: title.trim(), author: author.trim() })}`,
  ).then((r) => r.books);

/** 导入一本书：先上传原稿与版本正文，再提交元数据与章节索引。返回书 ID。 */
export async function importBook(book: NewBook, onStep?: (step: "original" | "text" | "index") => void) {
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  onStep?.("original");
  await request(`/api/admin/books/${id}/original`, { method: "PUT", body: book.original });
  onStep?.("text");
  await request(`/api/admin/books/${id}/versions/${versionId}/text`, {
    method: "PUT",
    body: book.text as Uint8Array<ArrayBuffer>,
  });
  onStep?.("index");
  await request("/api/admin/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      versionId,
      title: book.title,
      author: book.author,
      originalName: book.original.name,
      options: book.options,
      chapters: book.chapters,
    }),
  });
  return id;
}

const errorText: Record<string, string> = {
  version_text_missing: "新版本正文没有上传完整。",
  original_missing: "原稿文件丢失。",
  too_large: "文件超过 100 MB，无法上传。",
  invalid_chapter_index: "章节索引没有通过服务端校验。",
  book_exists: "这本书已经存在。",
  invalid_title: "书名不能为空，且不能超过 200 字。",
  invalid_author: "作者不能超过 100 字。",
  invalid_intro: "简介不能超过 5000 字。",
  invalid_tags: "最多 20 个标签，每个不超过 20 字。",
  unsupported_image: "封面只支持 JPEG、PNG、GIF 或 WebP 图片。",
  cover_too_large: "封面不能超过 5 MB。",
  invalid_name: "名称不能为空，且不能超过 50 字。",
  token_revoked: "这个访问令牌已撤销。",
  token_not_viewable: "这个访问令牌创建时没有保存明文，无法再次查看书源。",
  unauthorized: "登录已失效，请重新登录。",
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const text = errorText[error.code] ?? `请求失败：${error.code}`;
    return error.details?.length ? `${text}\n${error.details.join("\n")}` : text;
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
