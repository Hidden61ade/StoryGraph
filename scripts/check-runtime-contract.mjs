// Executes the same authored fixture outcomes used by the Unity EditMode suite.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GraphModel } from '../src/core/GraphModel.js';
import { toEngineJSON } from '../src/core/exporters.js';
import { validateRuntime, parseValue, MAX_AUTOMATIC_STEPS } from '../src/core/runtimeContract.js';
import { StoryPlayer } from '../src/play/StoryPlayer.js';

const root = fileURLToPath(new URL('../unity/Tests/Fixtures/', import.meta.url));
const text = file => readFile(`${root}/${file}`, 'utf8');
const manifest = JSON.parse(await text('StoryGraphIntegrationFixtures.json'));
const load = async file => { const model = new GraphModel(); model.fromJSON(JSON.parse(await text(file))); return model; };
let assertions = 0;
for (const fixture of manifest.runtimeCases) {
  const model = await load(fixture.file);
  assert.deepEqual(validateRuntime(model).filter(i => i.level === 'error'), [], `${fixture.name}: validation`);
  const player = new StoryPlayer(toEngineJSON(model));
  for (const expected of fixture.steps) {
    const state = expected.command === 'begin' ? player.begin()
      : expected.command === 'next' ? player.next() : player.choose(expected.choiceIndex);
    assert.equal(player.current, expected.currentNodeId, `${fixture.name}: current node`);
    const actual = { ...state };
    if (actual.choices) actual.choices = actual.choices.map(c => c.text);
    assert.deepEqual(actual, expected.state, `${fixture.name}: ${expected.command}`);
    for (const v of expected.variables) assert.equal(player.vars[v.name], parseValue(v.type, v.value), `${fixture.name}: ${v.name}`);
    assertions++;
  }
}
for (const fixture of manifest.invalidCases) {
  if (fixture.name === 'malformed-json' || fixture.name === 'trailing-json') {
    const source = await text(fixture.file);
    assert.throws(() => JSON.parse(source), SyntaxError);
  } else {
    const issues = validateRuntime(await load(fixture.file)).filter(i => i.level === 'error');
    assert.ok(issues.length, `${fixture.name}: invalid graph must be rejected`);
    assert.ok(issues.some(i => i.msg.toLowerCase().includes(fixture.diagnostic.toLowerCase())), `${fixture.name}: actionable diagnostic`);
  }
  assertions++;
}
function checkVariables(player, expected, context) {
  for (const variable of expected) assert.equal(player.vars[variable.name], parseValue(variable.type, variable.value), `${context}: ${variable.name}`);
}
for (const fixture of manifest.faultCases) {
  const model = await load(fixture.file);
  assert.deepEqual(validateRuntime(model).filter(i => i.level === 'error'), [], `${fixture.name}: legal finite inputs`);
  const player = new StoryPlayer(toEngineJSON(model));
  const normalize = state => state.choices ? { ...state, choices: state.choices.map(c => c.text) } : state;
  assert.deepEqual(normalize(player.begin()), fixture.initial.state);
  checkVariables(player, fixture.initial.variables, `${fixture.name}: initial`);
  assertions++;
  assert.throws(() => player.choose(fixture.choiceIndex), /overflow|nonfinite/i);
  assert.equal(player.isFaulted, true);
  assert.equal(player.current, null);
  checkVariables(player, fixture.failureVariables, `${fixture.name}: atomic failure`);
  assertions++;
  for (const action of [() => player.next(), () => player.choose(fixture.choiceIndex), () => player.resolve()]) {
    assert.throws(action, /faulted.*begin/i, `${fixture.name}: errors cannot be retried for partial effects`);
    checkVariables(player, fixture.failureVariables, `${fixture.name}: rejected retry`);
    assertions++;
  }
  assert.deepEqual(normalize(player.begin()), fixture.initial.state);
  assert.equal(player.isFaulted, false);
  checkVariables(player, fixture.initial.variables, `${fixture.name}: restarted`);
  assertions++;
  assert.throws(() => player.choose(fixture.choiceIndex), /overflow|nonfinite/i);
  checkVariables(player, fixture.failureVariables, `${fixture.name}: independent retry after restart`);
  assertions++;
}
const loopModel = await load(manifest.automaticLoop.file);
assert.equal(validateRuntime(loopModel).filter(i => i.level === 'error').length, 0, 'A connected cycle is structurally valid.');
assert.equal(MAX_AUTOMATIC_STEPS, manifest.automaticLoop.automaticStepLimit);
assert.throws(() => new StoryPlayer(toEngineJSON(loopModel)).begin(), /automatic|10000|limit|loop/i, 'Automatic cycles must fail promptly.');
assertions++;
console.log(JSON.stringify({ status: 'passed', runtimeFixtures: manifest.runtimeCases.length, invalidFixtures: manifest.invalidCases.length, faultFixtures: manifest.faultCases.length, stepsAndRejections: assertions, automaticStepLimit: MAX_AUTOMATIC_STEPS }, null, 2));
