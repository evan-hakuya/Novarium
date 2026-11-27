import { describe, expect, it } from "vitest";
import { volumeChange, volumeNames } from "./process";

describe("volumeNames", () => {
  it("counts runs of adjacent chapters, skipping chapters without a volume", () => {
    const v = (...names: (string | null)[]) => names.map((volume) => ({ volume }));
    expect(volumeNames(v(null, "风起", "风起", "云涌", null, "风起"))).toEqual(["风起", "云涌", "风起"]);
    expect(volumeNames(v(null, null))).toEqual([]);
  });
});

describe("volumeChange", () => {
  it("shows both counts when either side has volumes and flags renamed volumes", () => {
    expect(volumeChange([], ["风起", "云涌"])).toEqual({ before: " · 0 卷", after: " · 2 卷", renamed: false });
    expect(volumeChange(["风起"], ["风起"])).toEqual({ before: " · 1 卷", after: " · 1 卷", renamed: false });
    expect(volumeChange(["风起"], ["云涌"])).toMatchObject({ renamed: true });
    expect(volumeChange([], [])).toEqual({ before: "", after: "", renamed: false });
  });
});
