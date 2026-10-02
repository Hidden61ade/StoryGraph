// 导出器与校验：把编辑器里的图，转成「引擎可直接读取」的运行时格式。
// 运行时格式是扁平的 id->节点 字典，任何引擎（Unity / Godot / 网页）都能顺序执行。
import { OP_SYMBOL, NODE_TYPES } from './nodeTypes.js';

/** 把字符串值按变量类型转成真实类型 */
function coerce(variables, varName, raw) {
  const v = variables.find((x) => x.name === varName);
  const type = v ? v.type : 'number';
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === 'boolean') return raw === true || raw === 'true' || raw === '1';
  return String(raw ?? '');
}

/** Unity 友好：把顶层基础类型字段统一成字符串（数组/对象原样保留）。 */
function stringifyValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = (v !== null && typeof v === 'object') ? v : String(v ?? '');
  }
  return out;
}

/** 初始变量表 { name: initialValue } */
function buildVariables(model) {
  const out = {};
  for (const v of model.variables) {
    if (v.type === 'number') out[v.name] = Number(v.initial) || 0;
    else if (v.type === 'boolean') out[v.name] = v.initial === true || v.initial === 'true';
    else out[v.name] = v.initial ?? '';
  }
  return out;
}

/**
 * 导出为引擎运行时 JSON。
 * 结构：{ name, variables, start, nodes:{ id: runtimeNode } }
 */
export function toEngineJSON(model) {
  const variables = buildVariables(model);
  const nodes = {};
  let start = null;

  for (const node of model.nodes.values()) {
    switch (node.type) {
      case 'start':
        // 开始节点不进运行时，直接把它的下一步作为入口
        start = model.targetOf(node.id, 'out');
        break;
      case 'dialogue':
        nodes[node.id] = {
          type: 'dialogue',
          speaker: node.data.speaker || '',
          text: node.data.text || '',
          next: model.targetOf(node.id, 'out'),
        };
        break;
      case 'choice':
        nodes[node.id] = {
          type: 'choice',
          prompt: node.data.prompt || '',
          choices: (node.data.options || []).map((o) => ({
            text: o.text,
            effects: (o.effects || []).map((e) => ({
              var: e.var, op: e.op, value: coerce(model.variables, e.var, e.value),
            })),
            next: model.targetOf(node.id, o.id),
          })),
        };
        break;
      case 'condition':
        nodes[node.id] = {
          type: 'condition',
          match: node.data.match || 'all',
          clauses: (node.data.clauses || []).map((c) => ({
            var: c.var, op: c.op, value: coerce(model.variables, c.var, c.value),
          })),
          whenTrue: model.targetOf(node.id, 'true'),
          whenFalse: model.targetOf(node.id, 'false'),
        };
        break;
      case 'setvar':
        nodes[node.id] = {
          type: 'set',
          assignments: (node.data.assignments || []).map((a) => ({
            var: a.var, op: a.op, value: coerce(model.variables, a.var, a.value),
          })),
          next: model.targetOf(node.id, 'out'),
        };
        break;
      case 'end':
        nodes[node.id] = { type: 'end', ending: node.data.ending || node.data.label || '' };
        break;
      // note 不导出
      default: {
        // 插件自定义节点：走类型 def 的 toEngine 钩子
        const def = NODE_TYPES[node.type];
        if (def && typeof def.toEngine === 'function') {
          const helpers = {
            next: (port = 'out') => model.targetOf(node.id, port),
            coerce: (varName, raw) => coerce(model.variables, varName, raw),
          };
          const out = def.toEngine(node, helpers);
          if (out) nodes[node.id] = out;
        }
        break;
      }
    }
  }

  return { name: model.meta.name || '未命名剧情', variables, start, nodes };
}

/**
 * 导出为 Unity 友好的 JSON。
 * 为什么单独做：Unity 自带的 JsonUtility 无法反序列化「字典/Map」与多态类型，
 * 所以这里把 variables / nodes 都拍平成「数组」，每个节点用同一套字段（缺省留空），
 * 且把所有 value 统一成字符串、由 C# 按变量类型还原。这样 C# 端 JsonUtility.FromJson 即可直接读。
 * 结构：{ name, start, variables:[{name,type,value}], nodes:[{ id,type, ...扁平字段 }] }
 */
