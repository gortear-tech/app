const loadSharp = async () => (await import("sharp")).default;

export const computeDHash64FromBuffer = async (input: Buffer | Uint8Array) => {
  const sharp = await loadSharp();
  const pixels = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  let hash = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const left = pixels[row * 9 + col] ?? 0;
      const right = pixels[row * 9 + col + 1] ?? 0;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
};
