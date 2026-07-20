const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const EXPECTED_FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "category-detector.js",
  "listing-category-pipeline.js",
  "mileage-utils.js",
  "scanner-lifecycle.js",
  "scanner-diagnostics.js",
  "scanner-runtime.js",
  "scanner-storage.js",
  "vehicle-identity.js",
  "listing-details-extractor.js",
  "payload-normalizer.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "styles.css",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png"
];

const FORBIDDEN_PATH = /(^|\/)(?:\.git|artifacts?|tests?|fixtures?|docs?|node_modules|scripts?|coverage)(?:\/|$)|\.(?:map|pem|key|env|log)$/i;
const REMOTE_CODE = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bimport\s*\(\s*["']https?:\/\//i,
  /\bimportScripts\s*\(\s*["']https?:\/\//i,
  /<script[^>]+src\s*=\s*["']https?:\/\//i,
  /\.src\s*=\s*["']https?:\/\//i
];
const CREDENTIAL = [
  /\b(?:postgres(?:ql)?|mysql):\/\/[^\s"']+:[^\s"']+@/i,
  /\b(?:password|api[_-]?token|access[_-]?token|secret)\s*[:=]\s*["'][^"']{16,}["']/i,
  /\bBearer\s+[A-Za-z0-9._~-]{24,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];

function auditText(file, text) {
  for (const pattern of REMOTE_CODE) assert.equal(pattern.test(text), false, `${file} contains a remote-code pattern: ${pattern}`);
  for (const pattern of CREDENTIAL) assert.equal(pattern.test(text), false, `${file} contains a credential-shaped literal: ${pattern}`);
}

function auditRuntimeFiles(root = process.cwd()) {
  for (const file of EXPECTED_FILES) {
    const absolute = path.join(root, file);
    assert.equal(fs.existsSync(absolute), true, `Missing runtime file: ${file}`);
    assert.equal(FORBIDDEN_PATH.test(file), false, `Forbidden runtime path: ${file}`);
    if (/\.(?:js|html|css|json)$/i.test(file)) auditText(file, fs.readFileSync(absolute, "utf8"));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, packageJson.version, "Manifest and package versions differ");
  assert.match(
    fs.readFileSync(path.join(root, "content.js"), "utf8"),
    new RegExp(`const EXTENSION_VERSION = ["']${manifest.version.replaceAll(".", "\\.")}["']`),
    "Content-script version differs from the manifest"
  );
  assert.equal(manifest.host_permissions.some((permission) => permission.includes("*://*/*") || permission === "https://*/*"), false);
  assert.deepEqual(Object.values(manifest.icons).sort(), EXPECTED_FILES.filter((file) => file.startsWith("icons/")).sort());
}

function listArchive(archive) {
  return execFileSync("tar", ["-tf", archive], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((file) => file.replace(/^\.\//, "").replace(/\\/g, "/"))
    .filter((file) => file && !file.endsWith("/"));
}

function readArchiveFile(archive, file) {
  return execFileSync("tar", ["-xOf", archive, file], { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 });
}

function auditArchive(archive) {
  auditRuntimeFiles();
  const files = listArchive(archive);
  assert.deepEqual([...files].sort(), [...EXPECTED_FILES].sort(), "Web Store archive contents differ from the runtime allow-list");
  for (const file of files) {
    assert.equal(FORBIDDEN_PATH.test(file), false, `Forbidden archive path: ${file}`);
    if (/\.(?:js|html|css|json)$/i.test(file)) auditText(file, readArchiveFile(archive, file).toString("utf8"));
  }
  const digest = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  return { files, digest, bytes: fs.statSync(archive).size };
}

if (require.main === module) {
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  const archive = process.argv[2] || path.join("artifacts", `kelmar-vehicle-scanner-web-store-v${manifest.version}.zip`);
  const result = auditArchive(archive);
  console.log(`Web Store package audit passed: ${result.files.length} runtime files, ${result.bytes} bytes`);
  console.log(`SHA-256: ${result.digest}`);
}

module.exports = { EXPECTED_FILES, FORBIDDEN_PATH, REMOTE_CODE, CREDENTIAL, auditText, auditRuntimeFiles, auditArchive };
