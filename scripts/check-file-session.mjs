import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProjectFile, assertEditableProject } from '../src/core/ProjectFile.js';
import { GraphModel } from '../src/core/GraphModel.js';
import { NODE_TYPES } from '../src/core/nodeTypes.js';

const cancelled = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fileHandle(name, initial = '{"nodes":[]}') {
  return {
    name, contents: initial, streams: 0, writes: 0, closes: 0, aborts: 0,
    async getFile() { return { name, text: async () => this.contents }; },
    async createWritable() {
      this.streams++;
      let pending;
      return {
        write: async (text) => { this.writes++; pending = text; },
        close: async () => { this.closes++; this.contents = pending; },
        abort: async () => { this.aborts++; },
      };
    },
  };
}

// Opening is transactional: cancelled, unreadable, and invalid files cannot
// discard the current file association before the editor approves the graph.
const original = fileHandle('existing.sg');
const opened = fileHandle('opened.sg', '{"meta":{"name":"Opened"},"nodes":[]}');
let openChoice = opened;
const session = new ProjectFile({
  openPicker: async () => {
    if (openChoice instanceof Error) throw openChoice;
    return [openChoice];
  },
  savePicker: async () => { throw new Error('Save must reuse the opened handle.'); },
});
session.adopt({ handle: original, name: original.name });
const candidate = await session.open();
assert.equal(candidate.data.meta.name, 'Opened');
assert.equal(session.fileName, 'existing.sg');
session.adopt(candidate);
assert.equal(session.fileName, 'opened.sg');
const overwrite = await session.save('{"nodes":[{"id":"n_1"}]}');
assert.equal(overwrite.kind, 'written');
assert.equal(overwrite.unchanged, true);
assert.equal(opened.writes, 1);
assert.match(opened.contents, /n_1/);
assert.equal(original.writes, 0);
openChoice = cancelled();
assert.equal(await session.open(), null);
assert.equal(session.fileName, 'opened.sg');
openChoice = fileHandle('bad.sg', '{not json');
await assert.rejects(session.open(), SyntaxError);
assert.equal(session.fileName, 'opened.sg');
console.log('PASS: open retains a handle, Save overwrites it, cancelled/invalid Open preserves the previous session');

// Save As changes the destination only after a successful write and close.
const replacement = fileHandle('copy.sg');
let saveChoice = cancelled();
const saveAsSession = new ProjectFile({ savePicker: async () => {
  if (saveChoice instanceof Error) throw saveChoice;
  return saveChoice;
} });
saveAsSession.adopt({ handle: original, name: original.name });
assert.equal((await saveAsSession.save('new', { saveAs: true })).kind, 'cancelled');
assert.equal(saveAsSession.fileName, 'existing.sg');
saveChoice = replacement;
assert.equal((await saveAsSession.save('new', { saveAs: true })).kind, 'written');
assert.equal(saveAsSession.fileName, 'copy.sg');
assert.equal(replacement.contents, 'new');
await saveAsSession.save('newer');
assert.equal(replacement.contents, 'newer');
assert.equal(original.writes, 0);
console.log('PASS: Save As adopts its destination after success, cancellation retains the original destination');

// A project switch during Save As must cancel before opening the chosen file.
for (const switchProject of ['detach', 'adopt']) {
  const pickerGate = deferred();
  const selected = fileHandle('selected.sg', 'must remain intact');
  const newer = fileHandle('newer.sg');
  const picking = new ProjectFile({ savePicker: () => pickerGate.promise });
  picking.adopt({ handle: original, name: original.name });
  const oldSnapshot = picking.save('outgoing snapshot', { saveAs: true });
  if (switchProject === 'detach') picking.detach();
  else picking.adopt({ handle: newer, name: newer.name });
  pickerGate.resolve(selected);
  assert.equal((await oldSnapshot).kind, 'cancelled');
  assert.equal(selected.streams, 0);
  assert.equal(selected.writes, 0);
  assert.equal(selected.contents, 'must remain intact');
  assert.equal(picking.fileName, switchProject === 'detach' ? null : 'newer.sg');
  assert.equal(picking.busy, false);
}
console.log('PASS: switching projects during Save As cancels before creating a stream or overwriting the chosen file');

