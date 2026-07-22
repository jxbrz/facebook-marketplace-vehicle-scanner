const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const content = fs.readFileSync("content.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionSource(name, nextName) {
  const start = content.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} was not found`);
  const end = nextName ? content.indexOf(`function ${nextName}`, start + 1) : content.length;
  return content.slice(start, end >= 0 ? end : content.length);
}

test("panel preference is strict, persisted, and separate from scanner cleanup", () => {
  assert.match(content, /panelMinimisedStorageKey: "scannerPanelMinimised"/);
  assert.match(content, /scannerPanelMinimised: stored\.scannerPanelMinimised === true/);
  const setter = functionSource("setPanelMinimised", "ensurePanel");
  assert.match(setter, /chrome\.storage\.local\.set/);
  assert.doesNotMatch(setter, /finaliseScan|stopScan|pauseScan|clearLocalScannerState|activeFilterConfig|pendingUploads/);
  const cleanup = functionSource("clearLocalScannerState", "loadSettings");
  assert.doesNotMatch(cleanup, /scannerPanelMinimised/);
});

test("overlay exposes accessible minimise and restore controls", () => {
  assert.match(content, /aria-label", "Minimise scanner panel"/);
  assert.match(content, /aria-label", "Restore scanner panel"/);
  assert.match(content, /mcf-panel-minimise/);
  assert.match(content, /mcf-panel-restore/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /#e66941/);
});

test("minimised pill receives live state and match-count updates", () => {
  const render = functionSource("renderPanel", "isExtensionMutation");
  assert.match(render, /panel\.compactText\.textContent/);
  assert.match(render, /progress\.matched/);
  for (const state of ["Error", "Paused", "Scanning", "Interrupted", "Complete", "Idle"]) {
    assert.ok(render.includes(`"${state}"`), `${state} compact state missing`);
  }
  assert.match(styles, /white-space: nowrap/);
  assert.match(styles, /text-overflow: ellipsis/);
  assert.doesNotMatch(styles, /overflow-x:\s*(?:auto|scroll)/);
});
