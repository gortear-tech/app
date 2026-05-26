export const base64ToBytes = (value: string): Uint8Array => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/\s+/g, "").replace(/=+$/g, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    const next = alphabet.indexOf(char);
    if (next < 0) continue;
    buffer = (buffer << 6) | next;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
};

export const bytesToHex = (bytes: Uint8Array | ArrayBuffer) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const sha256HexFromBytes = async (
  bytes: Uint8Array,
  digest: (bytes: Uint8Array) => Promise<ArrayBuffer>
) => bytesToHex(await digest(bytes));
