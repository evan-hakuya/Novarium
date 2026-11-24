// 对象存储中的键名。书 ID 与版本 ID 都是 UUID，由 isUuid 校验后才能用于拼接键名。
export const originalKey = (bookId: string) => `books/${bookId}/original`;
export const versionTextKey = (bookId: string, versionId: string) => `books/${bookId}/versions/${versionId}.txt`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (s: string) => UUID.test(s);
