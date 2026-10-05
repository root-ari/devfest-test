/**
 * Smart Escape - building.json validation.
 *
 * validateBuilding(data) returns { ok, errors, graph }:
 *   - ok      true when no error was found
 *   - errors  at most LIMITS.MAX_ERRORS machine readable entries, in a deterministic order.
 *             Each entry is { code, params }. Codes and params carry no display text; the UI
 *             owns the translation.
 *   - graph   best effort normalized graph (null when the data is too broken to index) so a
 *             file with errors can still be drawn. Only trust it when ok === true.
 *
 * Schema
 *   { building: string,
 *     nodes: [{ id, label, type: 'room'|'junction'|'exit', x, y }],
 *     edges: [{ id, from, to, cost }],          // undirected, cost is a positive integer
 *     initial_state: { blocked_nodes: [], blocked_edges: [], closed_exits: [] } }
 *
 * Ids are case sensitive, so 'R1' and 'r1' are two different nodes. A disconnected graph is
 * valid: reachability is a routing concern, not a schema concern.
 */

export const LIMITS = Object.freeze({
  MIN_NODES: 2,
  MAX_NODES: 60,
  MIN_EDGES: 1,
  MAX_EDGES: 150,
  MAX_ERRORS: 10,
});

export const NODE_TYPES = Object.freeze(['room', 'junction', 'exit']);
export const STARTABLE_TYPES = Object.freeze(['room', 'junction']);
export const EXIT_TYPE = 'exit';

const REQUIRED_FIELDS = Object.freeze(['building', 'nodes', 'edges', 'initial_state']);
const NODE_TYPE_SET = new Set(NODE_TYPES);
const STARTABLE_TYPE_SET = new Set(STARTABLE_TYPES);

export function validateBuilding(data) {
  const errors = [];
  /** Records an error unless the cap is already reached; validation always continues. */
  const addError = (code, params) => {
    if (errors.length < LIMITS.MAX_ERRORS) errors.push({ code, params: { ...params } });
  };

  if (!isRecord(data)) {
    addError('DATA_NOT_OBJECT', { received: describe(data) });
    return { ok: false, errors, graph: null };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!isPresent(data[field])) addError('MISSING_FIELD', { field });
  }

  checkBuildingName(data, addError);

  const nodesById = new Map();
  if (data.nodes !== undefined && data.nodes !== null) {
    if (Array.isArray(data.nodes)) collectNodes(data.nodes, nodesById, addError);
    else addError('FIELD_NOT_ARRAY', { field: 'nodes' });
  }

  const typeCounts = countNodeTypes(nodesById);
  if (Array.isArray(data.nodes) && data.nodes.length > 0) {
    if (typeCounts.room + typeCounts.junction === 0) addError('NO_STARTABLE_NODE', {});
    if (typeCounts.exit === 0) addError('NO_EXIT', {});
  }

  const edgesById = new Map();
  const usableEdges = [];
  if (data.edges !== undefined && data.edges !== null) {
    if (Array.isArray(data.edges)) collectEdges(data.edges, nodesById, edgesById, usableEdges, addError);
    else addError('FIELD_NOT_ARRAY', { field: 'edges' });
  }

  const initialState = checkInitialState(data, nodesById, edgesById, addError);

  const graph = Array.isArray(data.nodes)
    ? buildGraph(data, nodesById, edgesById, usableEdges, initialState)
    : null;

  return { ok: errors.length === 0, errors, graph };
}

function checkBuildingName(data, addError) {
  if (!isPresent(data.building)) return;
  if (typeof data.building !== 'string') {
    addError('BUILDING_NAME_INVALID', { received: describe(data.building) });
  } else if (data.building.trim() === '') {
    addError('BUILDING_NAME_EMPTY', {});
  }
}

/**
 * Validates every node. Nodes without a usable id are skipped (they cannot be referenced),
 * the first entry wins for a duplicated id, and everything usable is indexed in `nodesById`
 * even when it carries other errors, so edge and hazard checks can still resolve it.
 */
