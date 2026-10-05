/**
 * Smart Escape - engine and validator tests.
 *
 * Run with:  node tests/engine.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE } from '../js/sample.js';
import { validateBuilding, LIMITS } from '../js/validate.js';
import { computeRoute, isSelectableStart } from '../js/engine.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function hazards({ blockedNodes = [], blockedEdges = [], closedExits = [] } = {}) {
  return {
    blockedNodes: new Set(blockedNodes),
    blockedEdges: new Set(blockedEdges),
    closedExits: new Set(closedExits),
  };
}

/** Validates and returns the normalized graph, failing loudly when it is not valid. */
function graphOf(data) {
  const result = validateBuilding(data);
  assert.ok(result.ok, `expected valid data, got ${JSON.stringify(result.errors)}`);
  return result.graph;
}

function routeOf(data, hazardSpec, startId) {
  return computeRoute(graphOf(data), hazardSpec, startId);
}

function sampleRoute(hazardSpec, startId) {
  return routeOf(SAMPLE, hazardSpec, startId);
}

/**
 * Minimal building for routing fixtures. Coordinates are drawing-only, so they are generated:
 * nodes are [id, type] and edges are [id, from, to, cost].
 */
function fixture(nodeSpecs, edgeSpecs) {
  return {
    building: 'Fixture Building',
    nodes: nodeSpecs.map(([id, type], index) => ({
      id,
      label: `${type} ${id}`,
      type,
      x: index * 10,
      y: 0,
    })),
    edges: edgeSpecs.map(([id, from, to, cost]) => ({ id, from, to, cost })),
    initial_state: { blocked_nodes: [], blocked_edges: [], closed_exits: [] },
  };
}

/** Smallest valid building, used as the mutation base for the validator tests. */
function validBuilding() {
  return {
    building: 'Test Wing',
    nodes: [
      { id: 'R1', label: 'Room 1', type: 'room', x: 0, y: 0 },
      { id: 'C1', label: 'Corridor', type: 'junction', x: 50, y: 0 },
      { id: 'E1', label: 'Main Exit', type: 'exit', x: 100, y: 0 },
    ],
    edges: [
      { id: 'L1', from: 'R1', to: 'C1', cost: 1 },
      { id: 'L2', from: 'C1', to: 'E1', cost: 2 },
    ],
    initial_state: { blocked_nodes: [], blocked_edges: [], closed_exits: [] },
  };
}

const codesOf = (result) => result.errors.map((error) => error.code);

/** Mutates a clone of validBuilding() and asserts the validator reports `code`. */
function expectError(mutate, code) {
  const data = validBuilding();
  mutate(data);
  const result = validateBuilding(data);
  assert.equal(result.ok, false, 'expected the mutated data to be rejected');
  assert.ok(
    codesOf(result).includes(code),
    `expected ${code}, got ${JSON.stringify(result.errors)}`,
  );
  return result;
}

/* ------------------------------------------------------------------ *
 * Routing on SAMPLE
 * ------------------------------------------------------------------ */

test('baseline: R1 evacuates through E1 with cost 7', () => {
  const route = sampleRoute(hazards(), 'R1');
  assert.deepEqual(route, {
    status: 'ok',
    exitId: 'E1',
    path: ['R1', 'C1', 'C2', 'E1'],
    edgeIds: ['L01', 'L02', 'L03'],
    cost: 7,
    exitOptions: [
      { exitId: 'E1', cost: 7 },
      // R1,C1,C2,C4,E2 = 2+3+3+2: cheaper than every R2/C3 route.
      { exitId: 'E2', cost: 10 },
    ],
  });
});

test('blocking C2 reroutes R1 to E2 and the equal-cost alternative loses on node id', () => {
  const route = sampleRoute(hazards({ blockedNodes: ['C2'] }), 'R1');
  // R1,C1,C3,C4,E2 (2+4+3+2) and R1,R2,C3,C4,E2 (4+2+3+2) both cost 11.
  assert.equal(route.status, 'ok');
  assert.equal(route.exitId, 'E2');
  assert.equal(route.cost, 11);
  assert.deepEqual(route.path, ['R1', 'C1', 'C3', 'C4', 'E2']);
  assert.deepEqual(route.edgeIds, ['L01', 'L08', 'L06', 'L07']);
  assert.deepEqual(route.exitOptions, [{ exitId: 'E2', cost: 11 }]);
  assert.equal(4 + 2 + 3 + 2, route.cost, 'the rejected alternative really had the same cost');
});