// A permission prompt / stream creation may also finish after a project switch.
const creatingGate = deferred();
const creatingStarted = deferred();
const streamTarget = fileHandle('delayed-stream.sg', 'existing contents');
const createNormally = streamTarget.createWritable.bind(streamTarget);
streamTarget.createWritable = async () => {
  creatingStarted.resolve();
  await creatingGate.promise;
  return createNormally();
};
const creating = new ProjectFile({ savePicker: null });
creating.adopt({ handle: streamTarget, name: streamTarget.name });
const delayedCreate = creating.save('old snapshot');
await creatingStarted.promise;
creating.detach();
creatingGate.resolve();
assert.equal((await delayedCreate).kind, 'cancelled');
assert.equal(streamTarget.writes, 0);
assert.equal(streamTarget.closes, 0);
assert.equal(streamTarget.aborts, 1);
assert.equal(streamTarget.contents, 'existing contents');
assert.equal(creating.hasHandle, false);
console.log('PASS: a stream created after a project switch is aborted before write or close');

// Failed writes/close leave the old destination and abort the temporary stream.
for (const failingStep of ['createWritable', 'write', 'close']) {
  const failure = new Error(`${failingStep} failed`);
  const bad = fileHandle('failed.sg');
  bad.createWritable = async () => {
    if (failingStep === 'createWritable') throw failure;
    return {
      write: async () => { if (failingStep === 'write') throw failure; },
      close: async () => { if (failingStep === 'close') throw failure; },
      abort: async () => { bad.aborts++; },
    };
  };
  const failing = new ProjectFile({ savePicker: async () => bad });
  failing.adopt({ handle: original, name: original.name });
  await assert.rejects(failing.save('new', { saveAs: true }), failure);
  assert.equal(failing.fileName, 'existing.sg');
  assert.equal(failing.busy, false);
  assert.equal(bad.aborts, failingStep === 'createWritable' ? 0 : 1);
}
console.log('PASS: permission/write/close failures preserve the old session and abort uncommitted streams');

// Editing during an asynchronous save must not mark that newer graph as saved.
let revision = 1;
const editingGate = deferred();
const pending = fileHandle('pending.sg');
pending.createWritable = async () => ({
  write: async (text) => { pending.contents = text; await editingGate.promise; },
  close: async () => {},
  abort: async () => {},
});
const editing = new ProjectFile({ savePicker: async () => pending, getRevision: () => revision });
const saving = editing.save('revision 1');
assert.equal(editing.busy, true);
assert.equal((await editing.save('revision 2')).kind, 'busy');
revision = 2;
editingGate.resolve();
assert.equal((await saving).unchanged, false);
assert.equal(editing.fileName, 'pending.sg');
assert.equal(editing.busy, false);
console.log('PASS: newer edits stay unsaved and concurrent writes are rejected');

// New/sample/open may replace the graph while its old save is finishing. The
// outgoing handle must not become the new project's next Save destination.
const switchingGate = deferred();
const switchingStarted = deferred();
const outgoing = fileHandle('outgoing.sg');
outgoing.createWritable = async () => ({
  write: async () => { switchingStarted.resolve(); await switchingGate.promise; },
  close: async () => {},
  abort: async () => {},
});
const switching = new ProjectFile({ savePicker: async () => outgoing });
const oldSave = switching.save('old graph');
await switchingStarted.promise;
switching.detach();
switchingGate.resolve();
assert.equal((await oldSave).unchanged, false);
assert.equal(switching.hasHandle, false);
assert.equal(switching.fileName, null);
const incoming = fileHandle('incoming.sg');
const switchingAgainGate = deferred();
const switchingAgainStarted = deferred();
outgoing.createWritable = async () => ({
  write: async () => { switchingAgainStarted.resolve(); await switchingAgainGate.promise; },
  close: async () => {},
  abort: async () => {},
});
const anotherSave = switching.save('old graph again');
await switchingAgainStarted.promise;
switching.adopt({ handle: incoming, name: incoming.name });
switchingAgainGate.resolve();
assert.equal((await anotherSave).unchanged, false);
assert.equal(switching.fileName, 'incoming.sg');
await switching.save('incoming graph');
assert.equal(incoming.contents, 'incoming graph');
console.log('PASS: switching projects prevents an outgoing save from attaching its file to the new graph');

