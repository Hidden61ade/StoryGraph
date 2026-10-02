import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { GraphModel } from '../src/core/GraphModel.js';
import { toEngineJSON, toUnityJSON, validate } from '../src/core/exporters.js';
import { StoryPlayer } from '../src/play/StoryPlayer.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let syntaxCount = 0;
function visit(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) visit(p);
    else if (/\.(mjs|js)$/.test(e.name)) {
      const result = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      syntaxCount++;
    }
  }
}
visit(root);
console.log(`PASS: ${syntaxCount} JavaScript modules parse`);

for (const name of ['birthday-party-sample.json', 'birthday-party-full.json', 'birthday-party-revised.sg']) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'examples', name), 'utf8'));
  const model = new GraphModel();
  model.fromJSON(data);
  assert.equal(model.nodes.size, data.nodes.length, `${name}: duplicate node ids`);
  assert.equal(model.edges.size, data.edges.length, `${name}: duplicate edge ids`);
  for (const e of model.edges.values()) {
    assert(model.nodes.has(e.source), `${name}: missing source ${e.source}`);
    assert(model.nodes.has(e.target), `${name}: missing target ${e.target}`);
  }
  const issues = validate(model);
  assert.deepEqual(issues, [], `${name}: graph validation`);
  const engine = toEngineJSON(model);
  const unity = toUnityJSON(model);
  assert.equal(unity.start, engine.start);
  assert(engine.nodes[engine.start]);
  assert.equal(unity.nodes.length, Object.keys(engine.nodes).length);
  assert.equal(unity.variables.length, model.variables.length);
  for (const v of unity.variables) assert.equal(typeof v.value, 'string');
  for (const n of unity.nodes) {
    assert.equal(n.type, engine.nodes[n.id].type);
    for (const a of [...(n.assignments || []), ...(n.clauses || []), ...(n.choices || []).flatMap(c => c.effects || [])]) {
      assert.equal(typeof a.value, 'string');
      assert(unity.variables.some(v => v.name === a.variable));
    }
  }
  const roundTrip = new GraphModel();
  roundTrip.fromJSON(JSON.parse(JSON.stringify(model.toJSON())));
  assert.deepEqual(toEngineJSON(roundTrip), engine);

  // Play a real route through each shipped fixture, including condition/set nodes.
  const player = new StoryPlayer(engine);
  let state = player.begin(), steps = 0;
  while (state.kind !== 'end' && steps++ < 1000) {
    state = state.kind === 'choice' ? player.choose(0) : player.next();
  }
  assert.equal(state.kind, 'end', `${name}: route did not finish`);
  assert(state.ending, `${name}: route ended on a missing node`);
  console.log(`PASS: ${name}: ${model.nodes.size} nodes, ${model.edges.size} edges, ${model.variables.length} variables; valid graph, JSON exports, round-trip, playable route (${state.ending})`);

  if (name === 'birthday-party-revised.sg') {
    assert.equal(model.nodes.size, 103);
    assert.equal(model.edges.size, 163);
    assert.equal(model.variables.length, 16);
    const hidden = new StoryPlayer(engine);
    let s = hidden.begin(), count = 0;
    while (s.kind === 'dialogue' && count++ < 20) s = hidden.next();
    assert.equal(s.kind, 'choice');
    s = hidden.choose(1);
    while (s.kind === 'dialogue' && count++ < 40) s = hidden.next();
    assert.equal(s.kind, 'end');
    assert.match(s.ending, /Hidden Ending/);
    console.log('PASS: revised graph refusal route reaches the hidden ending');
  }
}
