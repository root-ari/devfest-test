/**
 * Smart Escape - SVG map renderer.
 *
 * renderMap(wrap, ctx) rebuilds the map inside `.map-wrap` from scratch on every state
 * change (the graphs are tiny: <= 60 nodes / 150 edges). The ctx object carries the whole
 * UI state plus the activation callbacks:
 *
 *   ctx = { graph, hazards, startId, mode, result, onNodeActivate, onEdgeActivate }
 *
 * Layer order (bottom to top): edge lines, route glow/flow, cost pills, nodes. Decorative
 * layers ignore pointer events so the wide invisible hit lines stay clickable underneath.
 * All data derived text goes through textContent - imported labels are untrusted.
 */

import { STRINGS, format } from './strings.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = 64; // viewBox padding around the node bounding box
const MIN_W = 140;
const MIN_H = 100;

/** Outer radius per node type. */
const NODE_R = { room: 21, junction: 17, exit: 22 };

/** Latest ctx per svg + listeners bound only once, so re-renders never stack handlers. */
const BINDINGS = new WeakMap();

export function renderMap(wrap, ctx) {
  const svg = wrap.querySelector('svg');
  const tooltip = wrap.querySelector('.tooltip');
  if (!svg || !ctx.graph) return;

  const binding = BINDINGS.get(svg) ?? { ctx: null, tip: tooltip, tipKey: null };
  BINDINGS.set(svg, binding);
  binding.ctx = ctx;
  binding.tip = tooltip;
  binding.wrap = wrap;
  binding.svg = svg;
  hideTip(binding);
  bindOnce(svg, wrap, binding);

  // Keep keyboard focus on the same element across the rebuild.
  const active = document.activeElement;
  const restoreKey =
    active && wrap.contains(active) && active.dataset && active.dataset.key
      ? active.dataset.key
      : null;

  const { graph, hazards, startId, result, mode } = ctx;
  const routeEdgeIds = result && result.status === 'ok' ? new Set(result.edgeIds) : new Set();
  const routeNodeIds = result && result.status === 'ok' ? new Set(result.path) : new Set();

  svg.setAttribute('viewBox', computeViewBox(graph.nodes));
  svg.setAttribute('aria-label', STRINGS.map.label);
  svg.classList.toggle('mode-start', mode === 'start');
  svg.classList.toggle('mode-hazard', mode === 'hazard');
  svg.replaceChildren();

  const layerEdges = svgEl('g', { class: 'layer-edges' });
  const layerRoute = svgEl('g', { class: 'layer-route' });
  const layerPills = svgEl('g', { class: 'layer-pills' });
  const layerNodes = svgEl('g', { class: 'layer-nodes' });
  svg.append(layerEdges, layerRoute, layerPills, layerNodes);

  for (const edge of graph.edges) drawEdge(edge, layerEdges, graph, hazards, routeEdgeIds);
  drawRoute(graph, result, routeEdgeIds, layerRoute);
  for (const edge of graph.edges) drawPill(edge, graph, hazards, layerPills);
  for (const node of graph.nodes) {
    drawNode(node, layerNodes, { hazards, startId, mode, result, routeNodeIds });
  }

  if (restoreKey) focusByKey(svg, restoreKey);
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/** viewBox from the node bounding box plus padding, with a sane minimum span. */
function computeViewBox(nodes) {
  if (!nodes || nodes.length === 0) return '0 0 400 300';
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  if (!Number.isFinite(minX)) return '0 0 400 300';
  const w = Math.max(maxX - minX, MIN_W);
  const h = Math.max(maxY - minY, MIN_H);
  return `${minX - PAD} ${minY - PAD} ${w + 2 * PAD} ${h + 2 * PAD}`;
}

/**
 * Corridor state, mirroring what the engine actually removed:
 *   blocked  the edge id itself is in blocked_edges
 *   unusable one endpoint is a blocked node or a closed exit
 *   open     traversable
 */
function edgeState(edge, hazards) {
  if (hazards.blockedEdges.has(edge.id)) return 'blocked';
  if (
    hazards.blockedNodes.has(edge.from) ||
    hazards.blockedNodes.has(edge.to) ||
    hazards.closedExits.has(edge.from) ||
    hazards.closedExits.has(edge.to)
  ) {
    return 'unusable';
  }
  return 'open';
}

/* ------------------------------------------------------------------ *
 * Layers
 * ------------------------------------------------------------------ */

function drawEdge(edge, layer, graph, hazards, routeEdgeIds) {
  const a = graph.nodesById.get(edge.from);
  const b = graph.nodesById.get(edge.to);
  if (!a || !b) return;
  const state = edgeState(edge, hazards);

  const group = svgEl('g', { class: `edge-group edge--${state}` });
  const visual = svgEl('line', { class: 'edge', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  const hit = svgEl('line', {
    class: 'edge-hit',
    'data-key': `edge:${edge.id}`,
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    tabindex: '0',
    role: 'button',
    'aria-label': edgeAria(edge, state, routeEdgeIds),
  });
  group.append(visual, hit);

  if (state === 'blocked') group.append(crossMark(midpoint(a, b), 'edge-x'));
  layer.append(group);
}

function drawRoute(graph, result, routeEdgeIds, layer) {
  if (!result || result.status !== 'ok') return;
  for (const edgeId of routeEdgeIds) {
    const edge = graph.edgesById.get(edgeId);
    if (!edge) continue;
    const a = graph.nodesById.get(edge.from);
    const b = graph.nodesById.get(edge.to);
    if (!a || !b) continue;
    layer.append(
      svgEl('line', { class: 'route-glow', x1: a.x, y1: a.y, x2: b.x, y2: b.y }),
      svgEl('line', { class: 'route-flow', x1: a.x, y1: a.y, x2: b.x, y2: b.y }),
    );
  }
}

/** Cost pill floated sideways from the midpoint so it never hides the line or the X mark. */
function drawPill(edge, graph, hazards, layer) {
  const a = graph.nodesById.get(edge.from);
  const b = graph.nodesById.get(edge.to);
  if (!a || !b) return;
  const state = edgeState(edge, hazards);
  const mid = midpoint(a, b);
  const n = normal(a, b, 15);
  const text = String(edge.cost);
  const w = Math.max(24, text.length * 8 + 14);

  const pill = svgEl('g', {
    class: `pill pill--${state}`,
    'data-key': `edge:${edge.id}`,
    transform: `translate(${mid.x + n.x} ${mid.y + n.y})`,
  });
  pill.append(
    svgEl('rect', { x: -w / 2, y: -9.5, width: w, height: 19, rx: 9.5, class: 'pill-bg' }),
    textEl('pill-text', text, 4.5),
  );
  layer.append(pill);
}

/**
 * Node group: pulse (dest), shape, state overlay, start ring + badge, labels.
 * `data-key` lives on the <g> so shape, labels and badge all activate the same node.
 */
function drawNode(node, layer, view) {
  const { hazards, startId, mode, result, routeNodeIds } = view;
  const r = NODE_R[node.type] ?? 18;
  const blocked = hazards.blockedNodes.has(node.id);
  const closed = hazards.closedExits.has(node.id);
  const isStart = startId === node.id;
  const onRoute = routeNodeIds.has(node.id);
  const isDest = Boolean(result && result.status === 'ok' && result.exitId === node.id);

  const classes = ['node', `node--${node.type}`];
  if (blocked) classes.push('is-blocked');
  if (closed) classes.push('is-closed');
  if (isStart) classes.push('is-start');
  if (onRoute) classes.push('is-route');
  if (isDest) classes.push('is-dest');

  const group = svgEl('g', {
    class: classes.join(' '),
    'data-key': `node:${node.id}`,
    transform: `translate(${node.x} ${node.y})`,
    tabindex: '0',
    role: 'button',
    'aria-label': nodeAria(node, { blocked, closed, isStart, onRoute, isDest, mode }),
  });

  if (isDest) group.append(svgEl('circle', { class: 'dest-pulse', r: r + 6 }));
  group.append(shapeFor(node.type, r));

  if (blocked) group.append(crossMark({ x: 0, y: 0 }, 'node-x', Math.max(9, r * 0.55)));
  if (closed) {
    const s = r * 0.62;
    group.append(svgEl('line', { class: 'close-slash', x1: -s, y1: s, x2: s, y2: -s }));
  }

  if (isStart) {
    group.append(svgEl('circle', { class: 'start-ring', r: r + 7 }));
    const badge = STRINGS.map.startBadge;
    const bw = badge.length * 7 + 16;
    const badgeG = svgEl('g', {
      class: 'start-badge',
      transform: `translate(0 ${-(r + 20)})`,
    });
    badgeG.append(
      svgEl('rect', { x: -bw / 2, y: -9, width: bw, height: 18, rx: 9 }),
      textEl('start-badge-text', badge, 4.5),
    );
    group.append(badgeG);
  }

  group.append(textEl('node-id', node.id, r + 16));
  if (node.label) group.append(textEl('node-label', truncate(node.label, 20), r + 31));

  layer.append(group);
}

/* ------------------------------------------------------------------ *
 * Shape + text helpers
 * ------------------------------------------------------------------ */

function shapeFor(type, r) {
  if (type === 'room') {
    return svgEl('rect', {
      class: 'node-shape',
      x: -r,
      y: -r,
      width: r * 2,
      height: r * 2,
      rx: 9,
    });
  }
  if (type === 'exit') {
    const g = svgEl('g', { class: 'exit-body' });
    const w = r * 0.866;
    const h = r * 0.5;
    g.append(
      svgEl('polygon', {
        class: 'node-shape',
        points: `0,${-r} ${w},${-h} ${w},${h} 0,${r} ${-w},${h} ${-w},${-h}`,
      }),
      svgEl('rect', { class: 'exit-door', x: -6.5, y: -5.5, width: 4.5, height: 11, rx: 1 }),
      svgEl('path', { class: 'exit-arrow', d: 'M -1 0 H 6 M 3.2 -2.8 L 6.4 0 L 3.2 2.8' }),
    );
    return g;
  }
  return svgEl('circle', { class: 'node-shape', r });
}

/** Two crossing lines: the "blocked" mark on nodes and corridors (not colour alone). */
function crossMark(at, className, size = 7) {
  const g = svgEl('g', { class: className, transform: `translate(${at.x} ${at.y})` });
  g.append(
    svgEl('line', { x1: -size, y1: -size, x2: size, y2: size }),
    svgEl('line', { x1: -size, y1: size, x2: size, y2: -size }),
  );
  return g;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Unit normal of a->b scaled by `dist` - floats the cost pill off the line. */
function normal(a, b, dist) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (-dy / len) * dist, y: (dx / len) * dist };
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) el.setAttribute(name, String(value));
  }
  return el;
}

