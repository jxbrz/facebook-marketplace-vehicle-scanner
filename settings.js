"use strict";

const elements = Object.fromEntries([
  "connectionStatus", "version", "openDashboard", "returnMarketplace", "closeSettings", "refreshSearches", "savedSearch", "sourceHelp",
  "useLocalDraft", "copyToLocal", "filterSummary", "filterEditor", "makeSearch", "makeOptions", "modelSearch",
  "modelOptions", "modelHelp", "minYear", "maxYear", "minPrice", "maxPrice", "minMileage", "maxMileage",
  "specificationGroups", "categoryModes", "categoryStatuses", "includeRepairedVehicles", "requiredKeywords",
  "excludedKeywords", "unknownPolicies", "targetMatches", "maximumProcessed", "maximumDurationMinutes",
  "autoLoadEnabled", "autoOpenResults", "dashboardUrl", "extensionApiToken", "extensionOrigin", "feedback",
  "resetChanges", "saveSettings"
].map(id => [id, document.querySelector(`#${id}`)]));

const UNKNOWN_FIELDS = [
  ["price", "Price"], ["mileage", "Mileage"], ["year", "Year"], ["makeModel", "Make and model"],
  ["categoryStatus", "Category status"], ["transmission", "Transmission"], ["fuelType", "Fuel type"],
  ["colour", "Colour"], ["bodyType", "Body type"]
];
const POLICY_LABELS = {
  inspect_then_reject: "Inspect, then reject",
  include_with_warning: "Include with warning",
  exclude: "Exclude if unknown",
  ignore_filter_for_unknown: "Ignore filter if unknown"
};
const SPEC_GROUPS = [
  ["transmissions", "Transmission"], ["fuelTypes", "Fuel type"], ["colours", "Colour"], ["bodyTypes", "Body type"]
];

let storedSettings = null;
let savedSearches = [];
let currentConfig = FilterDomain.normaliseFilterConfig({ excludedCategories: ["S", "N", "C", "D"] });
let localDraft = currentConfig;
let cleanFingerprint = FilterDomain.filterFingerprint(currentConfig);

function setFeedback(message, kind = "") {
  elements.feedback.textContent = message;
  elements.feedback.className = kind;
}

function setConnection(message, state = "") {
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.className = `status-line ${state}`.trim();
}

