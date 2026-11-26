import { useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";

/** 可增删的短文本列表，例如标签与别名。回车或逗号添加，输入框为空时退格删除最后一个。 */
export function ChipInput({
  id,
  values,
  onChange,
  maxLength,
  removeLabel,
}: {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  maxLength: number;
  /** 移除按钮的无障碍名称前缀，例如「移除标签」。 */
  removeLabel: string;
}) {
  const [input, setInput] = useState("");
  function add() {
    const value = input.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setInput("");
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5">
      {values.map((value) => (
        <Badge key={value} variant="secondary" className="gap-1">
          {value}
          <button type="button" aria-label={`${removeLabel} ${value}`} onClick={() => onChange(values.filter((v) => v !== value))}>
            ×
          </button>
        </Badge>
      ))}
      <input
        id={id}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none"
        value={input}
        maxLength={maxLength}
        placeholder={values.length ? "" : "输入后按回车添加"}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
      />
    </div>
  );
}
