/**
 * Smart Escape - UI state layer tests (js/main.js without a DOM).
 *
 * run with:  node tests/ui.test.mjs
 *
 * main.js guards every document access, so importing it in Node gives us the real
 * interaction logic (start picking, hazard toggling, reset, failed imports) to assert on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  state,
  loadSample,
  adoptBuilding,
  onNodeActivate,
  onEdgeActivate,
  onUndo,
  resetHazards,
} from '../js/main.js';
import { SAMPLE } from '../js/sample.js';

/** Fresh sample building with no start selected and the default interaction mode. */
function fresh() {
  loadSample();
  state.mode = 'start';
}

test('startup state: sample loaded, hazards from initial_state, no start', () => {
  fresh();
  assert.equal(state.graph.building, SAMPLE.building);
  assert.equal(state.startId, null);
  assert.equal(state.mode, 'start');
  assert.deepEqual([...state.hazards.blockedNodes], []);
  assert.equal(state.result.status, 'no_start');
  assert.deepEqual(state.errors, []);
});

test('check 1: select R1 -> cost 7 via R1,C1,C2,E1', () => {
  fresh();
  onNodeActivate('R1');
  assert.equal(state.result.status, 'ok');
  assert.equal(state.result.cost, 7);
  assert.deepEqual(state.result.path, ['R1', 'C1', 'C2', 'E1']);
  assert.deepEqual(state.result.edgeIds, ['L01', 'L02', 'L03']);
  assert.equal(state.startId, 'R1');
});

test('check 2: block C2 (hazard mode) -> cost 11 via R1,C1,C3,C4,E2', () => {
  fresh();
  onNodeActivate('R1'); // pick start first, while still in start mode
  state.mode = 'hazard';
  onNodeActivate('C2'); // junction click blocks it
  assert.ok(state.hazards.blockedNodes.has('C2'));
  assert.equal(state.result.status, 'ok');
  assert.equal(state.result.cost, 11);
  assert.deepEqual(state.result.path, ['R1', 'C1', 'C3', 'C4', 'E2']);
  assert.deepEqual(state.result.edgeIds, ['L01', 'L08', 'L06', 'L07']);
});

test('start mode refuses exits and blocked nodes without changing the start', () => {
  fresh();
  onNodeActivate('R1');
  onNodeActivate('E1'); // exit -> toast only
  assert.equal(state.startId, 'R1');
  state.mode = 'hazard';
  onNodeActivate('R2'); // block R2
  state.mode = 'start';
  onNodeActivate('R2'); // blocked -> toast only
  assert.equal(state.startId, 'R1');
});

test('blocking the start node reports start_blocked', () => {
  fresh();
  onNodeActivate('R1');
  state.mode = 'hazard';
  onNodeActivate('R1');
  assert.equal(state.result.status, 'start_blocked');
  onUndo('node', 'R1'); // chip undo reopens it
  assert.equal(state.result.status, 'ok');
  assert.equal(state.result.cost, 7);
});

test('hazard mode: exit click closes/reopens, edge click blocks/unblocks', () => {
  fresh();
  onNodeActivate('R1');
  state.mode = 'hazard';
  onNodeActivate('E1');
  assert.ok(state.hazards.closedExits.has('E1'));
  assert.equal(state.result.exitId, 'E2'); // only open reachable exit left
  onUndo('exit', 'E1');
  assert.equal(state.result.exitId, 'E1');

  onEdgeActivate('L02');
  assert.ok(state.hazards.blockedEdges.has('L02'));
  onEdgeActivate('L02');
  assert.equal(state.hazards.blockedEdges.has('L02'), false);
  assert.equal(state.result.cost, 7);
});

test('edge clicks are ignored outside hazard mode', () => {
  fresh();
  onNodeActivate('R1');
  onEdgeActivate('L01');
  assert.equal(state.hazards.blockedEdges.has('L01'), false);
});

test('Reset restores the ORIGINAL initial_state and keeps the selected start', () => {
  fresh();
  state.mode = 'hazard';
  onNodeActivate('C2'); // block C2
  state.mode = 'start';
  onNodeActivate('R1'); // start at R1, forced to reroute
  assert.equal(state.result.cost, 11);

  resetHazards();
  assert.equal(state.startId, 'R1'); // kept
  assert.equal(state.hazards.blockedNodes.has('C2'), false); // restored to file state
  assert.equal(state.result.cost, 7);
});

test('failed import keeps the previous building and reports errors', () => {
  fresh();
  onNodeActivate('R1');
  const previousGraph = state.graph;

  adoptBuilding({ building: 'Broken', nodes: 'not-an-array' });
  assert.equal(state.graph, previousGraph); // untouched
  assert.equal(state.startId, 'R1');
  assert.ok(state.errors.length > 0);
  assert.ok(state.errors.some((error) => error.code === 'FIELD_NOT_ARRAY'));
  assert.equal(state.result.cost, 7); // still the old, valid result

  adoptBuilding(JSON.parse(JSON.stringify(SAMPLE))); // valid import replaces everything
  assert.deepEqual(state.errors, []);
  assert.equal(state.startId, null);
  assert.notEqual(state.graph, previousGraph);
  assert.equal(state.result.status, 'no_start');
});
