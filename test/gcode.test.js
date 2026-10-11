import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLive } from '../src/server/telemetry/gcode/live.js';
import { parseFile, summarizeMeta } from '../src/server/telemetry/gcode/parse.js';

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

test('Restzeit unterscheidet Toolwechsel innerhalb desselben Prozents', () => {
  const meta = parseFile(sample);

  const beforeSecond = computeLive(meta, 20, { timeRemainingSec: 15 * 60 + 20 });
  assert.equal(beforeSecond.tool, 2);
  assert.equal(beforeSecond.filament_changes, 1);
  assert.equal(beforeSecond.material, 'PETG');
  assert.equal(beforeSecond.filament_color, '#00ff00');

  const afterSecond = computeLive(meta, 20, { timeRemainingSec: 13 * 60 });
  assert.equal(afterSecond.tool, 3);
  assert.equal(afterSecond.filament_changes, 2);
  assert.equal(afterSecond.filament_changes_total, 2);
});

test('Layer werden bis zum aktuellen Fortschritt gezählt', () => {
  const meta = parseFile(sample);
  assert.equal(meta.layerTotal, 2);
  assert.equal(computeLive(meta, 5).layer ?? 0, 0);
  assert.equal(computeLive(meta, 20, { timeRemainingSec: 13 * 60 }).layer, 2);
});

test('Ramming-Abfall folgt dem entladenen Tool', () => {
  const meta = parseFile(sample);
  assert.deepEqual(meta.wasteByChange.map((g) => Number(g.toFixed(3))), [0.01, 0.02]);
  assert.equal(Number(meta.wasteTotalG.toFixed(3)), 0.03);

  const live = computeLive(meta, 20, { timeRemainingSec: 15 * 60 + 20 });
  assert.equal(live.waste_g, 0.01);
  assert.equal(live.waste_total_g, 0.03);
});

test('Expliziter Slicer-Abfall bleibt maßgeblich und wird auf die Wechsel verteilt', () => {
  const meta = parseFile(Buffer.concat([sample, Buffer.from('; purge waste [g] = 3\n')]));
  assert.equal(meta.wasteTotalG, 3);
  assert.equal(Number(meta.wasteByChange.reduce((sum, g) => sum + g, 0).toFixed(3)), 3);

  const finished = computeLive(meta, 20, { timeRemainingSec: 13 * 60 });
  assert.equal(finished.waste_g, 3);
  assert.equal(finished.waste_total_g, 3);
});

test('Fallback pro Wechsel greift nur ohne Werte aus der Datei', () => {
  const plain = Buffer.from('M73 P0 R10\nT0\nM73 P50 R5\nT1\nM73 P90 R1\nT0\n; total toolchanges = 2\n');
  const meta = parseFile(plain);
  assert.equal(meta.wasteTotalG, null);
  const live = computeLive(meta, 95, { wasteGramsPerChange: 0.5 });
  assert.equal(live.waste_total_g, 1);
  assert.equal(live.waste_g, 1);
});

test('Zusammenfassung für den Datei-Check', () => {
  const summary = summarizeMeta(parseFile(sample), 'test.gcode');
  assert.equal(summary.fileName, 'test.gcode');
  assert.equal(summary.changesTotal, 2);
  assert.deepEqual(summary.materials, ['PLA', 'PETG', 'ASA']);
  assert.deepEqual(summary.toolUseCounts, [{ tool: 1, count: 1 }, { tool: 2, count: 1 }, { tool: 3, count: 1 }]);
});
