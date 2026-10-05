// Deterministic original .sg project fixtures shared by Unity EditMode and JS.
// Expected outcomes are authored here; they are not derived from either runtime.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixtureRoot = fileURLToPath(new URL('../unity/Tests/Fixtures/', import.meta.url));
await mkdir(fixtureRoot, { recursive: true });

const node = (id, type, data = {}) => ({ id, type, x: 0, y: 0, data });
const edge = (source, sourcePort, target, index) => ({ id: `e_${index}`, source, sourcePort, target });
const graph = (name, variables, nodes, connections) => ({
  meta: { name, version: 1 }, variables, nodes,
  edges: connections.map(([source, port, target], i) => edge(source, port, target, i)), groups: [],
});
const copy = value => JSON.parse(JSON.stringify(value));
const number = (name, value) => ({ name, type: 'number', value: String(value) });
const boolean = (name, value) => ({ name, type: 'boolean', value: String(value) });
const string = (name, value) => ({ name, type: 'string', value });
const variables = (score, flag, message) => [number('score', score), boolean('flag', flag), string('message', message)];
const step = (command, currentNodeId, state, values = [], choiceIndex = 0) => ({ command, choiceIndex, currentNodeId: state.kind === 'end' ? null : currentNodeId, state, variables: values });
const dialogue = (text, speaker = 'Narrator') => ({ kind: 'dialogue', speaker, text });
const end = ending => ({ kind: 'end', ending });

const typed = graph('Typed flow fixture', [
  { name: 'score', type: 'number', initial: '2' },
  { name: 'flag', type: 'boolean', initial: false },
  { name: 'message', type: 'string', initial: 'pending' },
], [
  node('n_start', 'start'),
  node('n_setup', 'setvar', { assignments: [{ var: 'score', op: 'set', value: '1.25' }] }),
  node('n_intro', 'dialogue', { speaker: 'Narrator', text: 'Fixture opening: 八爪 λ' }),
  node('n_choice', 'choice', { prompt: 'Choose a branch.', options: [
    { id: 'o_a', text: 'Eight arms', effects: [
      { var: 'score', op: 'add', value: '2.5' },
      { var: 'flag', op: 'set', value: '1' },
      { var: 'message', op: 'set', value: '8 arms' },
    ] },
    { id: 'o_b', text: 'Two hands', effects: [
      { var: 'score', op: 'add', value: '.75' },
      { var: 'flag', op: 'set', value: '0' },
      { var: 'message', op: 'set', value: 'two hands' },
    ] },
  ] }),
  node('n_subtract', 'setvar', { assignments: [{ var: 'score', op: 'sub', value: '0.25' }] }),
  node('n_condition', 'condition', { match: 'all', clauses: [
    { var: 'score', op: '>=', value: '3.5' },
    { var: 'flag', op: '==', value: true },
    { var: 'message', op: '==', value: '8 arms' },
  ] }),
  node('n_good', 'end', { ending: 'understood' }),
  node('n_bad', 'end', { ending: 'not yet' }),
  node('n_note', 'note', { text: 'Authoring-only note, excluded from the runtime.' }),
], [
  ['n_start', 'out', 'n_setup'], ['n_setup', 'out', 'n_intro'], ['n_intro', 'out', 'n_choice'],
  ['n_choice', 'o_a', 'n_subtract'], ['n_choice', 'o_b', 'n_subtract'],
  ['n_subtract', 'out', 'n_condition'], ['n_condition', 'true', 'n_good'], ['n_condition', 'false', 'n_bad'],
]);
const opening = step('begin', 'n_intro', dialogue('Fixture opening: 八爪 λ'), variables(1.25, false, 'pending'));
const choice = step('next', 'n_choice', { kind: 'choice', prompt: 'Choose a branch.', choices: ['Eight arms', 'Two hands'] }, variables(1.25, false, 'pending'));
const runtimeCases = [{ name: 'typed-flow', file: 'typed-flow.json', steps: [
  opening, choice,
  step('choose', 'n_good', end('understood'), variables(3.5, true, '8 arms'), 0),
  copy(opening), copy(choice),
  step('choose', 'n_bad', end('not yet'), variables(1.75, false, 'two hands'), 1),
  copy(opening), copy(choice),
  step('choose', 'n_good', end('understood'), variables(3.5, true, '8 arms'), 0),
] }];
const projects = new Map([['typed-flow.json', typed]]);

