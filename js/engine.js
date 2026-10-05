/**
 * Smart Escape - evacuation route solver.
 *
 * computeRoute(graph, hazards, startId) picks the cheapest open exit reachable from
 * `startId` and returns a single, fully deterministic route.
 *
 * graph   normalized graph produced by validateBuilding() (`nodes`/`edges` are the only
 *         hard requirement; `nodesById`/`adjacency` are used as a fast path when present)
 * hazards { blockedNodes:Set, blockedEdges:Set, closedExits:Set }
 * startId node id of the room / junction the evacuation starts from
 *
 * Result is one of
 *   { status: 'no_start' }      no start was given (null / undefined / '')
 *   { status: 'invalid_start' } start id is unknown, not a string, or an exit node
 *   { status: 'start_blocked' } start node is removed by the hazards
 *   { status: 'no_route' }      no open exit is reachable
 *   { status: 'ok', exitId, path, edgeIds, cost, exitOptions }
 *
 * Rules
 * - `cost` is the sum of the traversed edge costs. Never hop count, never coordinates.
 * - Blocked nodes, all edges touching them, blocked edges and closed exits are removed
 *   completely, so a closed exit can never be used as an intermediate node.
 * - Exit choice: minimum cost, ties broken by the lexicographically smallest exit id.
 * - Path choice: lexicographically smallest sequence of node ids.
 * - All id comparisons use the plain `<` operator on strings, never `localeCompare` and
 *   never a numeric compare, so "E10" sorts before "E2".
 */

/** Node types a person is allowed to start from. */
const STARTABLE_TYPES = new Set(['room', 'junction']);
const EXIT_TYPE = 'exit';

/**
 * @returns {{status:'ok',exitId:string,path:string[],edgeIds:string[],cost:number,
 *            exitOptions:{exitId:string,cost:number}[]}}
 *   | {{status:'no_start'|'invalid_start'|'start_blocked'|'no_route'}}
 */
export function computeRoute(graph, hazards, startId) {
  const active = normalizeHazards(hazards);
  const { nodesById, adjacency, exits } = indexGraph(graph);

  if (startId === null || startId === undefined || startId === '') return { status: 'no_start' };
  if (typeof startId !== 'string') return { status: 'invalid_start' };

  const startNode = nodesById.get(startId);
  // Exits are destinations, never origins, and an unknown id is not a valid origin.
  if (!startNode || startNode.type === EXIT_TYPE) return { status: 'invalid_start' };
  if (isNodeRemoved(startId, active)) return { status: 'start_blocked' };

  const usable = buildUsableAdjacency(adjacency, nodesById, active);

  const distFromStart = dijkstra(usable, startId);
  const exitOptions = [];
  for (const exitId of exits) {
    if (distFromStart.has(exitId)) exitOptions.push({ exitId, cost: distFromStart.get(exitId) });
  }
  exitOptions.sort(compareByCostThenId);
  if (exitOptions.length === 0) return { status: 'no_route' };

  const target = exitOptions[0];
  const distFromExit = dijkstra(usable, target.exitId);
  const route = rebuildPath(usable, distFromExit, startId, target.exitId);
  // Unreachable in practice: the exit is reachable from the start in an undirected graph,
  // so a shortest path back from it always exists.
  if (!route) return { status: 'no_route' };

  return {
    status: 'ok',
    exitId: target.exitId,
    path: route.path,
    edgeIds: route.edgeIds,
    cost: route.cost,
    exitOptions,
  };
}

/**
 * True when `id` may be used as the start of an evacuation: a known room or junction that
 * the hazards have not removed. Exits and unknown ids are never selectable.
 *
 * @param {object} graph normalized graph
 * @param {{blockedNodes?:Set,blockedEdges?:Set,closedExits?:Set}} hazards
 * @param {string} id
 * @returns {boolean}
 */
export function isSelectableStart(graph, hazards, id) {
  if (typeof id !== 'string' || id === '') return false;
  const active = normalizeHazards(hazards);
  const node = indexGraph(graph).nodesById.get(id);
  if (!node || !STARTABLE_TYPES.has(node.type)) return false;
  return !isNodeRemoved(id, active);
}

/** Blocked rooms/junctions and closed exits are removed; so is everything they touch. */
function isNodeRemoved(nodeId, hazards) {
  return hazards.blockedNodes.has(nodeId) || hazards.closedExits.has(nodeId);
}

/** Missing hazard sets default to empty; plain arrays are accepted for convenience. */
function normalizeHazards(hazards) {
  const source = isRecord(hazards) ? hazards : {};
  return {
    blockedNodes: toSet(source.blockedNodes),
    blockedEdges: toSet(source.blockedEdges),
    closedExits: toSet(source.closedExits),
  };
}

function toSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

/**
 * Reads a graph into the lookups the solver needs. Works both with the normalized output of
 * validateBuilding() and with a bare `{ nodes, edges }` object, so small ad hoc graphs can
 * be passed in without a validation step.
 */
function indexGraph(graph) {
  const source = isRecord(graph) ? graph : {};
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const nodesById = source.nodesById instanceof Map ? source.nodesById : indexNodes(nodes);
  const adjacency =
    source.adjacency instanceof Map
      ? source.adjacency
      : buildAdjacency(nodesById, Array.isArray(source.edges) ? source.edges : []);
  return { nodesById, adjacency, exits: collectExits(nodes, nodesById) };
}

