/**
 * Smart Escape - application state and wiring.
 *
 * State lives here and nowhere else:
 *   graph                normalized graph of the currently loaded building
 *   originalInitialState the file's initial_state, kept pristine for Reset
 *   hazards              live { blockedNodes, blockedEdges, closedExits } Sets (copies)
 *   startId              selected starting node, or null
 *   mode                 'start' | 'hazard'
 *   result               last computeRoute() output (recomputed on every change)
 *   errors               errors of the last FAILED import (previous building stays loaded)
 *
 * Every mutation ends in renderAll(): recompute the route, then re-render map + panel.
 * DOM access is guarded so this module can be imported in Node for smoke tests.
 */

import { computeRoute, isSelectableStart } from './engine.js';
import { validateBuilding } from './validate.js';
import { SAMPLE } from './sample.js';
import { STRINGS, format } from './strings.js';
import { renderMap } from './render.js';
import { renderPanel } from './panel.js';

export const state = {
  graph: null,
  originalInitialState: null,
  hazards: null,
  startId: null,
  mode: 'start',
  result: null,
  errors: [],
};

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function init() {
  document.getElementById('app-title').textContent = STRINGS.app.title;
  document.getElementById('app-subtitle').textContent = STRINGS.app.subtitle;

  buildLangSwitch();
  buildModeSwitch();

  const btnImport = document.getElementById('btn-import');
  const btnSample = document.getElementById('btn-sample');
  const btnReset = document.getElementById('btn-reset');
  const fileInput = document.getElementById('file-input');

  btnImport.textContent = STRINGS.actions.import;
  btnImport.title = STRINGS.actions.fileHint;
  btnImport.addEventListener('click', () => fileInput.click());

  btnSample.textContent = STRINGS.actions.loadSample;
  btnSample.addEventListener('click', () => loadSample());

  btnReset.textContent = STRINGS.actions.reset;
  btnReset.addEventListener('click', () => resetHazards());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // allow picking the same file again
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => adoptFromText(String(reader.result));
    reader.onerror = () => showImportErrors([{ code: 'FILE_UNREADABLE', params: {} }]);
    reader.readAsText(file);
  });

  loadSample();
}

/** EN | বাংলা placeholder - wired up when i18n lands. */
function buildLangSwitch() {
  const box = document.getElementById('lang-switch');
  box.setAttribute('aria-label', STRINGS.lang.label);
  for (const label of [STRINGS.lang.en, STRINGS.lang.bn]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `lang-btn${label === STRINGS.lang.en ? ' is-active' : ''}`;
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(label === STRINGS.lang.en));
    btn.addEventListener('click', () => showToast(STRINGS.lang.soon));
    box.append(btn);
  }
}

/** Segmented "Set start | Toggle hazards" control. */
function buildModeSwitch() {
  const box = document.getElementById('mode-switch');
  box.setAttribute('aria-label', STRINGS.mode.label);
  for (const [mode, label] of [
    ['start', STRINGS.mode.start],
    ['hazard', STRINGS.mode.hazard],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.dataset.mode = mode;
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(state.mode === mode));
    btn.addEventListener('click', () => setMode(mode));
    box.append(btn);
  }
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  renderAll();
}

/* ------------------------------------------------------------------ *
 * Loading / import / reset
 * ------------------------------------------------------------------ */

/** Startup + "Load sample": a fresh building, hazards from its initial_state, no start. */
export function loadSample() {
  // validateBuilding only reads, the clone keeps SAMPLE defensively isolated anyway.
  adoptBuilding(structuredClone(SAMPLE));
}

function adoptFromText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    showImportErrors([{ code: 'JSON_PARSE', params: {} }]);
    return;
  }
  adoptBuilding(data);
}

/**
 * Validates `data` and only adopts it when it is fully valid - on failure the errors are
 * shown in the panel and the previous building, start and hazards stay untouched.
 */
