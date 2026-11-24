import { useRef, useState } from "react";
import type { ProcessOptions } from "@novarium/core";
import { describeError, MAX_UPLOAD_BYTES } from "@/api/books";
import { processInWorker, type ProcessedVersion } from "@/lib/process";

/** 一次整理的结果，连同生成它的整理选项。保存时版本记录这份选项。 */
export interface Preview {
  version: ProcessedVersion;
  options: ProcessOptions;
}

/**
 * 预览整理结果。options 是正在编辑的整理选项；改动后重新整理，结果到达前继续显示上一次的预览。
 * 只采用最近一次整理的结果。
 */
export function useProcessPreview() {
  const [options, setOptions] = useState<ProcessOptions | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  async function run(bytes: ArrayBuffer, opts: ProcessOptions) {
    const id = ++runId.current;
    setOptions(opts);
    setProcessing(true);
    setError(null);
    try {
      // Worker 会接管传入的缓冲区，所以每次传一份副本。
      const version = await processInWorker(bytes.slice(0), opts);
      if (id !== runId.current) return;
      if (version.text.byteLength > MAX_UPLOAD_BYTES) {
        setError("整理后的正文超过 100 MB 上限。");
        setPreview(null);
        return;
      }
      setPreview({ version, options: opts });
    } catch (e) {
      if (id === runId.current) setError(`整理失败：${describeError(e)}`);
    } finally {
      if (id === runId.current) setProcessing(false);
    }
  }

  function reset() {
    runId.current++;
    setOptions(null);
    setPreview(null);
    setProcessing(false);
    setError(null);
  }

  /** 只改整理选项中的记录（如忽略的异常），不影响整理结果，因此不重新整理。 */
  function patchOptions(next: ProcessOptions) {
    setOptions(next);
    setPreview((p) => (p ? { ...p, options: next } : p));
  }

  return { options, preview, processing, error, setError, run, reset, patchOptions };
}