function textEl(className, content, y) {
  const el = svgEl('text', { class: className, y, 'text-anchor': 'middle' });
  el.textContent = content;
  return el;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ------------------------------------------------------------------ *
 * Accessible names + tooltip content (all text from STRINGS)
 * ------------------------------------------------------------------ */

const TYPE_TEXT = () => ({
  room: STRINGS.map.typeRoom,
  junction: STRINGS.map.typeJunction,
  exit: STRINGS.map.typeExit,
});

function nodeStateLines(flags) {
  const lines = [];
  if (flags.isStart) lines.push(STRINGS.tooltip.start);
  if (flags.blocked) lines.push(STRINGS.tooltip.blocked);
  if (flags.closed) lines.push(STRINGS.tooltip.closed);
  if (flags.onRoute) lines.push(STRINGS.tooltip.onRoute);
  if (flags.isDest) lines.push(STRINGS.tooltip.destination);
  return lines;
}

function nodeActionLine(node, flags) {
  if (flags.mode === 'hazard') {
    return node.type === 'exit' ? STRINGS.tooltip.actionHazardExit : STRINGS.tooltip.actionHazardNode;
  }
  // Start mode: only offer the action when the click would actually succeed.
  if (flags.blocked || node.type === 'exit') return null;
  return STRINGS.tooltip.actionStartMode;
}

function nodeAria(node, flags) {
  const type = TYPE_TEXT()[node.type] ?? node.type;
  const parts = [`${node.id}, ${node.label || type}`, type, ...nodeStateLines(flags)];
  const action = nodeActionLine(node, flags);
  if (action) parts.push(action);
  return parts.join('. ');
}

function edgeAria(edge, state, routeEdgeIds) {
  const parts = [`${edge.id}`, format(STRINGS.map.edgeTooltipCost, { cost: edge.cost })];
  if (state === 'blocked') parts.push(STRINGS.tooltip.blocked);
  if (state === 'unusable') parts.push(STRINGS.tooltip.unusable);
  if (routeEdgeIds.has(edge.id)) parts.push(STRINGS.tooltip.onRoute);
  return parts.join('. ');
}

/** DOM nodes for the tooltip of a `node:` / `edge:` data key. */
function tooltipNodes(key, ctx) {
  const wrap = (title, lines) => {
    const frag = document.createDocumentFragment();
    const strong = document.createElement('div');
    strong.className = 'tooltip-title';
    strong.textContent = title;
    frag.append(strong);
    for (const line of lines) {
      const div = document.createElement('div');
      div.className = 'tooltip-line';
      div.textContent = line;
      frag.append(div);
    }
    return frag;
  };

  if (key.startsWith('node:')) {
    const id = key.slice(5);
    const node = ctx.graph.nodesById.get(id);
    if (!node) return document.createDocumentFragment();
    const flags = {
      blocked: ctx.hazards.blockedNodes.has(id),
      closed: ctx.hazards.closedExits.has(id),
      isStart: ctx.startId === id,
      onRoute: Boolean(ctx.result && ctx.result.status === 'ok' && ctx.result.path.includes(id)),
      isDest: Boolean(ctx.result && ctx.result.status === 'ok' && ctx.result.exitId === id),
      mode: ctx.mode,
    };
    const lines = [TYPE_TEXT()[node.type] ?? node.type, ...nodeStateLines(flags)];
    const action = nodeActionLine(node, flags);
    if (action) lines.push(action);
    return wrap(`${node.id} — ${node.label || node.id}`, lines);
  }

  const edgeId = key.slice(5);
  const edge = ctx.graph.edgesById.get(edgeId);
  if (!edge) return document.createDocumentFragment();
  const blocked = ctx.hazards.blockedEdges.has(edgeId);
  const unusable =
    !blocked &&
    (ctx.hazards.blockedNodes.has(edge.from) ||
      ctx.hazards.blockedNodes.has(edge.to) ||
      ctx.hazards.closedExits.has(edge.from) ||
      ctx.hazards.closedExits.has(edge.to));
  const lines = [format(STRINGS.map.edgeTooltipCost, { cost: edge.cost })];
  if (blocked) lines.push(STRINGS.tooltip.blocked);
  if (unusable) lines.push(STRINGS.tooltip.unusable);
  if (ctx.mode === 'hazard') lines.push(STRINGS.tooltip.actionHazardEdge);
  return wrap(edge.id, lines);
}

/* ------------------------------------------------------------------ *
 * Events - bound once per svg, reading the latest ctx from the binding
 * ------------------------------------------------------------------ */

function bindOnce(svg, wrap, binding) {
  if (BINDINGS.get(svg)?.bound) return;
  binding.bound = true;

  svg.addEventListener('click', (event) => dispatchActivate(event, binding));
  svg.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    dispatchActivate(event, binding);
  });
  svg.addEventListener('pointermove', (event) => {
    const target = keyTarget(event.target, svg);
    if (target) showTip(binding, target, event.clientX, event.clientY);
    else hideTip(binding);
  });
  svg.addEventListener('pointerleave', () => hideTip(binding));
  wrap.addEventListener('focusin', (event) => {
    const target = keyTarget(event.target, svg);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    showTip(binding, target, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  wrap.addEventListener('focusout', () => hideTip(binding));
}

function keyTarget(eventTarget, svg) {
  if (!eventTarget || typeof eventTarget.closest !== 'function') return null;
  const el = eventTarget.closest('[data-key]');
  return el && svg.contains(el) ? el : null;
}

function dispatchActivate(event, binding) {
  const target = keyTarget(event.target, binding.svg);
  if (!target) return;
  const key = target.dataset.key;
  if (key.startsWith('node:')) binding.ctx.onNodeActivate(key.slice(5));
  else if (key.startsWith('edge:')) binding.ctx.onEdgeActivate(key.slice(5));
}

function showTip(binding, target, clientX, clientY) {
  const tip = binding.tip;
  if (!tip || !binding.ctx) return;
  const key = target.dataset.key;
  if (key !== binding.tipKey) {
    binding.tipKey = key;
    tip.replaceChildren(tooltipNodes(key, binding.ctx));
  }
  tip.hidden = false;
  positionTip(tip, binding.wrap.getBoundingClientRect(), clientX, clientY);
}

function hideTip(binding) {
  if (binding.tip) binding.tip.hidden = true;
  binding.tipKey = null;
}

function positionTip(tip, rect, clientX, clientY) {
  let x = clientX - rect.left + 16;
  let y = clientY - rect.top + 16;
  const w = tip.offsetWidth || 180;
  const h = tip.offsetHeight || 60;
  if (x + w > rect.width - 6) x = clientX - rect.left - w - 12;
  if (y + h > rect.height - 6) y = clientY - rect.top - h - 12;
  tip.style.left = `${Math.max(6, x)}px`;
  tip.style.top = `${Math.max(6, y)}px`;
}

/** Re-focus the element carrying `key` after a rebuild, without scrolling the page. */
function focusByKey(svg, key) {
  try {
    const selector = `[data-key="${(window.CSS?.escape ?? ((s) => s))(key)}"]`;
    const el = svg.querySelector(selector);
    if (el) el.focus({ preventScroll: true });
  } catch {
    /* focus restore is best effort */
  }
}
