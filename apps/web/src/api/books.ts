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
}

export interface BookDetail {
  book: { id: string; title: string; author: string; originalName: string; originalSize: number };
  chapters: { order: number; title: string; number: number | null; byteLength: number }[];
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

export interface NewBook {
  title: string;
  author: string;
  original: File;
  text: Uint8Array;
  chapters: ChapterDraft[];
  options: ProcessOptions;
}

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
  too_large: "文件超过 100 MB，无法上传。",
  invalid_chapter_index: "章节索引没有通过服务端校验。",
  book_exists: "这本书已经存在。",
  invalid_title: "书名不能为空，且不能超过 200 字。",
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
