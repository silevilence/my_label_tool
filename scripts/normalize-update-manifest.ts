// Run after tauri-action and before publishing the release:
// node scripts/normalize-update-manifest.ts <latest.json> <release.json>
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected a JSON object",
  );
  return value as Record<string, unknown>;
}

/** Resolve release assets to their published URLs, preserving signatures and metadata. */
export function normalizeUpdateManifest(input: unknown, releaseInput: unknown) {
  const manifest = object(input);
  const release = object(releaseInput);
  assert.equal(typeof manifest.version, "string", "Missing update version");
  assert.equal(typeof release.tag_name, "string", "Missing release tag");
  assert.equal(
    (release.tag_name as string).replace(/^v/i, ""),
    manifest.version,
    "Release tag does not match the update version",
  );
  assert.ok(Array.isArray(release.assets), "Missing release assets");
  const assets = release.assets.map(object);

  function publishedUrl(asset: Record<string, unknown>) {
    assert.equal(typeof asset.browser_download_url, "string", "Missing browser download URL");
    const url = new URL(asset.browser_download_url as string);
    assert.ok(
      url.origin === "https://github.com" &&
        !url.username &&
        !url.password &&
        /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/.+/.test(url.pathname),
      "Installer must use a standard GitHub release download URL",
    );
    // Draft assets use an untagged-* placeholder until publication. Preserve the
    // repository and encoded filename, but select the release's actual tag.
    const parts = url.pathname.split("/");
    parts[5] = encodeURIComponent(release.tag_name as string);
    url.pathname = parts.join("/");
    return url.href;
  }

  function normalize(entry: unknown) {
    const platform = object(entry);
    assert.ok(typeof platform.url === "string", "Missing installer URL");
    assert.ok(
      typeof platform.signature === "string" && platform.signature.trim(),
      "Missing installer signature",
    );
    const asset = assets.find(
      (candidate) =>
        candidate.url === platform.url ||
        candidate.browser_download_url === platform.url ||
        publishedUrl(candidate) === platform.url,
    );
    assert.ok(asset, `Installer is absent from this release: ${platform.url}`);
    return { ...platform, url: publishedUrl(asset) };
  }

  const result = { ...manifest };
  let count = 0;
  if ("url" in manifest) {
    Object.assign(result, normalize(manifest));
    count++;
  }
  if ("platforms" in manifest) {
    result.platforms = Object.fromEntries(
      Object.entries(object(manifest.platforms)).map(([target, platform]) => {
        count++;
        return [target, normalize(platform)];
      }),
    );
  }
  assert.ok(count > 0, "Update manifest contains no installers");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , manifestPath, releasePath] = process.argv;
  assert.ok(
    manifestPath && releasePath,
    "Usage: node scripts/normalize-update-manifest.ts <latest.json> <release.json>",
  );
  const readJson = (path: string): unknown =>
    JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  const normalized = normalizeUpdateManifest(readJson(manifestPath), readJson(releasePath));
  // Validate every target before writing; failures leave the original file intact.
  writeFileSync(manifestPath, `${JSON.stringify(normalized, null, 2)}\n`);
}
