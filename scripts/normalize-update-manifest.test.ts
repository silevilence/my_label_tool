// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeUpdateManifest } from "./normalize-update-manifest";

const api = "https://api.github.com/repos/owner/app/releases/assets/668271883";
const browser = "https://github.com/owner/app/releases/download/V99.0.0/app%20setup.exe";
const release = {
  tag_name: "V99.0.0",
  assets: [
    { url: api, browser_download_url: browser },
    { url: `${api}0`, browser_download_url: browser.replace(".exe", ".msi") },
  ],
};
const manifest = {
  version: "99.0.0",
  notes: "### 更新说明",
  pub_date: "2026-10-23T00:00:00Z",
  platforms: {
    "windows-x86_64": { url: api, signature: "signed msi\n" },
    "windows-x86_64-nsis": { url: api, signature: "signed exe\n", extra: true },
    "windows-x86_64-msi": { url: `${api}0`, signature: "signed msi\n" },
  },
};

describe("release updater manifest", () => {
  it("maps all installer targets to exact browser URLs and preserves metadata and signatures", () => {
    const result = normalizeUpdateManifest(manifest, release);
    expect(result).toEqual({
      ...manifest,
      platforms: {
        "windows-x86_64": { ...manifest.platforms["windows-x86_64"], url: browser },
        "windows-x86_64-nsis": { ...manifest.platforms["windows-x86_64-nsis"], url: browser },
        "windows-x86_64-msi": {
          ...manifest.platforms["windows-x86_64-msi"],
          url: browser.replace(".exe", ".msi"),
        },
      },
    });
    expect(manifest.platforms["windows-x86_64"].url).toBe(api);
    expect(normalizeUpdateManifest(result, release)).toEqual(result);
  });

  it("supports a single-target manifest", () => {
    expect(
      normalizeUpdateManifest({ version: "99.0.0", url: api, signature: "sig" }, release),
    ).toEqual({ version: "99.0.0", url: browser, signature: "sig" });
  });

  it("uses the release tag instead of draft-only untagged download paths", () => {
    const draftRelease = {
      ...release,
      draft: true,
      assets: release.assets.map((asset) => ({
        ...asset,
        browser_download_url: asset.browser_download_url.replace("V99.0.0", "untagged-draft-id"),
      })),
    };
    const result = normalizeUpdateManifest(manifest, draftRelease);
    expect(result).toEqual(normalizeUpdateManifest(manifest, release));
    expect(normalizeUpdateManifest(result, draftRelease)).toEqual(result);
    expect(
      normalizeUpdateManifest(
        { version: "99.0.0", url: draftRelease.assets[0].browser_download_url, signature: "sig" },
        draftRelease,
      ),
    ).toEqual({ version: "99.0.0", url: browser, signature: "sig" });
  });

  it("rejects stale assets, wrong release versions, empty manifests and missing signatures", () => {
    expect(() => normalizeUpdateManifest(manifest, { ...release, assets: [] })).toThrow(/absent/);
    expect(() => normalizeUpdateManifest(manifest, { ...release, tag_name: "V98.0.0" })).toThrow(
      /version/,
    );
    expect(() => normalizeUpdateManifest({ version: "99.0.0", platforms: {} }, release)).toThrow(
      /no installers/,
    );
    expect(() => normalizeUpdateManifest({ version: "99.0.0", url: api }, release)).toThrow(
      /signature/,
    );
    expect(() =>
      normalizeUpdateManifest(manifest, {
        ...release,
        assets: [{ url: api, browser_download_url: api }],
      }),
    ).toThrow(/standard GitHub/);
  });

  it("runs the release CLI and leaves the manifest unchanged when validation fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "update-manifest-"));
    try {
      const manifestPath = join(dir, "latest.json");
      const releasePath = join(dir, "release.json");
      writeFileSync(manifestPath, JSON.stringify(manifest));
      writeFileSync(releasePath, JSON.stringify(release));
      const args = [resolve("scripts/normalize-update-manifest.ts"), manifestPath, releasePath];
      execFileSync(process.execPath, args, { stdio: "pipe" });
      const normalized = readFileSync(manifestPath, "utf8");
      expect(JSON.parse(normalized)).toEqual(normalizeUpdateManifest(manifest, release));
      writeFileSync(releasePath, JSON.stringify({ ...release, assets: [] }));
      expect(() => execFileSync(process.execPath, args, { stdio: "pipe" })).toThrow();
      expect(readFileSync(manifestPath, "utf8")).toBe(normalized);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