// Browsers without native file writing produce a clearly identified download.
const downloads = [];
const fallback = new ProjectFile({
  openPicker: null, savePicker: null,
  download: async (...args) => downloads.push(args),
});
assert.equal(fallback.supportsOpen, false);
assert.equal(fallback.supportsSave, false);
const downloaded = await fallback.save('graph', { suggestedName: 'fallback.sg' });
assert.equal(downloaded.kind, 'downloaded');
assert.equal(downloaded.unchanged, true);
assert.deepEqual(downloads, [['graph', 'fallback.sg', 'application/json']]);
assert.equal(fallback.hasHandle, false);
assert.equal((await fallback.save('graph 2', { saveAs: true })).kind, 'downloaded');
console.log('PASS: unsupported file access falls back to downloads without creating a file association');

// Map-based loading would silently collapse duplicate IDs. Shape validation
// must reject them before the active graph or file association is replaced.
const incomplete = {
  nodes: [{ id: 'n_1', type: 'dialogue', data: { text: 'Unfinished story' } }],
  edges: [],
};
assert.doesNotThrow(() => assertEditableProject(incomplete));
const currentGraph = new GraphModel();
currentGraph.fromJSON(incomplete);
const previousGraph = JSON.stringify(currentGraph.toJSON());
const base = {
  nodes: [
    { id: 'n_1', type: 'start', data: {} },
    { id: 'n_2', type: 'end', data: {} },
  ],
  edges: [{ id: 'e_1', source: 'n_1', sourcePort: 'out', target: 'n_2' }],
  groups: [{ id: 'g_1', members: ['n_1', 'n_2'] }],
};
const malformed = [
  { ...base, nodes: [...base.nodes, base.nodes[0]] },
  { ...base, edges: [...base.edges, base.edges[0]] },
  { ...base, groups: [...base.groups, base.groups[0]] },
  { ...base, edges: [{ ...base.edges[0], id: undefined }] },
  { ...base, groups: [{ ...base.groups[0], id: undefined }] },
  { ...base, edges: [{ ...base.edges[0], target: 'missing' }] },
  { ...base, groups: [{ ...base.groups[0], members: ['missing'] }] },
  { ...base, nodes: [{ ...base.nodes[0], data: { options: [null] } }] },
  { ...base, variables: [null] },
  { ...base, nodes: [{ ...base.nodes[0], type: 'unavailable-plugin' }] },
];
for (const data of malformed) {
  assert.throws(() => {
    assertEditableProject(data, { isNodeTypeAvailable: (type) => Object.hasOwn(NODE_TYPES, type) });
    currentGraph.fromJSON(data);
  });
  assert.equal(JSON.stringify(currentGraph.toJSON()), previousGraph);
}
for (const name of ['birthday-party-sample.json', 'birthday-party-full.json', 'birthday-party-revised.sg']) {
  const data = JSON.parse(readFileSync(new URL('../examples/' + name, import.meta.url), 'utf8'));
  assertEditableProject(data, { isNodeTypeAvailable: (type) => Object.hasOwn(NODE_TYPES, type) });
}
console.log('PASS: malformed graph IDs/shapes preserve the active graph; incomplete stories and all shipped projects remain openable');
