// 唯一数据源（Single Source of Truth）。
// 画布、检查器、导出器都只读写这个模型；模型通过事件广播变化。
// 这样将来想换渲染库、加插件，核心数据层都不用动。
import { EventBus } from './EventBus.js';
import { NODE_TYPES, defaultData, outputPorts } from './nodeTypes.js';

export class GraphModel extends EventBus {
  constructor() {
    super();
    this.reset(false);
  }

  reset(emit = true) {
    this.meta = { name: '未命名剧情', version: 1 };
    this.variables = []; // [{ name, type:'number'|'boolean'|'string', initial }]
    this.nodes = new Map(); // id -> { id, type, x, y, data }
    this.edges = new Map(); // id -> { id, source, sourcePort, target }
    this.groups = new Map(); // id -> { id, label, color, members:[nodeId] }
    this._seq = 1;
    if (emit) {
      this.emit('loaded');
      this.emit('changed');
    }
  }

  _id(prefix) {
    return `${prefix}_${this._seq++}`;
  }

  // ---------- 节点 ----------
  addNode(type, x, y, data) {
    const node = {
      id: this._id('n'),
      type,
      x: Math.round(x),
      y: Math.round(y),
      data: data || defaultData(type),
    };
    this.nodes.set(node.id, node);
    this.emit('nodeAdded', node);
    this.emit('changed');
    return node;
  }

