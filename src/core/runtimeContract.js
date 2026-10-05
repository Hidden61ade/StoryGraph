// The core contract shared by the browser preview and the Unity package.
export const MAX_AUTOMATIC_STEPS = 10000;
const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const coreTypes = new Set(['start', 'dialogue', 'choice', 'condition', 'setvar', 'end', 'note']);

export function parseValue(type, raw) {
  if (type === 'number') {
    if ((typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && raw !== raw.trim()) || !decimal.test(String(raw)) || !Number.isFinite(Number(raw))) {
      throw new Error(`Expected a finite decimal number, received ${JSON.stringify(raw)}.`);
    }
    return Number(raw);
  }
  if (type === 'boolean') {
    if (raw === true || raw === 'true' || raw === '1') return true;
    if (raw === false || raw === 'false' || raw === '0') return false;
    throw new Error(`Expected true, false, "1" or "0", received ${JSON.stringify(raw)}.`);
  }
  if (type === 'string' && typeof raw === 'string') return raw;
  throw new Error(`Expected ${type} value, received ${JSON.stringify(raw)}.`);
}

export function validateRuntime(model) {
  const issues = [];
  const error = (msg, nodeId) => issues.push({ level: 'error', msg, ...(nodeId ? { nodeId } : {}) });
  const variables = new Map();
  for (const v of model.variables) {
    if (!v.name || variables.has(v.name)) error(`Variable names must be nonempty and unique: ${v.name || '(empty)'}.`);
    variables.set(v.name, v);
    try { parseValue(v.type, v.initial); } catch (e) { error(`Variable ${v.name}: ${e.message}`); }
  }
  const starts = [...model.nodes.values()].filter(n => n.type === 'start');
  if (starts.length !== 1) error('The core runtime requires exactly one Start node.');
  const ports = new Map();
  for (const n of model.nodes.values()) {
    if (!coreTypes.has(n.type)) error(`${n.id}: unsupported core runtime node type ${n.type}.`, n.id);
    const d = n.data || {};
    let outputs = [];
    if (['start', 'dialogue', 'setvar'].includes(n.type)) outputs = ['out'];
    if (n.type === 'condition') {
      outputs = ['true', 'false'];
      if (!['all', 'any', 'nand', 'nor'].includes(d.match || 'all')) error(`${n.id}: unknown condition mode ${d.match}.`, n.id);
      for (const c of d.clauses || []) checkOperation(c, n.id, true);
    }
    if (n.type === 'choice') {
      outputs = (d.options || []).map(o => o.id);
      if (!outputs.length) error(`${n.id}: a Choice needs at least one option.`, n.id);
      if (new Set(outputs).size !== outputs.length || outputs.some(p => !p)) error(`${n.id}: choice option IDs must be nonempty and unique.`, n.id);
      for (const o of d.options || []) for (const e of o.effects || []) checkOperation(e, n.id, false);
    }
    if (n.type === 'setvar') for (const e of d.assignments || []) checkOperation(e, n.id, false);
    ports.set(n.id, outputs);
    for (const p of outputs) if (!model.targetOf(n.id, p)) error(`${n.id}: output ${p} must connect to a runtime node.`, n.id);
  }
  const usedPorts = new Map();
  for (const e of model.edges.values()) {
    const source = model.nodes.get(e.source), target = model.nodes.get(e.target);
    if (!source || !target) { error(`Edge ${e.id}: missing source or target.`, e.source); continue; }
    if (!(ports.get(e.source) || []).includes(e.sourcePort)) error(`Edge ${e.id}: unknown output port ${e.sourcePort}.`, e.source);
    const seen = usedPorts.get(e.source) || new Set();
    if (seen.has(e.sourcePort)) error(`${e.source}: output ${e.sourcePort} has multiple connections.`, e.source);
    seen.add(e.sourcePort); usedPorts.set(e.source, seen);
    if (['start', 'note'].includes(target.type)) error(`Edge ${e.id}: target ${e.target} cannot receive a runtime connection.`, e.source);
  }
  return issues;

  function checkOperation(operation, nodeId, condition) {
    const v = variables.get(operation.var);
    if (!v) { error(`${nodeId}: undefined variable ${operation.var || '(empty)'}.`, nodeId); return; }
    const allowed = condition
      ? (v.type === 'number' ? ['==', '!=', '>', '>=', '<', '<='] : ['==', '!='])
      : (v.type === 'number' ? ['set', 'add', 'sub'] : ['set']);
    if (!allowed.includes(operation.op)) error(`${nodeId}: ${operation.op} is not supported for ${v.type} variable ${v.name}.`, nodeId);
    try { parseValue(v.type, operation.value); } catch (e) { error(`${nodeId}, ${v.name}: ${e.message}`, nodeId); }
  }
}