export function toUnityJSON(model) {
  const variables = model.variables.map((v) => ({
    name: v.name,
    type: v.type || 'number',
    value: String(v.initial ?? ''),
  }));

  let start = '';
  const nodes = [];
  for (const node of model.nodes.values()) {
    switch (node.type) {
      case 'start':
        start = model.targetOf(node.id, 'out') || '';
        break;
      case 'dialogue':
        nodes.push({
          id: node.id, type: 'dialogue',
          speaker: node.data.speaker || '',
          text: node.data.text || '',
          next: model.targetOf(node.id, 'out') || '',
        });
        break;
      case 'choice':
        nodes.push({
          id: node.id, type: 'choice',
          prompt: node.data.prompt || '',
          choices: (node.data.options || []).map((o) => ({
            text: o.text || '',
            next: model.targetOf(node.id, o.id) || '',
            effects: (o.effects || []).map((e) => ({
              variable: e.var, op: e.op, value: String(e.value),
            })),
          })),
        });
        break;
      case 'condition':
        nodes.push({
          id: node.id, type: 'condition',
          match: node.data.match || 'all',
          clauses: (node.data.clauses || []).map((c) => ({
            variable: c.var, op: c.op, value: String(c.value),
          })),
          whenTrue: model.targetOf(node.id, 'true') || '',
          whenFalse: model.targetOf(node.id, 'false') || '',
        });
        break;
      case 'setvar':
        nodes.push({
          id: node.id, type: 'set',
          assignments: (node.data.assignments || []).map((a) => ({
            variable: a.var, op: a.op, value: String(a.value),
          })),
          next: model.targetOf(node.id, 'out') || '',
        });
        break;
      case 'end':
        nodes.push({ id: node.id, type: 'end', ending: node.data.ending || node.data.label || '' });
        break;
      // note 不导出
      default: {
        const def = NODE_TYPES[node.type];
        if (def && typeof def.toEngine === 'function') {
          const helpers = {
            next: (port = 'out') => model.targetOf(node.id, port) || '',
            coerce: (varName, raw) => coerce(model.variables, varName, raw),
          };
          const out = def.toEngine(node, helpers);
          if (out) nodes.push({ id: node.id, ...stringifyValues(out) });
        }
        break;
      }
    }
  }

  return { name: model.meta.name || '未命名剧情', start, variables, nodes };
}

/**
 * 导出为 Yarn 风格脚本（额外格式，便于接入 Yarn Spinner 等成熟叙事引擎）。
 * 这是一个易读的近似实现，演示「同一份图可导出多种格式」。
 */
export function toYarn(model) {
  const title = (id) => id.replace(/[^A-Za-z0-9_]/g, '_');
  const lines = [];
  for (const node of model.nodes.values()) {
    if (node.type === 'start' || node.type === 'note') continue;
    lines.push(`title: ${title(node.id)}`);
    lines.push('---');
    if (node.type === 'dialogue') {
      lines.push(`${node.data.speaker || '旁白'}: ${node.data.text || ''}`);
      const next = model.targetOf(node.id, 'out');
      if (next) lines.push(`<<jump ${title(next)}>>`);
    } else if (node.type === 'choice') {
      if (node.data.prompt) lines.push(`旁白: ${node.data.prompt}`);
      for (const o of node.data.options || []) {
        const next = model.targetOf(node.id, o.id);
        lines.push(`-> ${o.text}`);
        for (const e of o.effects || []) {
          lines.push(`    <<set $${e.var} = ${effectExpr(e)}>>`);
        }
        if (next) lines.push(`    <<jump ${title(next)}>>`);
      }
    } else if (node.type === 'condition') {
      const joiner = (node.data.match === 'any' || node.data.match === 'nor') ? ' || ' : ' && ';
      let cond = (node.data.clauses || [])
        .map((c) => `$${c.var} ${jsOp(c.op)} ${c.value}`)
        .join(joiner);
      if (node.data.match === 'nand' || node.data.match === 'nor') cond = `!(${cond})`;
      const t = model.targetOf(node.id, 'true');
      const f = model.targetOf(node.id, 'false');
      lines.push(`<<if ${cond}>>`);
      if (t) lines.push(`    <<jump ${title(t)}>>`);
      lines.push('<<else>>');
      if (f) lines.push(`    <<jump ${title(f)}>>`);
      lines.push('<<endif>>');
    } else if (node.type === 'setvar') {
      for (const a of node.data.assignments || []) {
        lines.push(`<<set $${a.var} = ${effectExpr(a)}>>`);
      }
      const next = model.targetOf(node.id, 'out');
      if (next) lines.push(`<<jump ${title(next)}>>`);
    } else if (node.type === 'end') {
      lines.push(`旁白: 【结局：${node.data.ending || node.data.label || ''}】`);
    }
    lines.push('===', '');
  }
  return lines.join('\n');

  function effectExpr(e) {
    if (e.op === 'add') return `$${e.var} + ${e.value}`;
    if (e.op === 'sub') return `$${e.var} - ${e.value}`;
    return `${e.value}`;
  }
  function jsOp(op) {
    return op === '==' ? '==' : op;
  }
}