test('closing both exits yields no_route', () => {
  assert.deepEqual(sampleRoute(hazards({ closedExits: ['E1', 'E2'] }), 'R1'), { status: 'no_route' });
  assert.deepEqual(sampleRoute(hazards({ closedExits: ['E1', 'E2'] }), 'R2'), { status: 'no_route' });
});

test('baseline: R2 evacuates through E2 with cost 7', () => {
  const route = sampleRoute(hazards(), 'R2');
  assert.equal(route.status, 'ok');
  assert.equal(route.exitId, 'E2');
  assert.equal(route.cost, 7);
  assert.deepEqual(route.path, ['R2', 'C3', 'C4', 'E2']);
  assert.deepEqual(route.edgeIds, ['L05', 'L06', 'L07']);
  assert.deepEqual(route.exitOptions, [
    { exitId: 'E2', cost: 7 },
    { exitId: 'E1', cost: 10 },
  ]);
});

test('blocking only edge L02 keeps E1 reachable but loses the cost comparison', () => {
  const route = sampleRoute(hazards({ blockedEdges: ['L02'] }), 'R1');
  assert.equal(route.status, 'ok');
  assert.equal(route.exitId, 'E2');
  assert.equal(route.cost, 11);
  assert.deepEqual(route.path, ['R1', 'C1', 'C3', 'C4', 'E2']);
  assert.deepEqual(route.edgeIds, ['L01', 'L08', 'L06', 'L07']);
  // E1 survives through C3-C4-C2 (2+4+3+3+2) but is more expensive than E2.
  assert.deepEqual(route.exitOptions, [
    { exitId: 'E2', cost: 11 },
    { exitId: 'E1', cost: 14 },
  ]);
});

test('blocking the start node yields start_blocked', () => {
  assert.deepEqual(sampleRoute(hazards({ blockedNodes: ['R1'] }), 'R1'), { status: 'start_blocked' });
  assert.deepEqual(sampleRoute(hazards({ blockedNodes: ['C3'] }), 'C3'), { status: 'start_blocked' });
});

test('a missing start yields no_start and an unusable start yields invalid_start', () => {
  const graph = graphOf(SAMPLE);
  for (const missing of [undefined, null, '']) {
    assert.deepEqual(computeRoute(graph, hazards(), missing), { status: 'no_start' });
  }
  for (const bad of ['E1', 'nope', 42, 'R1 ']) {
    assert.deepEqual(computeRoute(graph, hazards(), bad), { status: 'invalid_start' });
  }
});

/* ------------------------------------------------------------------ *
 * Tie-breaking and removal rules on purpose built fixtures
 * ------------------------------------------------------------------ */

test('exit tie: two exits at the same cost pick the smallest id', () => {
  const data = fixture(
    [
      ['R1', 'room'],
      ['C1', 'junction'],
      ['E1', 'exit'],
      ['E2', 'exit'],
    ],
    [
      ['L1', 'R1', 'C1', 5],
      ['L2', 'C1', 'E1', 5],
      ['L3', 'C1', 'E2', 5],
    ],
  );
  const route = routeOf(data, hazards(), 'R1');
  assert.equal(route.exitId, 'E1');
  assert.equal(route.cost, 10);
  assert.deepEqual(route.exitOptions, [
    { exitId: 'E1', cost: 10 },
    { exitId: 'E2', cost: 10 },
  ]);
});

test('exit id ordering is plain string comparison, so E10 beats E2', () => {
  const data = fixture(
    [
      ['R1', 'room'],
      ['C1', 'junction'],
      ['E10', 'exit'],
      ['E2', 'exit'],
    ],
    [
      ['L1', 'R1', 'C1', 5],
      ['L2', 'C1', 'E10', 5],
      ['L3', 'C1', 'E2', 5],
    ],
  );
  const route = routeOf(data, hazards(), 'R1');
  assert.ok('E10' < 'E2', 'plain string comparison puts E10 first');
  assert.equal(route.exitId, 'E10');
  assert.deepEqual(
    route.exitOptions.map((option) => option.exitId),
    ['E10', 'E2'],
  );
});

