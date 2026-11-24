export interface ByteRange {
  offset: number;
  length: number;
}

// 书文件的存储接口。业务代码只依赖这个接口，不直接调用 R2 或文件系统。
export interface StorageProvider {
  put(key: string, data: Uint8Array | ReadableStream<Uint8Array>): Promise<void>;
  get(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