/** First occurrence wins, mirroring the duplicate-id rule of the validator. */
function indexNodes(nodes) {
  const nodesById = new Map();
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || node.id === '') continue;
    if (!nodesById.has(node.id)) nodesById.set(node.id, node);
  }
  return nodesById;
}

function collectExits(nodes, nodesById) {
  const exits = [];
  const seen = new Set();
  for (const node of nodes) {
    if (!isRecord(node) || node.type !== EXIT_TYPE) continue;
    const id = node.id;
    if (typeof id !== 'string' || id === '' || seen.has(id) || !nodesById.has(id)) continue;
    seen.add(id);
    exits.push(id);
  }
  return exits;
}

function buildAdjacency(nodesById, edges) {
  const adjacency = new Map();
  for (const id of nodesById.keys()) adjacency.set(id, []);
  for (const edge of edges) {
    if (!isRecord(edge)) continue;
    const { id: edgeId, from, to, cost } = edge;
    if (typeof edgeId !== 'string' || edgeId === '') continue;
    if (typeof from !== 'string' || typeof to !== 'string' || from === to) continue;
    if (!nodesById.has(from) || !nodesById.has(to)) continue;
    if (!Number.isInteger(cost) || cost <= 0) continue;
    adjacency.get(from).push({ to, edgeId, cost });
    adjacency.get(to).push({ to: from, edgeId, cost });
  }
  return adjacency;
}

/**
 * Copies the adjacency, dropping every removed node (with all of its edges), every blocked
 * edge, and every closed exit. Because exits are dropped as nodes they cannot be traversed
 * as intermediate steps.
 */
function buildUsableAdjacency(adjacency, nodesById, hazards) {
  const usable = new Map();
  for (const id of nodesById.keys()) {
    if (!isNodeRemoved(id, hazards)) usable.set(id, []);
  }
  for (const [nodeId] of usable) {
    const kept = [];
    for (const link of adjacency.get(nodeId) ?? []) {
      if (hazards.blockedEdges.has(link.edgeId)) continue;
      if (!usable.has(link.to)) continue;
      kept.push(link);
    }
    usable.set(nodeId, kept);
  }
  return usable;
}

/**
 * Dijkstra over the usable graph.
 * @returns {Map<string, number>} distance per reachable node (absent = unreachable).
 */
function dijkstra(adjacency, sourceId) {
  const dist = new Map();
  if (!adjacency.has(sourceId)) return dist;

  dist.set(sourceId, 0);
  const heap = [{ id: sourceId, dist: 0 }];
  while (heap.length > 0) {
    const current = heapPop(heap);
    const best = dist.get(current.id);
    if (best === undefined || current.dist > best) continue; // stale entry
    for (const link of adjacency.get(current.id) ?? []) {
      const next = current.dist + link.cost;
      const known = dist.get(link.to);
      if (known !== undefined && known <= next) continue;
      dist.set(link.to, next);
      heapPush(heap, { id: link.to, dist: next });
    }
  }
  return dist;
}

/**
 * Walks from `startId` towards `exitId` following `distFromExit`, which is Dijkstra from the
 * exit, and always takes the smallest node id that keeps the remaining cost optimal. Because
 * every step fixes the smallest possible id at the first position where two shortest paths
 * can still differ, this yields the lexicographically smallest shortest path.
 */
function rebuildPath(adjacency, distFromExit, startId, exitId) {
  const path = [startId];
  const edgeIds = [];
  let cost = 0;
  let current = startId;

  while (current !== exitId) {
    const remaining = distFromExit.get(current);
    let chosen = null;
    for (const link of adjacency.get(current) ?? []) {
      const rest = distFromExit.get(link.to);
      if (rest === undefined || remaining !== link.cost + rest) continue;
      if (chosen === null || link.to < chosen.to) chosen = link;
    }
    if (chosen === null) return null;
    path.push(chosen.to);
    edgeIds.push(chosen.edgeId);
    cost += chosen.cost;
    current = chosen.to;
  }

  return { path, edgeIds, cost };
}

/** Sort by cost, then by id. Plain `<` on strings: "E10" < "E2". */
function compareByCostThenId(a, b) {
  if (a.cost !== b.cost) return a.cost - b.cost;
  if (a.exitId === b.exitId) return 0;
  return a.exitId < b.exitId ? -1 : 1;
}

/* ------------------------------------------------------------------ *
 * Binary min-heap keyed on distance. Ties keep insertion order, which
 * makes runs reproducible without changing the result.
 * ------------------------------------------------------------------ */

function heapPush(heap, item) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (heap[parent].dist <= heap[index].dist) break;
    swap(heap, parent, index);
    index = parent;
  }
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && heap[left].dist < heap[smallest].dist) smallest = left;
      if (right < heap.length && heap[right].dist < heap[smallest].dist) smallest = right;
      if (smallest === index) break;
      swap(heap, index, smallest);
      index = smallest;
    }
  }
  return top;
}

function swap(list, a, b) {
  const tmp = list[a];
  list[a] = list[b];
  list[b] = tmp;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}