const dateBefore = '2024-01-02T03:04:05.000Z';
const dateAfter = '2026-10-05T12:34:56+08:00';
projects.set('iso-date-string.json', graph('ISO date remains a string', [
  { name: 'stamp', type: 'string', initial: dateBefore },
], [
  node('n_start', 'start'),
  node('n_choice', 'choice', { prompt: 'Keep the exact string.', options: [{
    id: 'o_keep', text: 'Set timestamp text', effects: [{ var: 'stamp', op: 'set', value: dateAfter }],
  }] }),
  node('n_condition', 'condition', { match: 'all', clauses: [{ var: 'stamp', op: '==', value: dateAfter }] }),
  node('n_true', 'end', { ending: 'exact string' }), node('n_false', 'end', { ending: 'changed string' }),
], [['n_start', 'out', 'n_choice'], ['n_choice', 'o_keep', 'n_condition'], ['n_condition', 'true', 'n_true'], ['n_condition', 'false', 'n_false']]));
runtimeCases.push({ name: 'iso-date-string', file: 'iso-date-string.json', steps: [
  step('begin', 'n_choice', { kind: 'choice', prompt: 'Keep the exact string.', choices: ['Set timestamp text'] }, [string('stamp', dateBefore)]),
  step('choose', 'n_true', end('exact string'), [string('stamp', dateAfter)]),
] });

for (const [mode, expected] of [['all', false], ['any', true], ['nand', true], ['nor', false]]) {
  for (const empty of [false, true]) {
    const name = `match-${mode}${empty ? '-empty' : ''}`;
    const result = empty || expected;
    projects.set(`${name}.json`, graph(name, [
      { name: 'count', type: 'number', initial: '2e0' },
      { name: 'enabled', type: 'boolean', initial: '0' },
    ], [
      node('n_start', 'start'),
      node('n_condition', 'condition', { match: mode, clauses: empty ? [] : [
        { var: 'count', op: '==', value: '2.0' },
        { var: 'enabled', op: '!=', value: false },
      ] }),
      node('n_true', 'end', { ending: 'true branch' }),
      node('n_false', 'end', { ending: 'false branch' }),
    ], [['n_start', 'out', 'n_condition'], ['n_condition', 'true', 'n_true'], ['n_condition', 'false', 'n_false']]));
    runtimeCases.push({ name, file: `${name}.json`, steps: [
      step('begin', result ? 'n_true' : 'n_false', end(result ? 'true branch' : 'false branch'), [number('count', 2), boolean('enabled', false)]),
    ] });
  }
}

const original = graph('Reimport fixture', [], [
  node('n_start', 'start'), node('n_intro', 'dialogue', { speaker: 'Narrator', text: 'Original opening.' }),
  node('n_end', 'end', { ending: 'finished' }),
], [['n_start', 'out', 'n_intro'], ['n_intro', 'out', 'n_end']]);
const updated = graph('Reimport fixture', [], [
  node('n_start', 'start'), node('n_intro', 'dialogue', { speaker: 'Narrator', text: 'Updated opening.' }),
  node('n_added', 'dialogue', { speaker: 'New speaker', text: 'A newly added dialogue.' }),
  node('n_end', 'end', { ending: 'finished' }),
], [['n_start', 'out', 'n_intro'], ['n_intro', 'out', 'n_added'], ['n_added', 'out', 'n_end']]);
projects.set('reimport-original.json', original);
projects.set('reimport-updated.json', updated);
runtimeCases.push({ name: 'reimport-original', file: 'reimport-original.json', steps: [
  step('begin', 'n_intro', dialogue('Original opening.')), step('next', 'n_end', end('finished')),
] });
runtimeCases.push({ name: 'reimport-updated', file: 'reimport-updated.json', steps: [
  step('begin', 'n_intro', dialogue('Updated opening.')), step('next', 'n_added', dialogue('A newly added dialogue.', 'New speaker')),
  step('next', 'n_end', end('finished')),
] });

