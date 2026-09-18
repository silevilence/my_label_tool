import { expect, it } from "vitest";
import { cacheDecodedImage, getCachedImage } from "./image-cache";
const small = { naturalWidth: 10, naturalHeight: 10 };
it("evicts least recently used frames and refreshes accesses", () => {
  const cache = new Map<string, typeof small>();
  for (let i = 0; i < 8; i++) cacheDecodedImage(cache, String(i), small);
  expect(getCachedImage(cache, "0")).toBe(small);
  cacheDecodedImage(cache, "8", small);
  expect(cache.size).toBe(8);
  expect(getCachedImage(cache, "1")).toBeUndefined();
  expect(cache.has("0")).toBe(true);
  cacheDecodedImage(cache, "0", small);
  expect(cache.size).toBe(8);
});
it("bounds decoded bytes including individual oversized images", () => {
  const cache = new Map<string, typeof small>();
  cacheDecodedImage(cache, "large", { naturalWidth: 6000, naturalHeight: 4000 });
  cacheDecodedImage(cache, "next", { naturalWidth: 6000, naturalHeight: 4000 });
  expect([...cache.keys()]).toEqual(["next"]);
  cacheDecodedImage(cache, "oversize", { naturalWidth: 10000, naturalHeight: 10000 });
  expect(cache.size).toBe(0);
});
