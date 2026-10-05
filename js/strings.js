/**
 * Smart Escape - every user visible string in one place.
 *
 * The text is hardcoded in English for now. Moving to real i18n later only needs a second
 * top level object (e.g. STRINGS_BN) and swapping it at startup: values are plain strings
 * with `{placeholder}` tokens, resolved through format(). Never inline UI text elsewhere.
 */

export const STRINGS = {
  app: {
    title: 'Smart Escape',
    subtitle: 'Evacuation route simulator',
    buildingFallback: 'Untitled building',
    documentTitle: '{app} · {building}',
  },

  lang: {
    en: 'EN',
    bn: 'বাংলা',
    soon: 'Language switching will be wired up later.',
    label: 'Language',
  },

  actions: {
    import: 'Import JSON',
    loadSample: 'Load sample',
    reset: 'Reset',
    dismiss: 'Dismiss',
    fileHint: 'Import a building.json file',
  },

  mode: {
    label: 'Interaction mode',
    start: 'Set start',
    hazard: 'Toggle hazards',
  },

  map: {
    label: 'Building map',
    startBadge: 'START',
    edgeTooltipCost: 'Corridor cost: {cost}',
    typeRoom: 'Room',
    typeJunction: 'Junction',
    typeExit: 'Exit',
  },

  tooltip: {
    start: 'Start location',
    blocked: 'Blocked',
    closed: 'Closed exit',
    onRoute: 'On the route',
    destination: 'Route destination',
    unusable: 'Unusable corridor',
    actionStartMode: 'Click to start here',
    actionHazardNode: 'Click to block / unblock',
    actionHazardExit: 'Click to close / reopen',
    actionHazardEdge: 'Click to block / unblock',
  },

  result: {
    promptTitle: 'Pick a starting location',
    promptHint: 'Choose “Set start”, then click a room or junction on the map.',
    startBlockedTitle: 'Starting location blocked',
    startBlockedHint: 'Clear the block on {start}, or pick a different starting location.',
    noRouteTitle: 'No route available',
    noRouteHint: 'No open exit can be reached from {start}. Remove a hazard or pick another start.',
    invalidTitle: 'Invalid starting location',
    invalidHint: 'Choose a room or junction that is not blocked.',
    okTitle: 'Route found',
    destination: 'Destination',
    destinationNode: 'Exit {id}',
    cost: 'Total cost',
    costUnit: 'cost',
    steps: 'Step by step',
    stepEdge: 'Corridor {id}',
    stepCost: 'cost {cost}',
    sequence: 'Route: {path}',
    none: '—',
  },

  /* ---- panel: exit comparison, legend, hazards ---- */

  exits: {
    title: 'Exit comparison',
    best: 'Best',
    cost: 'cost {cost}',
    exitRow: 'Exit {id}, {label}, cost {cost}',
    emptyNoStart: 'Pick a start to compare the open exits.',
    emptyBlocked: 'The start is blocked, so no exits can be compared.',
    emptyNoRoute: 'No open exit is reachable from the current start.',
    empty: 'No exit options.',
  },

  legend: {
    title: 'Legend',
    room: 'Room',
    junction: 'Junction',
    exit: 'Exit',
    start: 'Start location',
    route: 'Suggested route',
    blockedNode: 'Blocked node',
    blockedEdge: 'Blocked corridor',
    unusableEdge: 'Unusable corridor (touching a hazard)',
    closedExit: 'Closed exit',
  },

  hazards: {
    title: 'Hazard summary',
    blockedNodes: 'Blocked nodes ({count})',
    blockedEdges: 'Blocked corridors ({count})',
    closedExits: 'Closed exits ({count})',
    none: 'No active hazards. Toggle hazards on the map to simulate a scenario.',
    undoNode: 'Remove {id} from the blocked nodes',
    undoEdge: 'Remove {id} from the blocked corridors',
    undoExit: 'Reopen exit {id}',
  },

  /* ---- import error messages keyed by validator code ---- */
  errors: {
    title: 'Import failed — keeping the previous building',
    jsonParse: 'The file is not valid JSON.',
    unreadable: 'The file could not be read.',
    reasons: {
      missing: 'missing',
      not_string: 'not a string',
      empty: 'empty',
    },
    text: {
      JSON_PARSE: 'The file is not valid JSON.',
      FILE_UNREADABLE: 'The file could not be read.',
      DATA_NOT_OBJECT: 'The file must contain a JSON object (received {received}).',
      MISSING_FIELD: 'Missing required field: {field}.',
      BUILDING_NAME_INVALID: 'The building name must be a string (received {received}).',
      BUILDING_NAME_EMPTY: 'The building name must not be empty.',
      FIELD_NOT_ARRAY: 'The field “{field}” must be an array.',
      NODE_COUNT_OUT_OF_RANGE: 'Node count {count} is outside the allowed range {min}–{max}.',
      EDGE_COUNT_OUT_OF_RANGE: 'Corridor count {count} is outside the allowed range {min}–{max}.',
      NODE_INVALID: 'Node #{index} is not an object (received {received}).',
      NODE_ID_INVALID: 'Node #{index} has an invalid id ({id}).',
      DUPLICATE_NODE_ID: 'Duplicate node id: {id}.',
      NODE_LABEL_INVALID: 'Node {id} has an invalid label ({reason}).',
      NODE_TYPE_INVALID: 'Node {id} has an unknown type ({type}).',
      NODE_COORDINATES_INVALID: 'Node {id} needs finite x/y coordinates (x={x}, y={y}).',
      EDGE_INVALID: 'Corridor #{index} is not an object (received {received}).',
      EDGE_ID_INVALID: 'Corridor #{index} has an invalid id ({id}).',
      DUPLICATE_EDGE_ID: 'Duplicate corridor id: {id}.',
      EDGE_ENDPOINT_UNKNOWN: 'Corridor {edgeId} references an unknown {endpoint} node ({nodeId}).',
      EDGE_SELF_LOOP: 'Corridor {edgeId} connects {nodeId} to itself.',
      EDGE_PAIR_DUPLICATE: 'Corridor {edgeId} duplicates {otherEdgeId} between {from} and {to}.',
      EDGE_COST_INVALID: 'Corridor {edgeId} needs a positive integer cost (received {cost}).',
      NO_STARTABLE_NODE: 'The building has no room or junction to start from.',
      NO_EXIT: 'The building has no exit.',
      INITIAL_STATE_INVALID: 'initial_state must be an object (received {received}).',
      BLOCKED_NODE_UNKNOWN: 'initial_state blocks an unknown node ({id}).',
      BLOCKED_NODE_NOT_TRAVERSABLE:
        'Node {id} has type {type}; only rooms and junctions can be blocked.',
      BLOCKED_EDGE_UNKNOWN: 'initial_state blocks an unknown corridor ({id}).',
      CLOSED_EXIT_UNKNOWN: 'initial_state closes an unknown exit ({id}).',
      CLOSED_EXIT_NOT_EXIT: 'Node {id} has type {type}; only exits can be closed.',
    },
  },

  toast: {
    blockedStart: '{id} is blocked — unblock it first to start there.',
    exitStart: 'Exits are destinations. Pick a room or junction instead.',
    unknownStart: '{id} cannot be a starting location.',
    langSoon: 'Language switching will be wired up later.',
  },
};

/**
 * Resolves `{placeholder}` tokens in a template.
 * @param {string} template value from STRINGS
 * @param {Record<string, string|number>} [params]
 */
export function format(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
}

