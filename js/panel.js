/**
 * Smart Escape - side panel renderer.
 *
 * renderPanel(panel, ctx) rebuilds the 320px side column from scratch on every change:
 *
 *   ctx = { graph, hazards, startId, result, errors, onUndo, onDismissErrors }
 *
 * Sections, in order:
 *   1. import errors (only after a failed import - the previous building stays loaded)
 *   2. result card: prompt / start blocked / no route / success with chips + step list
 *   3. exit comparison: every open reachable exit, cheapest highlighted
 *   4. legend of all node and corridor states
 *   5. hazard summary with click-to-undo chips
 *
 * All text comes from STRINGS; data derived labels always go through textContent.
 */

import { STRINGS, format } from './strings.js';

export function renderPanel(panel, ctx) {
  panel.replaceChildren();
  if (ctx.errors && ctx.errors.length > 0) panel.append(errorsCard(ctx));
  panel.append(resultCard(ctx), exitsCard(ctx), legendCard(), hazardsCard(ctx));
}

/* ------------------------------------------------------------------ *
 * 1. Import errors
 * ------------------------------------------------------------------ */

function errorsCard(ctx) {
  const card = el('section', 'card panel-card card--error');
  card.setAttribute('role', 'alert');

  const head = el('div', 'panel-card-head');
  head.append(el('h3', 'panel-title', STRINGS.errors.title));
  const dismiss = el('button', 'icon-btn', '✕');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', STRINGS.actions.dismiss);
  dismiss.title = STRINGS.actions.dismiss;
  dismiss.addEventListener('click', () => ctx.onDismissErrors());
  head.append(dismiss);
  card.append(head);

  const list = el('ul', 'error-list');
  for (const error of ctx.errors) {
    const item = el('li', 'error-item');
    const code = el('code', 'error-code', error.code);
    const params = {
      ...error.params,
      reason: STRINGS.errors.reasons[error.params.reason] ?? error.params.reason,
    };
    const template = STRINGS.errors.text[error.code];
    const message = el('span', 'error-message', template ? format(template, params) : error.code);
    item.append(code, message);
    list.append(item);
  }
  card.append(list);
  return card;
}

/* ------------------------------------------------------------------ *
 * 2. Result card
 * ------------------------------------------------------------------ */

function resultCard(ctx) {
  const { result, startId } = ctx;
  const status = result ? result.status : 'no_start';

  if (status === 'ok') return successCard(ctx);

  const map = {
    no_start: ['is-prompt', STRINGS.result.promptTitle, STRINGS.result.promptHint],
    start_blocked: [
      'is-danger',
      STRINGS.result.startBlockedTitle,
      format(STRINGS.result.startBlockedHint, { start: startId ?? '' }),
    ],
    no_route: [
      'is-warn',
      STRINGS.result.noRouteTitle,
      format(STRINGS.result.noRouteHint, { start: startId ?? '' }),
    ],
    invalid_start: ['is-warn', STRINGS.result.invalidTitle, STRINGS.result.invalidHint],
  };
  const [variant, title, hint] = map[status] ?? map.no_start;

  const card = el('section', `card panel-card result-card ${variant}`);
  card.append(el('div', 'result-title', title));
  card.append(el('p', 'result-hint', hint));
  return card;
}

function successCard(ctx) {
  const { graph, result } = ctx;
  const exitNode = graph.nodesById.get(result.exitId);
  const card = el('section', 'card panel-card result-card is-ok');

  const head = el('div', 'result-head');
  head.append(el('span', 'result-title', STRINGS.result.okTitle));
  const cost = el('span', 'cost-big', String(result.cost));
  const unit = el('span', 'cost-unit', STRINGS.result.costUnit);
  cost.append(unit);
  head.append(cost);
  card.append(head);

  const dest = el('div', 'result-dest');
  dest.append(el('span', 'result-label', STRINGS.result.destination));
  const destValue = el('span', 'result-dest-value');
  destValue.textContent = `${format(STRINGS.result.destinationNode, { id: result.exitId })}${
    exitNode && exitNode.label ? ` — ${exitNode.label}` : ''
  }`;
  dest.append(destValue);
  card.append(dest);

  card.append(sequenceChips(result.path));
  card.append(stepList(ctx, result));
  return card;
}

