const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("popup.html", "utf8");
const css = fs.readFileSync("popup.css", "utf8");
const js = fs.readFileSync("popup.js", "utf8");

test("popup is a wide internally scrolling Kelmar control panel", () => {
  assert.match(css, /body\s*\{[\s\S]*width:\s*500px/);
  assert.match(css, /max-height:\s*620px/);
  assert.match(css, /\.scroll-content\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(html, /icons\/kelmar-logo\.png/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
});

test("popup renders every filter and lifecycle section", () => {
  for (const heading of ["Vehicle", "Price and mileage", "Specification", "Condition and category", "Keywords", "Unknown-value handling", "Scan behaviour"]) assert.match(html, new RegExp(heading));
  for (const action of ["startScan", "pauseScan", "resumeScan", "stopScan"]) assert.match(html, new RegExp(`id="${action}"`));
  for (const counter of ["discovered", "queued", "inspecting", "matched", "rejected", "unresolved", "pendingUpload", "uploaded"]) assert.match(html, new RegExp(`id="${counter}"`));
});

test("popup implements dependent searchable make and model controls and local persistence", () => {
  assert.match(js, /VehicleCatalogue\.modelsForMakes/);
  assert.match(js, /isModelCompatible/);
  assert.match(js, /type="search"|makeSearch/);
  assert.match(js, /activeFilterConfig/);
  assert.match(js, /chrome\.storage\.local\.set/);
});

test("popup exposes explicit unknown policies, warnings and aggregate reasons", () => {
  for (const policy of ["inspect_then_reject", "include_with_warning", "exclude", "ignore_filter_for_unknown"]) assert.match(js, new RegExp(policy));
  assert.match(js, /Auto-scroll is off/);
  assert.match(js, /rejectionReasonCounts/);
  assert.match(html, /id="reasonCounts"/);
});
