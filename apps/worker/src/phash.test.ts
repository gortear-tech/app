import { describe, expect, it } from "vitest";
import { hammingDistanceHex64 } from "@fbmaniaco/shared";
import { computeDHash64FromBuffer } from "./phash.js";

describe("computeDHash64FromBuffer", () => {
  it("produces repeatable 64-bit perceptual hashes", async () => {
    const sharp = (await import("sharp")).default;
    const image = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 220, g: 80, b: 40 }
      }
    })
      .jpeg()
      .toBuffer();

    const first = await computeDHash64FromBuffer(image);
    const second = await computeDHash64FromBuffer(image);

    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(second).toBe(first);
    expect(hammingDistanceHex64(first, second)).toBe(0);
  });
});
