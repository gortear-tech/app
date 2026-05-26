import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToHex, sha256HexFromBytes } from "./hashCore";

describe("gallery hash helpers", () => {
  it("decodes base64 and produces byte-accurate sha256 hex", async () => {
    const bytes = base64ToBytes("aGVsbG8=");
    const digest = await sha256HexFromBytes(bytes, async (payload) => {
      const hash = createHash("sha256").update(payload).digest();
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    });

    expect(bytesToHex(bytes)).toBe("68656c6c6f");
    expect(digest).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