function sequenceChips(path) {
  const row = el('div', 'chips');
  path.forEach((id, index) => {
    if (index > 0) {
      const arrow = el('span', 'chip-arrow', '→');
      arrow.setAttribute('aria-hidden', 'true');
      row.append(arrow);
    }
    row.append(el('span', 'chip chip--node', id));
  });
  return row;
}

function stepList(ctx, result) {
  const wrap = el('div', 'steps-wrap');
  wrap.append(el('h4', 'steps-title', STRINGS.result.steps));
  const list = el('ol', 'steps');
  result.path.slice(0, -1).forEach((from, index) => {
    const to = result.path[index + 1];
    const edgeId = result.edgeIds[index];
    const edge = ctx.graph.edgesById.get(edgeId);
    const item = el('li', 'step');
    item.append(el('span', 'step-path', `${from} → ${to}`));
    const meta = el('span', 'step-meta');
    meta.append(el('span', 'step-edge', format(STRINGS.result.stepEdge, { id: edgeId })));
    meta.append(
      el('span', 'step-cost', format(STRINGS.result.stepCost, { cost: edge ? edge.cost : '?' })),
    );
    item.append(meta);
    list.append(item);
  });
  wrap.append(list);
  return wrap;
}

/* ------------------------------------------------------------------ *
 * 3. Exit comparison
 * ------------------------------------------------------------------ */

function exitsCard(ctx) {
  const card = el('section', 'card panel-card');
  card.append(el('h3', 'panel-title', STRINGS.exits.title));

  const { result } = ctx;
  if (result && result.status === 'ok' && result.exitOptions.length > 0) {
    const list = el('ul', 'exit-list');
    result.exitOptions.forEach((option, index) => {
      const exitNode = ctx.graph.nodesById.get(option.exitId);
      const row = el('li', `exit-row${index === 0 ? ' is-best' : ''}`);
      row.append(el('span', 'chip chip--exit', option.exitId));
      row.append(el('span', 'exit-name', exitNode ? exitNode.label : option.exitId));
      row.append(
        el('span', 'exit-cost', format(STRINGS.exits.cost, { cost: option.cost })),
      );
      if (index === 0) row.append(el('span', 'best-badge', STRINGS.exits.best));
      row.setAttribute(
        'aria-label',
        format(STRINGS.exits.exitRow, {
          id: option.exitId,
          label: exitNode ? exitNode.label : option.exitId,
          cost: option.cost,
        }),
      );
      list.append(row);
    });
    card.append(list);
    return card;
  }

  const empty = {
    no_start: STRINGS.exits.emptyNoStart,
    start_blocked: STRINGS.exits.emptyBlocked,
    no_route: STRINGS.exits.emptyNoRoute,
    invalid_start: STRINGS.exits.emptyNoStart,
  };
  const message = result ? empty[result.status] ?? STRINGS.exits.empty : STRINGS.exits.emptyNoStart;
  card.append(el('p', 'panel-empty', message));
  return card;
}

/* ------------------------------------------------------------------ *
 * 4. Legend (static swatch markup, labels from STRINGS)
 * ------------------------------------------------------------------ */

