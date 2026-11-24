import type { ProcessOptions } from "@novarium/core";
import { request } from "./books";

export const processOptionsQueryKey = ["settings", "process-options"] as const;

/** 默认整理选项，含全书库共用的过滤词表与过滤阈值。 */
export const fetchDefaultProcessOptions = () =>
  request<{ options: ProcessOptions }>("/api/admin/settings/process-options").then((r) => r.options);

export const saveDefaultProcessOptions = (options: ProcessOptions) =>
  request<{ options: ProcessOptions }>("/api/admin/settings/process-options", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ options }),
  }).then((r) => r.options);