const invalidCases = [];
function invalid(name, source, mutate, diagnostic) {
  const data = copy(source); mutate(data); const file = `${name}.json`;
  projects.set(file, data); invalidCases.push({ name, file, diagnostic });
}
invalid('missing-start', original, data => { data.nodes = data.nodes.filter(n => n.type !== 'start'); data.edges = data.edges.filter(e => e.source !== 'n_start'); }, 'Start');
invalid('unknown-effect-variable', typed, data => { data.nodes.find(n => n.id === 'n_choice').data.options[0].effects[0].var = 'missing_score'; }, 'missing_score');
invalid('unknown-condition-variable', typed, data => { data.nodes.find(n => n.id === 'n_condition').data.clauses[0].var = 'missing_score'; }, 'missing_score');
invalid('plugin-node', original, data => { data.nodes.find(n => n.id === 'n_intro').type = 'plugin.audio'; }, 'plugin.audio');
invalid('dangling-edge', original, data => { data.edges.find(e => e.source === 'n_intro').target = 'missing_node'; }, 'target');
invalid('duplicate-output', original, data => { data.edges.push(edge('n_intro', 'out', 'n_end', 99)); }, 'out');
invalid('missing-output', original, data => { data.edges = data.edges.filter(e => e.source !== 'n_intro'); }, 'out');
invalid('duplicate-variable', typed, data => { data.variables.push(copy(data.variables[0])); }, 'score');
invalid('hex-number', typed, data => { data.variables[0].initial = '0x10'; }, 'finite');
invalid('boolean-whitespace', typed, data => { data.variables[1].initial = ' true '; }, 'true');
invalid('nonstring-string', typed, data => { data.variables[2].initial = 7; }, 'message');
invalid('boolean-add-effect', typed, data => { data.nodes.find(n => n.id === 'n_choice').data.options[0].effects[1].op = 'add'; }, 'boolean');
const malformedFile = 'malformed-json.txt';
await writeFile(`${fixtureRoot}/${malformedFile}`, '{ "meta": { "name": "broken" }, "nodes": [', 'utf8');
invalidCases.push({ name: 'malformed-json', file: malformedFile, diagnostic: '' });
const trailingFile = 'trailing-json.txt';
await writeFile(`${fixtureRoot}/${trailingFile}`, `${JSON.stringify(original)}\n{}`, 'utf8');
invalidCases.push({ name: 'trailing-json', file: trailingFile, diagnostic: '' });

const automaticLoop = graph('Automatic loop fixture', [{ name: 'ticks', type: 'number', initial: 0 }], [
  node('n_start', 'start'),
  node('n_loop_a', 'setvar', { assignments: [{ var: 'ticks', op: 'add', value: '1' }] }),
  node('n_loop_b', 'setvar', { assignments: [] }),
], [['n_start', 'out', 'n_loop_a'], ['n_loop_a', 'out', 'n_loop_b'], ['n_loop_b', 'out', 'n_loop_a']]);
projects.set('automatic-loop.json', automaticLoop);

const faultCases = [];
for (const automatic of [false, true]) {
  const name = automatic ? 'automatic-overflow' : 'choice-overflow';
  const failedEffects = [
    { var: 'count', op: 'add', value: automatic ? '10' : '1' },
    { var: 'huge', op: 'add', value: '1e308' },
  ];
  const nodes = [
    node('n_start', 'start'),
    node('n_choice', 'choice', { prompt: 'Run the overflow route.', options: [{
      id: 'o_run', text: 'Run', effects: automatic ? [] : failedEffects,
    }] }),
    node('n_end', 'end', { ending: 'unreachable after overflow' }),
  ];
  const connections = [['n_start', 'out', 'n_choice']];
  if (automatic) {
    nodes.push(node('n_success', 'setvar', { assignments: [{ var: 'count', op: 'add', value: '1' }] }));
    nodes.push(node('n_fail', 'setvar', { assignments: failedEffects }));
    connections.push(['n_choice', 'o_run', 'n_success'], ['n_success', 'out', 'n_fail'], ['n_fail', 'out', 'n_end']);
  } else connections.push(['n_choice', 'o_run', 'n_end']);
  projects.set(`${name}.json`, graph(name, [
    { name: 'count', type: 'number', initial: 0 }, { name: 'huge', type: 'number', initial: '1e308' },
  ], nodes, connections));
  faultCases.push({
    name, file: `${name}.json`, choiceIndex: 0,
    initial: step('begin', 'n_choice', { kind: 'choice', prompt: 'Run the overflow route.', choices: ['Run'] }, [number('count', 0), number('huge', 1e308)]),
    failureVariables: [number('count', automatic ? 1 : 0), number('huge', 1e308)],
  });
}

for (const [file, data] of projects) await writeFile(`${fixtureRoot}/${file}`, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
await writeFile(`${fixtureRoot}/StoryGraphIntegrationFixtures.json`, `${JSON.stringify({
  version: 1, runtimeCases, invalidCases, faultCases,
  automaticLoop: { file: 'automatic-loop.json', automaticStepLimit: 10000 },
  reimport: { original: 'reimport-original.json', updated: 'reimport-updated.json' },
}, null, 2)}\n`, 'utf8');
console.log(`Wrote ${projects.size + 3} shared fixture files to ${fixtureRoot}`);