test('equal cost paths pick the lexicographically smallest node id sequence', () => {
  const data = fixture(
    [
      ['R1', 'room'],
      ['A', 'junction'],
      ['B', 'junction'],
      ['E1', 'exit'],
    ],
    [
      ['L1', 'R1', 'A', 1],
      ['L2', 'R1', 'B', 1],
      ['L3', 'A', 'E1', 1],
      ['L4', 'B', 'E1', 1],
    ],
  );
  const route = routeOf(data, hazards(), 'R1');
  assert.equal(route.cost, 2);
  assert.deepEqual(route.path, ['R1', 'A', 'E1']);
  assert.deepEqual(route.edgeIds, ['L1', 'L3']);
});

test('the smaller node id wins even when its path has more hops', () => {
  // R1,A,X,E1 (1+1+1) and R1,B,E1 (1+2) both cost 3; the lexicographically smaller
  // sequence wins even though it is longer, proving hop count is not the tie breaker.
  const data = fixture(
    [
      ['R1', 'room'],
      ['A', 'junction'],
      ['B', 'junction'],
      ['X', 'junction'],
      ['E1', 'exit'],
    ],
    [
      ['L1', 'R1', 'A', 1],
      ['L2', 'A', 'X', 1],
      ['L3', 'X', 'E1', 1],
      ['L4', 'R1', 'B', 1],
      ['L5', 'B', 'E1', 2],
    ],
  );
  const route = routeOf(data, hazards(), 'R1');
  assert.equal(route.cost, 3);
  assert.deepEqual(route.path, ['R1', 'A', 'X', 'E1']);
});

test('a closed exit cannot be used as an intermediate node', () => {
  const data = fixture(
    [
      ['R1', 'room'],
      ['C1', 'junction'],
      ['E1', 'exit'],
      ['E2', 'exit'],
    ],
    [
      ['L1', 'R1', 'C1', 2],
      ['L2', 'C1', 'E1', 3],
      ['L3', 'E1', 'E2', 2],
    ],
  );
  const open = routeOf(data, hazards(), 'R1');
  assert.equal(open.status, 'ok');
  assert.equal(open.exitId, 'E1');
  assert.deepEqual(open.path, ['R1', 'C1', 'E1']);

  // E1 is the only bridge to E2, so closing it must remove it entirely.
  assert.deepEqual(routeOf(data, hazards({ closedExits: ['E1'] }), 'R1'), { status: 'no_route' });
});

test('a disconnected graph reports no_route instead of a wrong answer', () => {
  const data = fixture(
    [
      ['R1', 'room'],
      ['C1', 'junction'],
      ['C2', 'junction'],
      ['E1', 'exit'],
    ],
    [
      ['L1', 'R1', 'C1', 1],
      ['L2', 'C2', 'E1', 1],
    ],
  );
  const result = validateBuilding(data);
  assert.equal(result.ok, true, 'a disconnected graph is schema valid');
  // R1/C1 sit in the component without any exit.
  assert.deepEqual(computeRoute(result.graph, hazards(), 'R1'), { status: 'no_route' });
  assert.deepEqual(computeRoute(result.graph, hazards(), 'C1'), { status: 'no_route' });
  // The other component still routes normally, proving only reachability is missing.
  assert.deepEqual(computeRoute(result.graph, hazards(), 'C2'), {
    status: 'ok',
    exitId: 'E1',
    path: ['C2', 'E1'],
    edgeIds: ['L2'],
    cost: 1,
    exitOptions: [{ exitId: 'E1', cost: 1 }],
  });
});

test('cost is the sum of edge costs, never hop count or coordinates', () => {
  const cheap = fixture(
    [
      ['R1', 'room'],
      ['A', 'junction'],
      ['B', 'junction'],
      ['E1', 'exit'],
    ],
    [
      ['L1', 'R1', 'A', 1],
      ['L2', 'A', 'B', 1],
      ['L3', 'B', 'E1', 1],
      ['L4', 'R1', 'E1', 50],
    ],
  );
  const route = routeOf(cheap, hazards(), 'R1');
  assert.deepEqual(route.path, ['R1', 'A', 'B', 'E1'], '3 hops beat the direct 1 hop link');
  assert.equal(route.cost, 3);

  // Same topology, wildly different coordinates: routing must not change.
  const moved = fixture(
    [
      ['R1', 'room'],
      ['A', 'junction'],
      ['B', 'junction'],
      ['E1', 'exit'],
    ],
    [
      ['L1', 'R1', 'A', 1],
      ['L2', 'A', 'B', 1],
      ['L3', 'B', 'E1', 1],
      ['L4', 'R1', 'E1', 50],
    ],
  );
  for (const node of moved.nodes) {
    node.x = node.x * 977 + 12345;
    node.y = node.y * 613 + 54321;
  }
  assert.deepEqual(routeOf(moved, hazards(), 'R1'), route);
});