  /** 更新节点数据。structural=true 表示端口数量可能变化（需重画连线/检查器）。 */
  updateNodeData(id, patch, structural = false) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.data = { ...node.data, ...patch };
    if (structural) this._pruneEdges();
    this.emit('nodeChanged', { node, structural });
    this.emit('changed');
  }

  moveNode(id, x, y) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.x = Math.round(x);
    node.y = Math.round(y);
    this.emit('nodeMoved', node); // 拖动期间高频触发，不发 changed（避免撤销栈爆炸）
  }

  /** 调整节点尺寸。与拖动类似，拖动期间不发 changed，结束时 commit() 一次记入撤销栈。 */
  resizeNode(id, w, h) {
    const node = this.nodes.get(id);
    if (!node) return;
    if (w != null) node.w = Math.round(w);
    if (h != null) node.h = Math.round(h);
    this.emit('nodeResized', node);
  }

  removeNode(id) {
    if (!this.nodes.has(id)) return;
    for (const [eid, e] of this.edges) {
      if (e.source === id || e.target === id) {
        this.edges.delete(eid);
        this.emit('edgeRemoved', eid);
      }
    }
    // 从所在组中移除；组空了就解散
    for (const [gid, g] of this.groups) {
      const i = g.members.indexOf(id);
      if (i >= 0) {
        g.members.splice(i, 1);
        if (!g.members.length) this.groups.delete(gid);
        this.emit('groupsChanged');
      }
    }
    this.nodes.delete(id);
    this.emit('nodeRemoved', id);
    this.emit('changed');
  }

  // ---------- 连线 ----------
  addEdge(source, sourcePort, target) {
    const src = this.nodes.get(source);
    const tgt = this.nodes.get(target);
    if (!src || !tgt) return null;
    if (source === target) return null; // 不允许自连
    if (!NODE_TYPES[tgt.type].hasInput) return null; // 目标不接受输入
    if (!outputPorts(src).some((p) => p.id === sourcePort)) return null;

    // 一个输出端口只能连一条线：先移除旧的
    for (const [eid, e] of this.edges) {
      if (e.source === source && e.sourcePort === sourcePort) {
        this.edges.delete(eid);
        this.emit('edgeRemoved', eid);
      }
    }
    const edge = { id: this._id('e'), source, sourcePort, target };
    this.edges.set(edge.id, edge);
    this.emit('edgeAdded', edge);
    this.emit('changed');
    return edge;
  }

  removeEdge(id) {
    if (!this.edges.has(id)) return;
    this.edges.delete(id);
    this.emit('edgeRemoved', id);
    this.emit('changed');
  }

  /** 找到从某端口出发的目标节点 id（导出/校验用） */
  targetOf(nodeId, portId) {
    for (const e of this.edges.values()) {
      if (e.source === nodeId && e.sourcePort === portId) return e.target;
    }
    return null;
  }

  _pruneEdges() {
    for (const [eid, e] of this.edges) {
      const src = this.nodes.get(e.source);
      if (!src || !outputPorts(src).some((p) => p.id === e.sourcePort)) {
        this.edges.delete(eid);
        this.emit('edgeRemoved', eid);
      }
    }
  }

  // ---------- 组（把多个节点整合成一个可整体移动的逻辑单元）----------
  addGroup(memberIds, label) {
    const ids = (memberIds || []).filter((id) => this.nodes.has(id));
    if (!ids.length) return null;
    const group = { id: this._id('g'), label: label || '新建组', color: '#64748b', members: ids };
    this.groups.set(group.id, group);
    this.emit('groupsChanged');
    this.emit('changed');
    return group;
  }

  updateGroup(id, patch) {
    const g = this.groups.get(id);
    if (!g) return;
    Object.assign(g, patch);
    this.emit('groupsChanged');
    this.emit('changed');
  }

  /** 解散组（保留节点本身）。 */
  removeGroup(id) {
    if (!this.groups.delete(id)) return;
    this.emit('groupsChanged');
    this.emit('changed');
  }

  groupOf(nodeId) {
    for (const g of this.groups.values()) if (g.members.includes(nodeId)) return g;
    return null;
  }

  // ---------- 预制体 / 资产（节点复用）----------
  /** 把一组节点 + 其内部连线序列化成「可复用模板」（位置用相对坐标，节点不带 id）。 */
  serializeSubgraph(nodeIds) {
    const ids = (nodeIds || []).filter((id) => this.nodes.has(id));
    if (!ids.length) return { nodes: [], edges: [], variables: [] };
    let minX = Infinity, minY = Infinity;
    for (const id of ids) { const n = this.nodes.get(id); minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); }
    const indexOf = new Map(ids.map((id, i) => [id, i]));
    const usedVars = new Set();
    const nodes = ids.map((id) => {
      const n = this.nodes.get(id);
      collectVars(n, usedVars);
      return {
        type: n.type,
        dx: n.x - minX, dy: n.y - minY,
        w: n.w || null, h: n.h || null,
        data: JSON.parse(JSON.stringify(n.data)),
      };
    });
    const inSet = new Set(ids);
    const edges = [];
    for (const e of this.edges.values()) {
      if (inSet.has(e.source) && inSet.has(e.target)) {
        edges.push({ from: indexOf.get(e.source), fromPort: e.sourcePort, to: indexOf.get(e.target) });
      }
    }
    const variables = this.variables
      .filter((v) => usedVars.has(v.name))
      .map((v) => ({ name: v.name, type: v.type, initial: v.initial }));
    return { nodes, edges, variables };
  }

  /** 把预制体实例化到 (x,y)，生成全新 id 的节点与连线。返回新节点 id 数组。 */
  instantiatePrefab(prefab, x, y) {
    if (!prefab || !prefab.nodes) return [];
    // 缺失的变量按模板补建，保证复用后仍可运行
    for (const v of prefab.variables || []) {
      if (!this.variables.some((o) => o.name === v.name)) {
        const fallback = v.type === 'boolean' ? false : v.type === 'string' ? '' : 0;
        this.variables.push({ name: v.name, type: v.type || 'number', initial: v.initial ?? fallback });
      }
    }
    const idByIndex = [];
    const newIds = [];
    (prefab.nodes || []).forEach((pn, i) => {
      const node = this.addNode(pn.type, x + (pn.dx || 0), y + (pn.dy || 0), JSON.parse(JSON.stringify(pn.data)));
      if (pn.w) node.w = pn.w;
      if (pn.h) node.h = pn.h;
      idByIndex[i] = node.id;
      newIds.push(node.id);
    });
    for (const e of prefab.edges || []) {
      const s = idByIndex[e.from], t = idByIndex[e.to];
      if (s && t) this.addEdge(s, e.fromPort, t);
    }
    if ((prefab.variables || []).length) this.emit('variablesChanged');
    this.emit('changed');
    return newIds;
  }

  // ---------- 变量 ----------
  addVariable(v = {}) {
    const name = v.name || this._uniqueVarName();
    this.variables.push({ name, type: v.type || 'number', initial: v.initial ?? 0 });
    this.emit('variablesChanged');
    this.emit('changed');
  }

  updateVariable(index, patch) {
    if (!this.variables[index]) return;
    this.variables[index] = { ...this.variables[index], ...patch };
    this.emit('variablesChanged');
    this.emit('changed');
  }

  removeVariable(index) {
    if (!this.variables[index]) return;
    this.variables.splice(index, 1);
    this.emit('variablesChanged');
    this.emit('changed');
  }

  _uniqueVarName() {
    let i = 1;
    const names = new Set(this.variables.map((v) => v.name));
    while (names.has('变量' + i)) i++;
    return '变量' + i;
  }

  setMeta(patch) {
    this.meta = { ...this.meta, ...patch };
    this.emit('metaChanged');
    this.emit('changed');
  }

  /** 拖动结束后调用一次，统一记录到撤销栈 */
  commit() {
    this.emit('changed');
  }

  // ---------- 序列化 ----------
  toJSON() {
    return {
      meta: this.meta,
      variables: this.variables,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      groups: [...this.groups.values()],
    };
  }

  fromJSON(data) {
    this.reset(false);
    if (data.meta) this.meta = data.meta;
    this.variables = data.variables || [];
    (data.nodes || []).forEach((n) => this.nodes.set(n.id, n));
    (data.edges || []).forEach((e) => this.edges.set(e.id, e));
    (data.groups || []).forEach((g) => this.groups.set(g.id, g));
    // 还原自增序号，避免 id 冲突（节点/连线/组共用计数器）
    let max = 0;
    for (const id of [...this.nodes.keys(), ...this.edges.keys(), ...this.groups.keys()]) {
      const m = /_(\d+)$/.exec(id);
      if (m) max = Math.max(max, +m[1]);
    }
    this._seq = max + 1;
    this.emit('loaded');
    this.emit('changed');
  }
}

// 收集某节点引用到的变量名（用于把节点存成资产时一并带上变量定义）。
function collectVars(node, set) {
  const add = (arr, key) => (arr || []).forEach((x) => { if (x && x[key]) set.add(x[key]); });
  if (node.type === 'choice') (node.data.options || []).forEach((o) => add(o.effects, 'var'));
  else if (node.type === 'condition') add(node.data.clauses, 'var');
  else if (node.type === 'setvar') add(node.data.assignments, 'var');
}