function legendCard() {
  const card = el('section', 'card panel-card');
  card.append(el('h3', 'panel-title', STRINGS.legend.title));

  const items = [
    ['room', '<rect x="5" y="5" width="15" height="15" rx="4" class="sw-shape sw-room"/>', STRINGS.legend.room],
    ['junction', '<circle cx="12.5" cy="12.5" r="7" class="sw-shape sw-junction"/>', STRINGS.legend.junction],
    [
      'exit',
      '<polygon points="12.5,4 19,8.25 19,16.75 12.5,21 6,16.75 6,8.25" class="sw-shape sw-exit"/>',
      STRINGS.legend.exit,
    ],
    [
      'start',
      '<circle cx="12.5" cy="12.5" r="7.5" class="sw-shape sw-junction"/><circle cx="12.5" cy="12.5" r="10.5" class="sw-start-ring"/>',
      STRINGS.legend.start,
    ],
    [
      'route',
      '<line x1="3" y1="12.5" x2="22" y2="12.5" class="sw-route"/><line x1="3" y1="12.5" x2="22" y2="12.5" class="sw-route-dash"/>',
      STRINGS.legend.route,
    ],
    [
      'blocked-node',
      '<circle cx="12.5" cy="12.5" r="8" class="sw-shape sw-blocked"/><line x1="8" y1="17" x2="17" y2="8" class="sw-x"/>',
      STRINGS.legend.blockedNode,
    ],
    [
      'blocked-edge',
      '<line x1="3" y1="12.5" x2="22" y2="12.5" class="sw-edge-blocked"/><line x1="9.5" y1="15.5" x2="15.5" y2="9.5" class="sw-x"/>',
      STRINGS.legend.blockedEdge,
    ],
    [
      'unusable-edge',
      '<line x1="3" y1="12.5" x2="22" y2="12.5" class="sw-edge-unusable"/>',
      STRINGS.legend.unusableEdge,
    ],
    [
      'closed-exit',
      '<polygon points="12.5,4 19,8.25 19,16.75 12.5,21 6,16.75 6,8.25" class="sw-shape sw-closed"/><line x1="7" y1="18" x2="18" y2="7" class="sw-x"/>',
      STRINGS.legend.closedExit,
    ],
  ];

  const list = el('ul', 'legend-list');
  for (const [key, inner, label] of items) {
    const item = el('li', `legend-item legend-item--${key}`);
    const swatch = el('span', 'legend-swatch');
    swatch.innerHTML = `<svg viewBox="0 0 25 25" aria-hidden="true" focusable="false">${inner}</svg>`;
    item.append(swatch, el('span', 'legend-label', label));
    list.append(item);
  }
  card.append(list);
  return card;
}

/* ------------------------------------------------------------------ *
 * 5. Hazard summary - every chip undoes one hazard
 * ------------------------------------------------------------------ */

function hazardsCard(ctx) {
  const card = el('section', 'card panel-card');
  card.append(el('h3', 'panel-title', STRINGS.hazards.title));

  const { hazards, onUndo } = ctx;
  const groups = [
    {
      ids: [...hazards.blockedNodes],
      title: (count) => format(STRINGS.hazards.blockedNodes, { count }),
      chipClass: 'chip--blocked',
      undo: (id) => format(STRINGS.hazards.undoNode, { id }),
      undoKind: 'node',
    },
    {
      ids: [...hazards.blockedEdges],
      title: (count) => format(STRINGS.hazards.blockedEdges, { count }),
      chipClass: 'chip--blocked',
      undo: (id) => format(STRINGS.hazards.undoEdge, { id }),
      undoKind: 'edge',
    },
    {
      ids: [...hazards.closedExits],
      title: (count) => format(STRINGS.hazards.closedExits, { count }),
      chipClass: 'chip--closed',
      undo: (id) => format(STRINGS.hazards.undoExit, { id }),
      undoKind: 'exit',
    },
  ].filter((group) => group.ids.length > 0);

  if (groups.length === 0) {
    card.append(el('p', 'panel-empty', STRINGS.hazards.none));
    return card;
  }

  const summary = el('div', 'hazard-groups');
  for (const group of groups) {
    const block = el('div', 'hazard-group');
    block.append(el('div', 'hazard-group-title', group.title(group.ids.length)));
    const row = el('div', 'hazard-chips');
    for (const id of group.ids) {
      const chip = el('button', `chip chip--rm ${group.chipClass}`);
      chip.type = 'button';
      chip.append(el('span', 'chip-id', id), el('span', 'chip-x', '✕'));
      const undoLabel = group.undo(id);
      chip.setAttribute('aria-label', undoLabel);
      chip.title = undoLabel;
      chip.addEventListener('click', () => onUndo(group.undoKind, id));
      row.append(chip);
    }
    block.append(row);
    summary.append(block);
  }
  card.append(summary);
  return card;
}

/* ------------------------------------------------------------------ *
 * Small DOM helper
 * ------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
