export const sha256OfFile = async (file: File) => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const getImageDimensions = (file: File) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve({ width: 0, height: 0 });
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    image.src = url;
  });