function collectNodes(nodes, nodesById, addError) {
  const count = nodes.length;
  if (count < LIMITS.MIN_NODES || count > LIMITS.MAX_NODES) {
    addError('NODE_COUNT_OUT_OF_RANGE', { count, min: LIMITS.MIN_NODES, max: LIMITS.MAX_NODES });
  }

  const seenIds = new Set();
  nodes.forEach((node, index) => {
    if (!isRecord(node)) {
      addError('NODE_INVALID', { index, received: describe(node) });
      return;
    }
    if (typeof node.id !== 'string' || node.id === '') {
      addError('NODE_ID_INVALID', { index, id: describe(node.id) });
      return;
    }
    const id = node.id;
    if (seenIds.has(id)) {
      addError('DUPLICATE_NODE_ID', { id });
      return;
    }
    seenIds.add(id);

    if (typeof node.label !== 'string') {
      addError('NODE_LABEL_INVALID', { id, reason: isPresent(node.label) ? 'not_string' : 'missing' });
    } else if (node.label.trim() === '') {
      addError('NODE_LABEL_INVALID', { id, reason: 'empty' });
    }

    if (!NODE_TYPE_SET.has(node.type)) {
      addError('NODE_TYPE_INVALID', { id, type: describe(node.type) });
    }

    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      addError('NODE_COORDINATES_INVALID', { id, x: describe(node.x), y: describe(node.y) });
    }

    nodesById.set(id, {
      id,
      label: typeof node.label === 'string' ? node.label : '',
      type: typeof node.type === 'string' ? node.type : '',
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
    });
  });
}

/**
 * Validates every edge: unique id, existing and distinct endpoints, no second edge between
 * the same unordered node pair (A-B equals B-A), and a positive integer cost. `edgesById`
 * keeps every edge with a unique id so `blocked_edges` can be resolved; `usableEdges` only
 * keeps edges the solver may actually traverse.
 */
function collectEdges(edges, nodesById, edgesById, usableEdges, addError) {
  const count = edges.length;
  if (count < LIMITS.MIN_EDGES || count > LIMITS.MAX_EDGES) {
    addError('EDGE_COUNT_OUT_OF_RANGE', { count, min: LIMITS.MIN_EDGES, max: LIMITS.MAX_EDGES });
  }

  const seenIds = new Set();
  const seenPairs = new Map();
  edges.forEach((edge, index) => {
    if (!isRecord(edge)) {
      addError('EDGE_INVALID', { index, received: describe(edge) });
      return;
    }
    if (typeof edge.id !== 'string' || edge.id === '') {
      addError('EDGE_ID_INVALID', { index, id: describe(edge.id) });
      return;
    }
    const id = edge.id;
    if (seenIds.has(id)) {
      addError('DUPLICATE_EDGE_ID', { id });
      return;
    }
    seenIds.add(id);
    edgesById.set(id, { id, from: edge.from, to: edge.to, cost: edge.cost });

    let traversable = true;
    for (const endpoint of ['from', 'to']) {
      const nodeId = edge[endpoint];
      if (typeof nodeId !== 'string' || !nodesById.has(nodeId)) {
        addError('EDGE_ENDPOINT_UNKNOWN', { edgeId: id, endpoint, nodeId: describe(nodeId) });
        traversable = false;
      }
    }
    if (traversable && edge.from === edge.to) {
      addError('EDGE_SELF_LOOP', { edgeId: id, nodeId: edge.from });
      traversable = false;
    }
    if (traversable) {
      const key = pairKey(edge.from, edge.to);
      const otherEdgeId = seenPairs.get(key);
      if (otherEdgeId !== undefined) {
        addError('EDGE_PAIR_DUPLICATE', { edgeId: id, from: edge.from, to: edge.to, otherEdgeId });
        traversable = false;
      } else {
        seenPairs.set(key, id);
      }
    }
    if (!Number.isInteger(edge.cost) || edge.cost <= 0) {
      addError('EDGE_COST_INVALID', { edgeId: id, cost: describe(edge.cost) });
      traversable = false;
    }

    if (traversable) usableEdges.push({ id, from: edge.from, to: edge.to, cost: edge.cost });
  });
}

/**
 * Validates the three hazard lists and returns them normalized to sets of ids that actually
 * exist, so the UI can feed graph.initialState straight into the engine.
 */
