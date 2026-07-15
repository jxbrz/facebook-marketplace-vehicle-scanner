const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  EXPECTED_FILES,
  FORBIDDEN_PATH,
  auditRuntimeFiles,
  auditText
} = require("../scripts/audit-web-store-package.js");

test("Web Store runtime allow-list contains every required manifest file and no forbidden paths", () => {
  auditRuntimeFiles();
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  const required = [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap((script) => [...script.js, ...(script.css || [])]), ...Object.values(manifest.icons)];
  for (const file of required) assert.equal(EXPECTED_FILES.includes(file), true, `Missing from package allow-list: ${file}`);
  for (const file of EXPECTED_FILES) assert.equal(FORBIDDEN_PATH.test(file), false, file);
});

test("Web Store sources contain no remote executable code or credential-shaped literals", () => {
  for (const file of EXPECTED_FILES.filter((name) => /\.(?:js|html|css|json)$/.test(name))) {
    assert.doesNotThrow(() => auditText(file, fs.readFileSync(file, "utf8")));
  }
});

test("package audit rejects forbidden files, remote code and embedded credentials", () => {
  assert.equal(FORBIDDEN_PATH.test("tests/fixture.json"), true);
  assert.throws(() => auditText("bad.js", "eval('remote')"));
  assert.throws(() => auditText("bad.js", "const password = 'this-is-a-real-long-password';"));
});
