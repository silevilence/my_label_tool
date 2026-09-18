interface DecodedImage {
  naturalWidth: number;
  naturalHeight: number;
}
const MAX_IMAGES = 8;
const MAX_BYTES = 128 * 1024 * 1024;

export function getCachedImage<T>(cache: Map<string, T>, path: string): T | undefined {
  const image = cache.get(path);
  if (image !== undefined) {
    cache.delete(path);
    cache.set(path, image);
  }
  return image;
}

export function cacheDecodedImage<T extends DecodedImage>(
  cache: Map<string, T>,
  path: string,
  image: T,
): void {
  cache.delete(path);
  cache.set(path, image);
  let bytes = [...cache.values()].reduce(
    (total, item) => total + item.naturalWidth * item.naturalHeight * 4,
    0,
  );
  for (const [key, item] of cache) {
    if (cache.size <= MAX_IMAGES && bytes <= MAX_BYTES) break;
    cache.delete(key);
    bytes -= item.naturalWidth * item.naturalHeight * 4;
  }
}