function checkInitialState(data, nodesById, edgesById, addError) {
  const empty = { blockedNodes: new Set(), blockedEdges: new Set(), closedExits: new Set() };
  if (!isPresent(data.initial_state)) return empty;
  if (!isRecord(data.initial_state)) {
    addError('INITIAL_STATE_INVALID', { received: describe(data.initial_state) });
    return empty;
  }
  const source = data.initial_state;

  const blockedNodes = readIdList(source, 'blocked_nodes', (list, addEntry) => {
    for (const entry of list) {
      const node = typeof entry === 'string' ? nodesById.get(entry) : undefined;
      if (!node) addError('BLOCKED_NODE_UNKNOWN', { id: describe(entry) });
      else if (!STARTABLE_TYPE_SET.has(node.type)) {
        addError('BLOCKED_NODE_NOT_TRAVERSABLE', { id: entry, type: node.type });
      } else addEntry(entry);
    }
  }, addError);

  const blockedEdges = readIdList(source, 'blocked_edges', (list, addEntry) => {
    for (const entry of list) {
      if (typeof entry !== 'string' || !edgesById.has(entry)) addError('BLOCKED_EDGE_UNKNOWN', { id: describe(entry) });
      else addEntry(entry);
    }
  }, addError);

  const closedExits = readIdList(source, 'closed_exits', (list, addEntry) => {
    for (const entry of list) {
      const node = typeof entry === 'string' ? nodesById.get(entry) : undefined;
      if (!node) addError('CLOSED_EXIT_UNKNOWN', { id: describe(entry) });
      else if (node.type !== EXIT_TYPE) addError('CLOSED_EXIT_NOT_EXIT', { id: entry, type: node.type });
      else addEntry(entry);
    }
  }, addError);

  return { blockedNodes, blockedEdges, closedExits };
}

/** Reads one required array of initial_state and keeps the entries that survive validation. */
function readIdList(source, field, visit, addError) {
  const ids = new Set();
  const list = source[field];
  if (!isPresent(list)) {
    addError('MISSING_FIELD', { field });
    return ids;
  }
  if (!Array.isArray(list)) {
    addError('FIELD_NOT_ARRAY', { field });
    return ids;
  }
  visit(list, (id) => ids.add(id));
  return ids;
}

/**
 * Normalized graph handed to the engine.
 *   building     string
 *   nodes        [{ id, label, type, x, y }]                      first entry per id
 *   edges        [{ id, from, to, cost }]                         traversable edges only
 *   nodesById    Map<string, node>     edgesById   Map<string, edge>
 *   adjacency    Map<string, { to, edgeId, cost }[]>              both directions
 *   exits        exit ids              startable   room/junction ids
 *   initialState { blockedNodes:Set, blockedEdges:Set, closedExits:Set }
 */
function buildGraph(data, nodesById, edgesById, usableEdges, initialState) {
  const nodes = [...nodesById.values()];
  const edges = usableEdges.slice();
  const adjacency = new Map();
  for (const id of nodesById.keys()) adjacency.set(id, []);
  for (const edge of edges) {
    adjacency.get(edge.from).push({ to: edge.to, edgeId: edge.id, cost: edge.cost });
    adjacency.get(edge.to).push({ to: edge.from, edgeId: edge.id, cost: edge.cost });
  }

  const exits = [];
  const startable = [];
  for (const node of nodes) {
    if (node.type === EXIT_TYPE) exits.push(node.id);
    if (STARTABLE_TYPE_SET.has(node.type)) startable.push(node.id);
  }

  return {
    building: typeof data.building === 'string' ? data.building : '',
    nodes,
    edges,
    nodesById,
    edgesById,
    adjacency,
    exits,
    startable,
    initialState,
  };
}

function countNodeTypes(nodesById) {
  const counts = { room: 0, junction: 0, exit: 0 };
  for (const node of nodesById.values()) {
    if (counts[node.type] !== undefined) counts[node.type] += 1;
  }
  return counts;
}

/** Order independent key for an unordered node pair, so A-B and B-A collide. */
function pairKey(a, b) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresent(value) {
  return value !== undefined && value !== null;
}

/** JSON friendly rendering of an arbitrary value for error params. */
function describe(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  const type = typeof value;
  return type === 'object' || type === 'function' || type === 'symbol' ? type : value;
}