function valueOrNull(input) {
  if (!input.value.trim()) return null;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

function lines(input) {
  return input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
}

function selectedMakes() {
  return [...elements.makeOptions.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
}

function selectedModels() {
  return [...elements.modelOptions.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
}

function checkbox(value, checked, type, text = value) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = value;
  input.checked = checked;
  input.dataset.choiceType = type;
  const span = document.createElement("span");
  span.textContent = text;
  label.append(input, span);
  return label;
}

function filterChoiceGrid(container, query) {
  const needle = VehicleCatalogue.key(query);
  for (const label of container.querySelectorAll("label")) {
    label.classList.toggle("hidden", Boolean(needle && !VehicleCatalogue.key(label.textContent).includes(needle)));
  }
}

function renderMakes(values = []) {
  const selected = new Set(VehicleCatalogue.normaliseMakes(values));
  elements.makeOptions.replaceChildren(...VehicleCatalogue.CATALOGUE.map(item => checkbox(item.make, selected.has(item.make), "make")));
  filterChoiceGrid(elements.makeOptions, elements.makeSearch.value);
}

function renderModels(values = []) {
  const makes = selectedMakes();
  const compatible = VehicleCatalogue.modelsForMakes(makes);
  const selected = new Set(VehicleCatalogue.normaliseModels(values, makes));
  elements.modelSearch.disabled = compatible.length === 0 || elements.filterEditor.disabled;
  if (!compatible.length) {
    const empty = document.createElement("p");
    empty.className = "helper";
    empty.textContent = "Any model";
    elements.modelOptions.replaceChildren(empty);
    elements.modelHelp.textContent = "Choose one or more makes to select specific models.";
    return;
  }
  elements.modelOptions.replaceChildren(...compatible.map(item => checkbox(item.model, selected.has(item.model), "model", `${item.make} · ${item.model}`)));
  elements.modelHelp.textContent = selected.size ? `${selected.size} model${selected.size === 1 ? "" : "s"} selected.` : "No selection means any model.";
  filterChoiceGrid(elements.modelOptions, elements.modelSearch.value);
}

function renderSpecificationGroups(config) {
  elements.specificationGroups.replaceChildren(...SPEC_GROUPS.map(([key, labelText]) => {
    const selection = config.specification[key];
    const details = document.createElement("details");
    details.className = "spec-group";
    details.open = true;
    details.dataset.specificationKey = key;
    const summary = document.createElement("summary");
    summary.append(document.createTextNode(labelText));
    const summaryText = document.createElement("span");
    summaryText.textContent = FilterDomain.selectionSummary(selection);
    summary.append(summaryText);
    const table = document.createElement("div");
    table.className = "state-table";
    const head = document.createElement("div");
    head.className = "state-head";
    for (const title of ["Value", "Ignore", "Include", "Exclude"]) {
      const span = document.createElement("span");
      span.textContent = title;
      head.append(span);
    }
    table.append(head);
    for (const value of FilterDomain.SPECIFICATION_OPTIONS[key]) {
      const row = document.createElement("div");
      row.className = "state-row";
      const valueLabel = document.createElement("span");
      valueLabel.textContent = FilterDomain.optionLabel(value);
      row.append(valueLabel);
      for (const state of ["ignore", "include", "exclude"]) {
        const stateLabel = document.createElement("label");
        stateLabel.className = "state-cell";
        stateLabel.setAttribute("aria-label", `${labelText} ${value}: ${state}`);
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `spec-${key}-${value}`;
        input.value = state;
        input.dataset.specificationKey = key;
        input.dataset.specificationValue = value;
        input.checked = FilterDomain.selectionState(selection, value) === state;
        stateLabel.append(input);
        row.append(stateLabel);
      }
      table.append(row);
    }
    details.append(summary, table);
    return details;
  }));
}

function renderSummary(config) {
  elements.filterSummary.replaceChildren(...FilterDomain.filterSummary(config).map(item => {
    const box = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = item.label;
    const value = document.createElement("span");
    value.textContent = item.value;
    box.append(label, value);
    return box;
  }));
}

function initialiseStaticControls() {
  for (const mode of FilterDomain.CATEGORY_MODES) elements.categoryModes.append(checkbox(mode, false, "category-mode", FilterDomain.optionLabel(mode.replaceAll("_", " "))));
  for (const input of elements.categoryModes.querySelectorAll("input")) { input.type = "radio"; input.name = "categoryMode"; }
  for (const status of FilterDomain.CATEGORY_STATUSES) elements.categoryStatuses.append(checkbox(status, false, "category-status", status.startsWith("cat_") ? `Cat ${status.slice(-1).toUpperCase()}` : FilterDomain.optionLabel(status)));
  for (const [field, labelText] of UNKNOWN_FIELDS) {
    const label = document.createElement("label");
    label.textContent = labelText;
    const select = document.createElement("select");
    select.dataset.unknownField = field;
    for (const policy of FilterDomain.UNKNOWN_POLICIES) {
      const option = document.createElement("option");
      option.value = policy;
      option.textContent = POLICY_LABELS[policy];
      select.append(option);
    }
    label.append(select);
    elements.unknownPolicies.append(label);
  }
}

function applyConfig(value) {
  currentConfig = FilterDomain.normaliseFilterConfig(value);
  renderMakes(currentConfig.vehicle.makes);
  renderModels(currentConfig.vehicle.models);
  for (const key of ["minYear", "maxYear"]) elements[key].value = currentConfig.vehicle[key] ?? "";
  for (const key of ["minPrice", "maxPrice", "minMileage", "maxMileage"]) elements[key].value = currentConfig.priceMileage[key] ?? "";
  renderSpecificationGroups(currentConfig);
  const categoryMode = elements.categoryModes.querySelector(`input[value="${currentConfig.category.mode}"]`);
  if (categoryMode) categoryMode.checked = true;
  for (const input of elements.categoryStatuses.querySelectorAll("input")) input.checked = currentConfig.category.statuses.includes(input.value);
  elements.includeRepairedVehicles.checked = currentConfig.category.includeRepairedVehicles;
  elements.requiredKeywords.value = currentConfig.text.requiredKeywords.join("\n");
  elements.excludedKeywords.value = currentConfig.text.excludedKeywords.join("\n");
  for (const select of elements.unknownPolicies.querySelectorAll("select")) select.value = currentConfig.unknownPolicies[select.dataset.unknownField];
  elements.targetMatches.value = currentConfig.scan.targetMatches;
  elements.maximumProcessed.value = currentConfig.scan.maximumProcessed;
  elements.maximumDurationMinutes.value = currentConfig.scan.maximumDurationSeconds / 60;
  elements.autoLoadEnabled.checked = currentConfig.scan.autoLoadEnabled;
  elements.autoOpenResults.checked = currentConfig.scan.autoOpenResults;
  renderSummary(currentConfig);
  cleanFingerprint = FilterDomain.filterFingerprint(currentConfig);
  setFeedback(elements.filterEditor.disabled ? "Dashboard saved searches are read-only here." : "No unsaved changes.");
}

function configFromForm() {
  const specification = {};
  for (const [key] of SPEC_GROUPS) {
    let selection = { mode: "any", include: [], exclude: [] };
    for (const input of elements.specificationGroups.querySelectorAll(`input[data-specification-key="${key}"]:checked`)) {
      selection = FilterDomain.setSelectionState(selection, input.dataset.specificationValue, input.value);
    }
    specification[key] = selection;
  }
  const unknownPolicies = {};
  for (const select of elements.unknownPolicies.querySelectorAll("select")) unknownPolicies[select.dataset.unknownField] = select.value;
  return FilterDomain.normaliseFilterConfig({
    filterSchemaVersion: 2,
    vehicle: { makes: selectedMakes(), models: selectedModels(), minYear: valueOrNull(elements.minYear), maxYear: valueOrNull(elements.maxYear) },
    priceMileage: { minPrice: valueOrNull(elements.minPrice), maxPrice: valueOrNull(elements.maxPrice), minMileage: valueOrNull(elements.minMileage), maxMileage: valueOrNull(elements.maxMileage) },
    specification,
    category: {
      mode: elements.categoryModes.querySelector('input:checked')?.value || "any",
      statuses: [...elements.categoryStatuses.querySelectorAll('input:checked')].map(input => input.value),
      includeRepairedVehicles: elements.includeRepairedVehicles.checked
    },
    text: { requiredKeywords: lines(elements.requiredKeywords), excludedKeywords: lines(elements.excludedKeywords) },
    unknownPolicies,
    scan: {
      targetMatches: valueOrNull(elements.targetMatches), maximumProcessed: valueOrNull(elements.maximumProcessed),
      maximumDurationSeconds: Math.round((valueOrNull(elements.maximumDurationMinutes) || 5) * 60),
      autoLoadEnabled: elements.autoLoadEnabled.checked, autoOpenResults: elements.autoOpenResults.checked
    }
  });
}

function markDirty() {
  if (elements.filterEditor.disabled) return;
  currentConfig = configFromForm();
  renderSummary(currentConfig);
  const dirty = FilterDomain.filterFingerprint(currentConfig) !== cleanFingerprint;
  setFeedback(dirty ? "Unsaved local changes. They do not alter a dashboard saved search." : "No unsaved changes.");
}

function setEditorReadOnly(readOnly) {
  elements.filterEditor.disabled = readOnly;
  elements.useLocalDraft.hidden = !readOnly;
  elements.copyToLocal.hidden = !readOnly;
  elements.saveSettings.textContent = readOnly ? "Save connection" : "Save local settings";
  renderModels(currentConfig.vehicle.models);
}

function populateSavedSearches(selectedId = "") {
  const localOption = elements.savedSearch.options[0];
  elements.savedSearch.replaceChildren(localOption, ...savedSearches.map(search => {
    const option = document.createElement("option");
    option.value = search.id;
    option.textContent = search.name;
    return option;
  }));
  elements.savedSearch.value = savedSearches.some(search => search.id === selectedId) ? selectedId : "";
}

async function chooseSource(id, copyRemote = false) {
  const search = savedSearches.find(item => item.id === id);
  if (search && !copyRemote) {
    setEditorReadOnly(true);
    applyConfig(search.filterConfig || search.filters);
    await ScannerSettings.activateDashboardSearch(search);
    elements.sourceHelp.textContent = `“${search.name}” is managed in the dashboard and is read-only here.`;
    return;
  }
  if (search && copyRemote) localDraft = FilterDomain.normaliseFilterConfig(search.filterConfig || search.filters);
  elements.savedSearch.value = "";
  setEditorReadOnly(false);
  applyConfig(localDraft);
  localDraft = await ScannerSettings.saveLocalDraft(currentConfig);
  elements.sourceHelp.textContent = copyRemote ? `Copied “${search.name}” into a separate local draft.` : "Local filters apply to the next scan only and never modify dashboard searches.";
}

async function refreshSavedSearches(silent = false) {
  elements.refreshSearches.disabled = true;
  setConnection("Checking dashboard…");
  try {
    savedSearches = await ScannerSettings.fetchSavedSearches();
    const selectedId = elements.savedSearch.value || storedSettings.activeSavedSearchId || "";
    populateSavedSearches(selectedId);
    setConnection("Dashboard connected", "connected");
    if (elements.savedSearch.value) await chooseSource(elements.savedSearch.value);
  } catch (error) {
    setConnection("Dashboard unavailable", "error");
    if (!silent) setFeedback(error.message || String(error), "error");
  } finally {
    elements.refreshSearches.disabled = false;
  }
}

async function initialise() {
  initialiseStaticControls();
  elements.version.textContent = `v${chrome.runtime.getManifest().version}`;
  elements.extensionOrigin.textContent = `chrome-extension://${chrome.runtime.id}`;
  storedSettings = await ScannerSettings.load();
  localDraft = storedSettings.localFilterDraft;
  elements.dashboardUrl.value = storedSettings.dashboardUrl;
  elements.extensionApiToken.value = storedSettings.extensionApiToken || "";
  populateSavedSearches(storedSettings.activeSavedSearchId || "");
  setEditorReadOnly(Boolean(storedSettings.activeSavedSearchId));
  applyConfig(storedSettings.activeSavedSearchId ? storedSettings.activeFilterConfig : localDraft);
  await refreshSavedSearches(true);
}

elements.makeSearch.addEventListener("input", () => filterChoiceGrid(elements.makeOptions, elements.makeSearch.value));
elements.modelSearch.addEventListener("input", () => filterChoiceGrid(elements.modelOptions, elements.modelSearch.value));
elements.makeOptions.addEventListener("change", event => {
  if (event.target.dataset.choiceType !== "make") return;
  const retained = selectedModels().filter(model => VehicleCatalogue.isModelCompatible(model, selectedMakes()));
  renderModels(retained);
  markDirty();
});
elements.filterEditor.addEventListener("change", event => { if (event.target.dataset.choiceType !== "make") markDirty(); });
elements.filterEditor.addEventListener("input", event => { if (!["checkbox", "radio"].includes(event.target.type)) markDirty(); });
elements.savedSearch.addEventListener("change", () => chooseSource(elements.savedSearch.value).catch(error => setFeedback(error.message || String(error), "error")));
elements.refreshSearches.addEventListener("click", () => refreshSavedSearches());
elements.useLocalDraft.addEventListener("click", () => chooseSource("").catch(error => setFeedback(error.message || String(error), "error")));
elements.copyToLocal.addEventListener("click", () => chooseSource(elements.savedSearch.value, true).catch(error => setFeedback(error.message || String(error), "error")));
elements.resetChanges.addEventListener("click", () => {
  const search = savedSearches.find(item => item.id === elements.savedSearch.value);
  applyConfig(search ? search.filterConfig || search.filters : localDraft);
});
elements.saveSettings.addEventListener("click", async () => {
  elements.saveSettings.disabled = true;
  try {
    await ScannerSettings.saveConnection(elements.dashboardUrl.value, elements.extensionApiToken.value);
    if (!elements.filterEditor.disabled) {
      localDraft = await ScannerSettings.saveLocalDraft(configFromForm());
      applyConfig(localDraft);
    }
    setConnection("Dashboard settings saved", "connected");
    setFeedback(elements.filterEditor.disabled ? "Connection saved. Dashboard search remains unchanged." : "Local settings saved for the next scan.", "success");
  } catch (error) {
    setFeedback(error.message || String(error), "error");
  } finally {
    elements.saveSettings.disabled = false;
  }
});
elements.openDashboard.addEventListener("click", () => chrome.tabs.create({ url: `${ScannerSettings.normaliseDashboardUrl(elements.dashboardUrl.value) || ScannerSettings.CANONICAL_DASHBOARD_ORIGIN}/saved-searches` }));
elements.returnMarketplace.addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ url: ["https://www.facebook.com/marketplace*", "https://www.facebook.com/marketplace/*", "https://facebook.com/marketplace*", "https://facebook.com/marketplace/*"] });
  const tab = tabs.at(-1);
  if (!tab?.id) return setFeedback("No open Marketplace tab was found.", "error");
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
});
elements.closeSettings.addEventListener("click", () => window.close());

initialise().catch(error => { setConnection("Setup failed", "error"); setFeedback(error.message || String(error), "error"); });
