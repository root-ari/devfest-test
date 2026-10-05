/**
 * Smart Escape - sample building data.
 *
 * SAMPLE is the reference data set: the tests build their graphs from it and the UI can
 * fall back to it when no file is loaded.
 *
 * Notes
 * - `x` / `y` are drawing coordinates only. Routing never uses them; every route decision
 *   is driven by the integer `cost` of the traversed edges.
 * - The object is deep frozen so callers must clone before mutating (`structuredClone(SAMPLE)`).
 * - The layout is two horizontal rows (top: R1/C1/C2/E1, bottom: R2/C3/C4/E2) with vertical
 *   links L04, L05, L06, L08 and L09, which gives several equal-cost alternatives on purpose.
 */

const NODES = [
  { id: 'R1', label: 'Room 101', type: 'room', x: 60, y: 65 },
  { id: 'R2', label: 'Room 102', type: 'room', x: 60, y: 185 },
  { id: 'C1', label: 'Junction A', type: 'junction', x: 190, y: 65 },
  { id: 'C2', label: 'Junction B', type: 'junction', x: 325, y: 65 },
  { id: 'C3', label: 'Junction C', type: 'junction', x: 190, y: 185 },
  { id: 'C4', label: 'Junction D', type: 'junction', x: 325, y: 185 },
  { id: 'E1', label: 'North Exit', type: 'exit', x: 445, y: 65 },
  { id: 'E2', label: 'South Exit', type: 'exit', x: 445, y: 185 },
];

const EDGES = [
  { id: 'L01', from: 'R1', to: 'C1', cost: 2 },
  { id: 'L02', from: 'C1', to: 'C2', cost: 3 },
  { id: 'L03', from: 'C2', to: 'E1', cost: 2 },
  { id: 'L04', from: 'R1', to: 'R2', cost: 4 },
  { id: 'L05', from: 'R2', to: 'C3', cost: 2 },
  { id: 'L06', from: 'C3', to: 'C4', cost: 3 },
  { id: 'L07', from: 'C4', to: 'E2', cost: 2 },
  { id: 'L08', from: 'C1', to: 'C3', cost: 4 },
  { id: 'L09', from: 'C2', to: 'C4', cost: 3 },
];

export const SAMPLE = deepFreeze({
  building: 'East Annex - Practice Building',
  nodes: NODES,
  edges: EDGES,
  initial_state: { blocked_nodes: [], blocked_edges: [], closed_exits: [] },
});

/** @returns {*} the argument, frozen recursively (frozen arrays/objects only). */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}