import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system";
import { base64ToBytes, sha256HexFromBytes } from "./hashCore";

export const sha256OfFile = async (uri: string) => {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
  const bytes = base64ToBytes(base64);
  return sha256HexFromBytes(bytes, (payload) => {
    const copy = new Uint8Array(payload.byteLength);
    copy.set(payload);
    return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, copy.buffer);
  });
};
