const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("popup.html", "utf8");
const css = fs.readFileSync("popup.css", "utf8");
const js = fs.readFileSync("popup.js", "utf8");
const settingsHtml = fs.readFileSync("settings.html", "utf8");
const settingsCss = fs.readFileSync("settings.css", "utf8");
const settingsJs = fs.readFileSync("settings.js", "utf8");
const storageJs = fs.readFileSync("settings-storage.js", "utf8");

test("popup is a compact Kelmar scan cockpit without a nested editor scroller", () => {
  assert.match(css, /width:420px/);
  assert.doesNotMatch(css, /\.scroll-content/);
  assert.match(html, /icons\/kelmar-logo\.png/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
});

test("popup renders filter source, summary and lifecycle controls", () => {
  assert.match(html, /id="filterSummary"/);
  assert.match(html, /id="openSettings"/);
  for (const action of ["startScan", "pauseScan", "resumeScan", "stopScan"]) assert.match(html, new RegExp(`id="${action}"`));
  for (const counter of ["discovered", "queued", "inspecting", "matched", "rejected", "unresolved", "pendingUpload", "uploaded"]) assert.match(html, new RegExp(`id="${counter}"`));
});

test("full settings page implements dependent controls and three-state specification choices", () => {
  assert.match(settingsHtml, /id="makeSearch"/);
  assert.match(settingsJs, /VehicleCatalogue\.modelsForMakes/);
  assert.match(settingsJs, /\["ignore", "include", "exclude"\]/);
  assert.match(settingsJs, /setSelectionState/);
  assert.doesNotMatch(settingsCss, /overflow:\s*auto/);
});

test("shared storage keeps dashboard searches read-only and local drafts separate", () => {
  assert.match(storageJs, /localFilterDraft/);
  assert.match(storageJs, /activateDashboardSearch/);
  assert.match(settingsJs, /filterEditor\.disabled/);
  assert.match(settingsJs, /Dashboard saved searches are read-only here/);
});

test("Core and Advanced settings preserve activation semantics", () => {
  assert.match(settingsHtml, /Advanced filters/);
  assert.match(settingsHtml, /advancedFiltersEnabled/);
  assert.match(settingsHtml, /Include adverts when optional information is unavailable/);
  assert.match(settingsHtml, /Excluded keywords/);
  assert.match(settingsJs, /advancedFields\.disabled = !currentConfig\.advancedFiltersEnabled/);
  assert.match(settingsJs, /advancedFiltersEnabled: elements\.advancedFiltersEnabled\.checked/);
});

test("source selection updates in-memory state and resumed snapshots are disclosed", () => {
  assert.match(js, /storedSettings\.activeSavedSearchId = search\.id/);
  assert.match(js, /storedSettings\.activeSavedSearchId = null/);
  assert.match(settingsJs, /storedSettings\.activeSavedSearchId = search\.id/);
  assert.match(settingsJs, /storedSettings\.activeSavedSearchId = null/);
  assert.match(js, /usingPersistedSettingsSnapshot/);
  assert.match(js, /original filter snapshot/);
});

test("popup exposes warnings and aggregate reasons", () => {
  assert.match(js, /Auto-load is off/);
  assert.match(js, /rejectionReasonCounts/);
  assert.match(html, /id="reasonCounts"/);
});

test("release popup excludes temporary acceptance controls", () => {
  assert.doesNotMatch(html, /runNormalModeTest|copyNormalModeReport|Temporary 23\.2\.3 acceptance/);
  assert.doesNotMatch(js, /normalModeTestConfig|copyTextWithoutPermission/);
});
