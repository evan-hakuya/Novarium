import { describe, expect, it } from "vitest";
import { volumeNames } from "./process";

describe("volumeNames", () => {
  it("counts runs of adjacent chapters, skipping chapters without a volume", () => {
    const v = (...names: (string | null)[]) => names.map((volume) => ({ volume }));
    expect(volumeNames(v(null, "风起", "风起", "云涌", null, "风起"))).toEqual(["风起", "云涌", "风起"]);
    expect(volumeNames(v(null, null))).toEqual([]);
  });
});