/* ------------------------------------------------------------------ *
 * isSelectableStart
 * ------------------------------------------------------------------ */

test('isSelectableStart accepts rooms and junctions only', () => {
  const graph = graphOf(SAMPLE);
  assert.equal(isSelectableStart(graph, hazards(), 'R1'), true);
  assert.equal(isSelectableStart(graph, hazards(), 'C4'), true);
  assert.equal(isSelectableStart(graph, hazards(), 'E1'), false, 'an exit is a destination');
  assert.equal(isSelectableStart(graph, hazards(), 'e1'), false, 'ids are case sensitive');
  assert.equal(isSelectableStart(graph, hazards(), 'nope'), false);
  assert.equal(isSelectableStart(graph, hazards(), ''), false);
  assert.equal(isSelectableStart(graph, hazards(), undefined), false);
  assert.equal(isSelectableStart(graph, hazards({ blockedNodes: ['R2'] }), 'R2'), false);
  assert.equal(isSelectableStart(graph, hazards(), 'R2'), true);
});

test('a blocked start is never selectable, and selected starts agree with computeRoute', () => {
  const graph = graphOf(SAMPLE);
  for (const id of graph.startable) {
    assert.equal(isSelectableStart(graph, hazards({ blockedNodes: [id] }), id), false);
    assert.equal(computeRoute(graph, hazards({ blockedNodes: [id] }), id).status, 'start_blocked');
  }
});

/* ------------------------------------------------------------------ *
 * Validator
 * ------------------------------------------------------------------ */

test('validateBuilding accepts SAMPLE', () => {
  const result = validateBuilding(SAMPLE);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.graph, 'a valid building always produces a graph');
  assert.equal(result.graph.building, 'East Annex - Practice Building');
  assert.deepEqual(result.graph.nodes.map((node) => node.id), ['R1', 'R2', 'C1', 'C2', 'C3', 'C4', 'E1', 'E2']);
  assert.deepEqual(result.graph.edges.map((edge) => edge.id), [
    'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09',
  ]);
  assert.deepEqual(result.graph.exits, ['E1', 'E2']);
  assert.deepEqual(result.graph.startable, ['R1', 'R2', 'C1', 'C2', 'C3', 'C4']);
  assert.ok(result.graph.initialState.blockedNodes instanceof Set);
  // The normalized graph feeds the engine with no extra work.
  assert.equal(computeRoute(result.graph, result.graph.initialState, 'R1').cost, 7);
});

/** Builds a building with `nodeCount` nodes and `edgeCount` unique undirected edges. */
function makeBuilding(nodeCount, edgeCount) {
  const nodes = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const type = i === 0 ? 'room' : i === nodeCount - 1 ? 'exit' : 'junction';
    nodes.push({ id: `N${i}`, label: `Node ${i}`, type, x: i, y: 0 });
  }
  const edges = [];
  for (let a = 0; a < nodeCount && edges.length < edgeCount; a += 1) {
    for (let b = a + 1; b < nodeCount && edges.length < edgeCount; b += 1) {
      edges.push({ id: `L${edges.length}`, from: `N${a}`, to: `N${b}`, cost: 1 });
    }
  }
  return {
    building: 'Generated Building',
    nodes,
    edges,
    initial_state: { blocked_nodes: [], blocked_edges: [], closed_exits: [] },
  };
}

test('rejects a non-object payload', () => {
  for (const value of [null, undefined, 'a string', 42, ['a', 'list'], true]) {
    const result = validateBuilding(value);
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'DATA_NOT_OBJECT');
    assert.equal(result.graph, null);
  }
});

test('rejects missing required fields', () => {
  for (const field of ['building', 'nodes', 'edges', 'initial_state']) {
    expectError((data) => delete data[field], 'MISSING_FIELD');
  }
});

test('rejects an empty building name', () => {
  expectError((data) => { data.building = ''; }, 'BUILDING_NAME_EMPTY');
  expectError((data) => { data.building = '   '; }, 'BUILDING_NAME_EMPTY');
  expectError((data) => { data.building = 42; }, 'BUILDING_NAME_INVALID');
});