export function adoptBuilding(data) {
  const validated = validateBuilding(data);
  if (!validated.ok || !validated.graph) {
    showImportErrors(validated.errors);
    return;
  }
  state.graph = validated.graph;
  state.originalInitialState = cloneHazards(validated.graph.initialState);
  state.hazards = cloneHazards(validated.graph.initialState);
  state.startId = null;
  state.errors = [];
  renderAll();
}

function showImportErrors(errors) {
  state.errors = errors && errors.length > 0 ? errors : [{ code: 'FILE_UNREADABLE', params: {} }];
  renderAll();
}

/** Reset restores the file's ORIGINAL initial_state but keeps the selected start. */
export function resetHazards() {
  if (!state.originalInitialState) return;
  state.hazards = cloneHazards(state.originalInitialState);
  renderAll();
}

function cloneHazards(source) {
  return {
    blockedNodes: new Set(source.blockedNodes),
    blockedEdges: new Set(source.blockedEdges),
    closedExits: new Set(source.closedExits),
  };
}

function toggleIn(set, id) {
  if (set.has(id)) set.delete(id);
  else set.add(id);
}

/* ------------------------------------------------------------------ *
 * Map interaction
 * ------------------------------------------------------------------ */

export function onNodeActivate(id) {
  if (!state.graph) return;
  if (state.mode === 'hazard') {
    const node = state.graph.nodesById.get(id);
    if (!node) return;
    toggleIn(node.type === 'exit' ? state.hazards.closedExits : state.hazards.blockedNodes, id);
    renderAll();
    return;
  }

  if (isSelectableStart(state.graph, state.hazards, id)) {
    state.startId = id;
    renderAll();
    return;
  }
  const node = state.graph.nodesById.get(id);
  if (node && node.type === 'exit') showToast(STRINGS.toast.exitStart);
  else if (state.hazards.blockedNodes.has(id)) {
    showToast(format(STRINGS.toast.blockedStart, { id }));
  } else showToast(format(STRINGS.toast.unknownStart, { id }));
}

export function onEdgeActivate(id) {
  if (!state.graph || state.mode !== 'hazard') return;
  toggleIn(state.hazards.blockedEdges, id);
  renderAll();
}

/** Click-to-undo from the hazard summary chips. */
export function onUndo(kind, id) {
  if (kind === 'node') state.hazards.blockedNodes.delete(id);
  else if (kind === 'edge') state.hazards.blockedEdges.delete(id);
  else state.hazards.closedExits.delete(id);
  renderAll();
}

export function onDismissErrors() {
  state.errors = [];
  renderAll();
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

export function renderAll() {
  state.result = state.graph
    ? computeRoute(state.graph, state.hazards, state.startId)
    : { status: 'no_start' };
  if (typeof document === 'undefined') return; // Node smoke tests stop here

  const name = state.graph && state.graph.building ? state.graph.building : STRINGS.app.buildingFallback;
  document.getElementById('building-name').textContent = name;
  document.title = format(STRINGS.app.documentTitle, { app: STRINGS.app.title, building: name });

  document.querySelectorAll('#mode-switch .seg-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
  });

  renderMap(document.getElementById('map-wrap'), {
    graph: state.graph,
    hazards: state.hazards,
    startId: state.startId,
    mode: state.mode,
    result: state.result,
    onNodeActivate,
    onEdgeActivate,
  });

  renderPanel(document.getElementById('panel'), {
    graph: state.graph,
    hazards: state.hazards,
    startId: state.startId,
    result: state.result,
    errors: state.errors,
    onUndo,
    onDismissErrors,
  });
}

/* ------------------------------------------------------------------ *
 * Toast
 * ------------------------------------------------------------------ */

let toastTimer = 0;

function showToast(message) {
  if (typeof document === 'undefined') return;
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

/* ------------------------------------------------------------------ *
 * Start (skipped when imported without a DOM, e.g. smoke tests)
 * ------------------------------------------------------------------ */

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
