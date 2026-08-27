#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { open, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { PLUGIN_TOOL_ZH_CN as text } from "./i18n/plugin-tools.zh-CN.mjs";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_LABEL_PRESET_BYTES = 1024 * 1024;
const ALLOWED_ROOT_ENTRIES = new Set(["manifest.json", "labels.json", "plugin"]);
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9]+){1,}$/;
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const source = path.resolve(options.source);
  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo?.isDirectory()) {
    throw new Error(text.sourceMustBeDirectory(source));
  }

  const rootEntries = await readdir(source, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!ALLOWED_ROOT_ENTRIES.has(entry.name)) {
      throw new Error(text.unexpectedTopLevel(entry.name));
    }
    if (entry.isSymbolicLink()) {
      throw new Error(text.symlinkForbidden(entry.name));
    }
  }
  const manifestEntry = rootEntries.find((entry) => entry.name === "manifest.json");
  if (!manifestEntry?.isFile()) {
    throw new Error(text.manifestMissing);
  }
  const pluginEntry = rootEntries.find((entry) => entry.name === "plugin");
  if (pluginEntry && !pluginEntry.isDirectory()) {
    throw new Error(text.pluginMustBeDirectory);
  }
  const labelsEntry = rootEntries.find((entry) => entry.name === "labels.json");
  if (labelsEntry && !labelsEntry.isFile()) {
    throw new Error(text.labelsMustBeFile);
  }

  const budget = { total: 0 };
  const manifestBytes = await readBoundedFile(
    path.join(source, "manifest.json"),
    "manifest.json",
    budget,
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error(text.manifestInvalidJson(error.message), { cause: error });
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(text.manifestMustBeObject);
  }
  if (typeof manifest.id !== "string" || typeof manifest.version !== "string") {
    throw new Error(text.manifestNamesRequired);
  }
  if (!PLUGIN_ID_PATTERN.test(manifest.id)) {
    throw new Error(text.manifestIdInvalid);
  }
  if (!SEMVER_PATTERN.test(manifest.version)) {
    throw new Error(text.manifestVersionInvalid);
  }
  const isLabelPreset = manifest.extensionKind === "label-preset";
  if (isLabelPreset && !labelsEntry) {
    throw new Error(text.labelsMissing);
  }
  if (isLabelPreset && pluginEntry) {
    throw new Error(text.labelPresetPluginDirectoryForbidden);
  }
  if (!isLabelPreset && labelsEntry) {
    throw new Error(text.labelsOnlyForPreset);
  }

  const files = [{ archivePath: "manifest.json", bytes: manifestBytes }];
  if (labelsEntry) {
    files.push({
      archivePath: "labels.json",
      bytes: await readBoundedFile(
        path.join(source, "labels.json"),
        "labels.json",
        budget,
        MAX_LABEL_PRESET_BYTES,
      ),
    });
  }
  if (pluginEntry) {
    await collectFiles(source, path.join(source, "plugin"), files, budget);
  }
  files.sort((left, right) => left.archivePath.localeCompare(right.archivePath, "en"));

  const extension = normalizeExtension(options.extension ?? ".zip");
  const output = options.output
    ? path.resolve(options.output)
    : path.join(path.dirname(source), `${manifest.id}-${manifest.version}${extension}`);
  if (isInside(source, output)) {
    throw new Error(text.outputInsideSource);
  }
  if (!options.force) {
    const existing = await stat(output).catch(() => null);
    if (existing) {
      throw new Error(text.outputExists(output));
    }
  }

  const archive = createStoredZip(files);
  await writeFile(output, archive, { flag: options.force ? "w" : "wx" });
  process.stdout.write(`${output}\n`);
}

function parseArguments(args) {
  if (args.length === 0 || args.includes("--help")) {
    process.stdout.write(
      `${text.usage}\n`,
    );
    process.exit(args.includes("--help") ? 0 : 2);
  }
  const options = { source: args[0], output: null, extension: null, force: false };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--force") {
      options.force = true;
    } else if (argument === "--output" || argument === "--extension") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(text.optionValueRequired(argument));
      }
      options[argument === "--output" ? "output" : "extension"] = value;
      index += 1;
    } else {
      throw new Error(text.unknownArgument(argument));
    }
  }
  if (options.output && options.extension) {
    throw new Error(text.outputExtensionExclusive);
  }
  return options;
}

async function collectFiles(root, directory, files, budget) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(text.symlinkForbidden(path.relative(root, absolute)));
    }
    if (entry.isDirectory()) {
      await collectFiles(root, absolute, files, budget);
    } else if (entry.isFile()) {
      const archivePath = path.relative(root, absolute).split(path.sep).join("/");
      files.push({
        archivePath,
        bytes: await readBoundedFile(absolute, archivePath, budget),
      });
    } else {
      throw new Error(text.unsupportedEntry(path.relative(root, absolute)));
    }
  }
}

async function readBoundedFile(absolute, archivePath, budget, maxBytes = MAX_FILE_BYTES) {
  const file = await open(absolute, "r");
  try {
    const fileInfo = await file.stat();
    if (!fileInfo.isFile()) {
      throw new Error(text.unsupportedEntry(archivePath));
    }
    if (fileInfo.size > maxBytes) {
      throw new Error(
        maxBytes === MAX_LABEL_PRESET_BYTES
          ? text.labelPresetTooLarge
          : text.fileTooLarge(archivePath),
      );
    }
    if (budget.total + fileInfo.size > MAX_TOTAL_BYTES) {
      throw new Error(text.packageTooLarge);
    }
    budget.total += fileInfo.size;
    const bytes = Buffer.alloc(fileInfo.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) {
        throw new Error(text.fileChangedDuringRead(archivePath));
      }
      offset += bytesRead;
    }
    const probe = Buffer.alloc(1);
    const { bytesRead: extraBytes } = await file.read(probe, 0, 1, offset);
    if (extraBytes !== 0) {
      throw new Error(text.fileChangedDuringRead(archivePath));
    }
    return bytes;
  } finally {
    await file.close();
  }
}

function normalizeExtension(value) {
  const extension = value.startsWith(".") ? value : `.${value}`;
  if (!/^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(extension)) {
    throw new Error(text.invalidExtension(value));
  }
  return extension;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function createStoredZip(files) {
  if (files.length > 0xffff) {
    throw new Error(text.tooManyFiles);
  }
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.archivePath, "utf8");
    if (name.length > 0xffff) {
      throw new Error(text.archivePathTooLong(file.archivePath));
    }
    const crc = crc32(file.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.bytes.length, 18);
    local.writeUInt32LE(file.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, file.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.bytes.length, 20);
    central.writeUInt32LE(file.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + file.bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