test('rejects unknown endpoints, self loops, repeated pairs and bad costs', () => {
  expectError((data) => { data.edges[0].from = 'ZZ'; }, 'EDGE_ENDPOINT_UNKNOWN');
  expectError((data) => { data.edges[0].to = undefined; }, 'EDGE_ENDPOINT_UNKNOWN');
  expectError((data) => { data.edges[0].from = 'r1'; }, 'EDGE_ENDPOINT_UNKNOWN');

  expectError((data) => { data.edges[0].to = 'R1'; }, 'EDGE_SELF_LOOP');

  // A-B and B-A are the same undirected edge.
  expectError((data) => { data.edges.push({ id: 'L9', from: 'C1', to: 'R1', cost: 1 }); }, 'EDGE_PAIR_DUPLICATE');
  expectError((data) => {
    data.edges[1].from = 'C1';
    data.edges[1].to = 'R1';
  }, 'EDGE_PAIR_DUPLICATE');
  const distinctPairs = validBuilding();
  distinctPairs.edges.push({ id: 'L9', from: 'R1', to: 'E1', cost: 1 });
  assert.equal(validateBuilding(distinctPairs).ok, true, 'distinct pairs are allowed');

  for (const cost of [0, -3, 1.5, '2', null, Number.NaN, Infinity, undefined]) {
    expectError((data) => { data.edges[0].cost = cost; }, 'EDGE_COST_INVALID');
  }
  expectError((data) => { delete data.edges[0].cost; }, 'EDGE_COST_INVALID');
});

test('rejects a building with no startable node or no exit', () => {
  expectError((data) => {
    data.nodes[0].type = 'exit';
    data.nodes[1].type = 'exit';
  }, 'NO_STARTABLE_NODE');

  expectError((data) => { data.nodes[2].type = 'junction'; }, 'NO_EXIT');
  expectError((data) => { data.nodes[2].type = 'stairs'; }, 'NO_EXIT');
});

test('rejects malformed initial_state and non array node/edge lists', () => {
  expectError((data) => { data.initial_state = 'none'; }, 'INITIAL_STATE_INVALID');
  expectError((data) => { data.initial_state = []; }, 'INITIAL_STATE_INVALID');
  expectError((data) => { delete data.initial_state.blocked_nodes; }, 'MISSING_FIELD');
  expectError((data) => { delete data.initial_state.closed_exits; }, 'MISSING_FIELD');
  expectError((data) => { data.initial_state.blocked_nodes = null; }, 'MISSING_FIELD');
  expectError((data) => { data.initial_state.blocked_edges = 'L1'; }, 'FIELD_NOT_ARRAY');
  expectError((data) => { data.nodes = 'not an array'; }, 'FIELD_NOT_ARRAY');
  expectError((data) => { data.edges = 7; }, 'FIELD_NOT_ARRAY');
});

test('rejects hazard ids that do not exist or have the wrong type', () => {
  expectError((data) => { data.initial_state.blocked_nodes = ['ZZ']; }, 'BLOCKED_NODE_UNKNOWN');
  expectError((data) => { data.initial_state.blocked_nodes = ['r1']; }, 'BLOCKED_NODE_UNKNOWN');
  expectError((data) => { data.initial_state.blocked_nodes = [42]; }, 'BLOCKED_NODE_UNKNOWN');
  expectError((data) => { data.initial_state.blocked_nodes = ['E1']; }, 'BLOCKED_NODE_NOT_TRAVERSABLE');
  expectError((data) => { data.initial_state.blocked_edges = ['LX']; }, 'BLOCKED_EDGE_UNKNOWN');
  expectError((data) => { data.initial_state.blocked_edges = ['R1']; }, 'BLOCKED_EDGE_UNKNOWN');
  expectError((data) => { data.initial_state.closed_exits = ['E9']; }, 'CLOSED_EXIT_UNKNOWN');
  expectError((data) => { data.initial_state.closed_exits = ['R1']; }, 'CLOSED_EXIT_NOT_EXIT');
  expectError((data) => { data.initial_state.closed_exits = ['C1']; }, 'CLOSED_EXIT_NOT_EXIT');

  const withHazards = validBuilding();
  withHazards.initial_state = { blocked_nodes: ['C1'], blocked_edges: ['L2'], closed_exits: ['E1'] };
  assert.equal(validateBuilding(withHazards).ok, true, 'valid hazard ids are accepted');
});