/**
 * 基础校验：把常见的「断头路 / 没开始 / 用了不存在的变量」找出来，给非技术同学友好提示。
 * 返回 [{ level:'error'|'warn', msg, nodeId? }]
 */
export function validate(model) {
  const issues = [];
  const starts = [...model.nodes.values()].filter((n) => n.type === 'start');
  if (starts.length === 0) issues.push({ level: 'error', msg: '缺少「开始」节点，剧情没有入口。' });
  if (starts.length > 1) issues.push({ level: 'warn', msg: `有 ${starts.length} 个「开始」节点，导出时只会用其中一个。` });

  const varNames = new Set(model.variables.map((v) => v.name));

  for (const node of model.nodes.values()) {
    const name = nodeName(node);
    if (node.type === 'dialogue') {
      if (!node.data.text) issues.push({ level: 'warn', msg: `${name}：对话内容为空。`, nodeId: node.id });
      if (!model.targetOf(node.id, 'out')) issues.push({ level: 'warn', msg: `${name}：没有连向下一步。`, nodeId: node.id });
    }
    if (node.type === 'choice') {
      (node.data.options || []).forEach((o, i) => {
        if (!model.targetOf(node.id, o.id)) {
          issues.push({ level: 'warn', msg: `${name}：选项「${o.text || '#' + (i + 1)}」是断头路。`, nodeId: node.id });
        }
        (o.effects || []).forEach((e) => checkVar(e.var, name));
      });
    }
    if (node.type === 'condition') {
      if (!model.targetOf(node.id, 'true')) issues.push({ level: 'warn', msg: `${name}：「是」分支未连接。`, nodeId: node.id });
      if (!model.targetOf(node.id, 'false')) issues.push({ level: 'warn', msg: `${name}：「否」分支未连接。`, nodeId: node.id });
      (node.data.clauses || []).forEach((c) => checkVar(c.var, name));
    }
    if (node.type === 'setvar') {
      (node.data.assignments || []).forEach((a) => checkVar(a.var, name));
      if (!model.targetOf(node.id, 'out')) issues.push({ level: 'warn', msg: `${name}：没有连向下一步。`, nodeId: node.id });
    }
  }

  // 可达性：从开始节点 BFS，找不可达节点
  if (starts.length) {
    const reachable = new Set();
    const queue = [starts[0].id];
    while (queue.length) {
      const id = queue.shift();
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of model.edges.values()) {
        if (e.source === id && !reachable.has(e.target)) queue.push(e.target);
      }
    }
    for (const node of model.nodes.values()) {
      if (node.type === 'note') continue;
      if (!reachable.has(node.id)) {
        issues.push({ level: 'warn', msg: `${nodeName(node)}：从开始无法到达（孤立节点）。`, nodeId: node.id });
      }
    }
  }

  return issues;

  function checkVar(v, name) {
    if (v && !varNames.has(v)) issues.push({ level: 'error', msg: `${name}：使用了未定义的变量「${v}」。`, nodeId: undefined });
  }
  function nodeName(node) {
    const label = node.data.label || node.data.speaker || node.data.ending || '';
    return `[${typeLabel(node.type)}${label ? ' · ' + label : ''}]`;
  }
}

function typeLabel(type) {
  return { start: '开始', dialogue: '对话', choice: '选择', condition: '条件', setvar: '赋值', end: '结局', note: '便签' }[type] || type;
}

// 给 UI 复用的运算符符号
export { OP_SYMBOL };
