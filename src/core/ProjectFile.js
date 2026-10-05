// File handles belong to one open project. Switching projects invalidates a
// pending save's ability to attach a handle or mark the new project as saved.
const OPEN_TYPES = [{
  description: 'StoryGraph project',
  accept: { 'application/json': ['.sg', '.json'] },
}];
const SAVE_TYPES = [{
  description: 'StoryGraph project',
  accept: { 'application/json': ['.sg'] },
}];

// Validate the editable shape before replacing the model. Runtime validity is
// checked separately; incomplete stories must still be openable and saveable.
export function assertEditableProject(data, { isNodeTypeAvailable = () => true } = {}) {
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validId = (id) => typeof id === 'string' && id.length > 0;
  if (!record(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges) ||
      (data.meta !== undefined && !record(data.meta)) ||
      (data.variables !== undefined && !Array.isArray(data.variables)) ||
      (data.groups !== undefined && !Array.isArray(data.groups))) {
    throw new Error('Expected an editable .sg graph with nodes and edges.');
  }
  const ids = new Set();
  for (const node of data.nodes) {
    if (!record(node) || !validId(node.id) || ids.has(node.id) || !record(node.data)) {
      throw new Error('The project contains an invalid or duplicate node.');
    }
    if (typeof node.type !== 'string' || !isNodeTypeAvailable(node.type)) {
      throw new Error(`Node type ${node.type} is unavailable. Enable its plugin first.`);
    }
    ids.add(node.id);
    for (const key of ['options', 'clauses', 'assignments']) {
      if (node.data[key] !== undefined &&
          (!Array.isArray(node.data[key]) || node.data[key].some((entry) => !record(entry)))) {
        throw new Error(`Node ${node.id} has an invalid ${key} list.`);
      }
    }
    for (const option of node.data.options || []) {
      if (option.effects !== undefined &&
          (!Array.isArray(option.effects) || option.effects.some((effect) => !record(effect)))) {
        throw new Error(`Node ${node.id} has invalid option effects.`);
      }
    }
  }
  const edgeIds = new Set();
  for (const edge of data.edges) {
    if (!record(edge) || !validId(edge.id) || edgeIds.has(edge.id) ||
        !ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error('The project contains an invalid or duplicate connection.');
    }
    edgeIds.add(edge.id);
  }
  const groupIds = new Set();
  for (const group of data.groups || []) {
    if (!record(group) || !validId(group.id) || groupIds.has(group.id) ||
        !Array.isArray(group.members) || group.members.some((id) => !ids.has(id))) {
      throw new Error('The project contains an invalid or duplicate group.');
    }
    groupIds.add(group.id);
  }
  if ((data.variables || []).some((variable) => !record(variable))) {
    throw new Error('The project contains invalid variables.');
  }
}

export class ProjectFile {
  constructor({
    openPicker = globalThis.showOpenFilePicker?.bind(globalThis),
    savePicker = globalThis.showSaveFilePicker?.bind(globalThis),
    download,
    getRevision = () => 0,
  } = {}) {
    this._openPicker = openPicker;
    this._savePicker = savePicker;
    this._download = download;
    this._getRevision = getRevision;
    this._handle = null;
    this._name = null;
    this._generation = 0;
    this._saving = false;
  }

  get supportsOpen() { return typeof this._openPicker === 'function'; }
  get supportsSave() { return typeof this._savePicker === 'function'; }
  get fileName() { return this._name; }
  get hasHandle() { return this._handle !== null; }
  get busy() { return this._saving; }
  get generation() { return this._generation; }

  // Reading never changes the current session. Adopt only after the caller has
  // validated the project and confirmed that it may replace the current graph.
  async read(file, handle = null) {
    const data = JSON.parse(await file.text());
    return { data, handle, name: file.name || handle?.name || 'story.sg' };
  }

  async open() {
    if (!this.supportsOpen) throw new Error('Use the browser file input to open this project.');
    try {
      const [handle] = await this._openPicker({ multiple: false, types: OPEN_TYPES });
      if (!handle) return null;
      return await this.read(await handle.getFile(), handle);
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      throw error;
    }
  }

  adopt({ handle = null, name = null } = {}) {
    this._generation++;
    this._handle = handle;
    this._name = name;
  }

  detach() { this.adopt(); }

  async save(contents, { suggestedName = 'story.sg', saveAs = false } = {}) {
    if (this._saving) return { kind: 'busy', unchanged: false };
    this._saving = true;
    const revision = this._getRevision();
    const generation = this._generation;
    let writable;
    try {
      let handle = saveAs ? null : this._handle;
      if (!handle && this.supportsSave) {
        // Invoke the picker before any unrelated await, preserving the click or
        // keyboard gesture required by the File System Access API.
        handle = await this._savePicker({ suggestedName, types: SAVE_TYPES });
        if (!handle) return { kind: 'cancelled', unchanged: false };
      }
      // A picker can remain open while the user changes projects. Its eventual
      // selection must not authorize writing the outgoing project's snapshot.
      if (generation !== this._generation) return { kind: 'cancelled', unchanged: false };
      if (!handle) {
        if (typeof this._download !== 'function') throw new Error('Download is unavailable.');
        await this._download(contents, suggestedName, 'application/json');
        return {
          kind: 'downloaded', name: suggestedName,
          unchanged: generation === this._generation && revision === this._getRevision(),
        };
      }

      writable = await handle.createWritable();
      // Permission prompts and stream creation can also outlive the project.
      // Abort the temporary stream before writing any content to the new file.
      if (generation !== this._generation) {
        await writable.abort();
        writable = null;
        return { kind: 'cancelled', unchanged: false };
      }
      await writable.write(contents);
      await writable.close();
      writable = null;
      const sameProject = generation === this._generation;
      if (sameProject) {
        this._handle = handle;
        this._name = handle.name || suggestedName;
      }
      return {
        kind: 'written', name: handle.name || suggestedName,
        unchanged: sameProject && revision === this._getRevision(),
      };
    } catch (error) {
      if (writable) {
        try { await writable.abort(); } catch { /* Keep the original write error. */ }
      }
      if (error?.name === 'AbortError') return { kind: 'cancelled', unchanged: false };
      throw error;
    } finally {
      this._saving = false;
    }
  }
}