test('collects at most LIMITS.MAX_ERRORS errors', () => {
  const data = validBuilding();
  data.nodes = Array.from({ length: 20 }, (_, i) => ({ id: `N${i}`, label: '', type: 'room', x: 0, y: 0 }));
  const result = validateBuilding(data);
  assert.equal(result.ok, false);
  assert.equal(LIMITS.MAX_ERRORS, 10);
  assert.equal(result.errors.length, LIMITS.MAX_ERRORS, 'errors are capped at 10');
});

test('a disconnected graph passes validation', () => {
  const data = fixture(
    [
      ['R1', 'room'],
      ['C1', 'junction'],
      ['E1', 'exit'],
      ['R2', 'room'],
      ['E2', 'exit'],
    ],
    [
      ['L1', 'R1', 'C1', 1],
      ['L2', 'C1', 'E1', 1],
      ['L3', 'R2', 'E2', 1],
    ],
  );
  const result = validateBuilding(data);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.errors.length, 0);
});

test('rejects out of range node and edge counts, and accepts the boundaries', () => {
  const tooFew = validateBuilding(makeBuilding(1, 1));
  assert.equal(tooFew.ok, false);
  assert.ok(codesOf(tooFew).includes('NODE_COUNT_OUT_OF_RANGE'));

  const tooManyNodes = validateBuilding(makeBuilding(61, 5));
  assert.equal(tooManyNodes.ok, false);
  assert.equal(tooManyNodes.errors.find((e) => e.code === 'NODE_COUNT_OUT_OF_RANGE').params.max, 60);

  const tooManyEdges = validateBuilding(makeBuilding(23, 151));
  assert.equal(tooManyEdges.ok, false);
  assert.equal(tooManyEdges.errors.find((e) => e.code === 'EDGE_COUNT_OUT_OF_RANGE').params.max, 150);

  const noEdges = validateBuilding(makeBuilding(3, 0));
  assert.equal(noEdges.ok, false);
  assert.ok(codesOf(noEdges).includes('EDGE_COUNT_OUT_OF_RANGE'));

  assert.equal(validateBuilding(makeBuilding(2, 1)).ok, true, 'minimum sizes are valid');
  assert.equal(validateBuilding(makeBuilding(60, 150)).ok, true, 'maximum sizes are valid');
});

test('rejects duplicate node and edge ids, case sensitive', () => {
  expectError((data) => { data.nodes.push({ ...data.nodes[0] }); }, 'DUPLICATE_NODE_ID');
  expectError((data) => { data.edges.push({ ...data.edges[0] }); }, 'DUPLICATE_EDGE_ID');
  expectError((data) => { data.nodes[1].id = data.nodes[0].id; }, 'DUPLICATE_NODE_ID');

  const caseSensitive = validBuilding();
  caseSensitive.nodes.push({ id: 'r1', label: 'Lower Case Room', type: 'room', x: 1, y: 1 });
  assert.equal(validateBuilding(caseSensitive).ok, true, "'R1' and 'r1' are different nodes");
});

test('rejects bad labels, types, coordinates and node ids', () => {
  expectError((data) => { data.nodes[0].label = ''; }, 'NODE_LABEL_INVALID');
  expectError((data) => { data.nodes[0].label = '   '; }, 'NODE_LABEL_INVALID');
  expectError((data) => { data.nodes[0].label = 42; }, 'NODE_LABEL_INVALID');
  expectError((data) => { delete data.nodes[0].label; }, 'NODE_LABEL_INVALID');
  expectError((data) => { data.nodes[0].type = 'hall'; }, 'NODE_TYPE_INVALID');
  expectError((data) => { data.nodes[0].type = 'Room'; }, 'NODE_TYPE_INVALID');
  expectError((data) => { data.nodes[0].x = Number.NaN; }, 'NODE_COORDINATES_INVALID');
  expectError((data) => { data.nodes[0].x = Infinity; }, 'NODE_COORDINATES_INVALID');
  expectError((data) => { data.nodes[0].y = '10'; }, 'NODE_COORDINATES_INVALID');
  expectError((data) => { delete data.nodes[0].y; }, 'NODE_COORDINATES_INVALID');
  expectError((data) => { data.nodes[0].id = ''; }, 'NODE_ID_INVALID');
});