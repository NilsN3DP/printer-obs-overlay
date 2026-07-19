import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLive, parseFile } from '../gcode-meta.js';

const sample = Buffer.from(`M73 P10 R20
T0
;LAYER_CHANGE
M73 P20 R15
T1
;LAYER_CHANGE
M73 P20 R14
T2
; filament_type = PLA;PETG;ASA
; filament_colour = #ff0000;#00ff00;#0000ff
; filament_multitool_ramming = 1;1;1
; filament_multitool_ramming_volume = 10;20;30
; filament_density = 1;1;1
; total toolchanges = 2
; total filament used [g] = 10
`);

test('remaining time distinguishes tool changes in the same progress percent', () => {
  const meta = parseFile(sample);

  const beforeSecond = computeLive(meta, 20, { timeRemainingSec: 15 * 60 + 20 });
  assert.equal(beforeSecond.tool, 2);
  assert.equal(beforeSecond.filament_changes, 1);
  assert.equal(beforeSecond.material, 'PETG');

  const afterSecond = computeLive(meta, 20, { timeRemainingSec: 13 * 60 });
  assert.equal(afterSecond.tool, 3);
  assert.equal(afterSecond.filament_changes, 2);
});

test('ramming waste follows the tool that was unloaded', () => {
  const meta = parseFile(sample);
  assert.deepEqual(meta.wasteByChange.map((grams) => Number(grams.toFixed(3))), [0.01, 0.02]);
  assert.equal(Number(meta.wasteTotalG.toFixed(3)), 0.03);

  const live = computeLive(meta, 20, { timeRemainingSec: 15 * 60 + 20 });
  assert.equal(live.waste_g, 0.01);
  assert.equal(live.waste_total_g, 0.03);
});

test('explicit slicer waste remains authoritative and is distributed across changes', () => {
  const withExplicitWaste = Buffer.concat([sample, Buffer.from('; purge waste [g] = 3\n')]);
  const meta = parseFile(withExplicitWaste);
  assert.equal(meta.wasteTotalG, 3);
  assert.equal(Number(meta.wasteByChange.reduce((sum, grams) => sum + grams, 0).toFixed(3)), 3);

  const finished = computeLive(meta, 20, { timeRemainingSec: 13 * 60 });
  assert.equal(finished.waste_g, 3);
  assert.equal(finished.waste_total_g, 3);
});
