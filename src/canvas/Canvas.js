// 自研画布：负责把模型渲染成可拖拽、可连线、可缩放的节点图。
// 故意不依赖第三方库——这样 UI/UX 完全可控，且“无需构建、丢文件即运行”。
// 节点用 HTML（方便排版与无障碍），连线用 SVG 贝塞尔曲线。
import { NODE_TYPES, outputPorts, OP_SYMBOL } from '../core/nodeTypes.js';

const GRID = 24;
const NODE_MIN_WIDTH = 248;
const NODE_MAX_WIDTH = 440;
const LAYOUT_GAP_X = 150;
const LAYOUT_GAP_Y = 48;
const LAYOUT_MARGIN = 96;
const MAX_LAYOUT_COLUMNS = 12;
// 折叠「组件」节点的固定尺寸
const COLLAPSE_W = 220, COLLAPSE_H = 64;

export class Canvas {
  /**
   * @param {GraphModel} model
   * @param {HTMLElement} root  画布容器
   * @param {(sel:{type:string,id:string}|null)=>void} onSelect 选中变化回调
   */
  constructor(model, root, onSelect) {
    this.model = model;
    this.root = root;
    this.onSelect = onSelect || (() => {});
    this.panX = 60;
    this.panY = 60;
    this.zoom = 1;
    this.selection = null;

    root.classList.add('canvas');
    root.innerHTML = `
      <div class="canvas__content">
        <svg class="canvas__edges" xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
      <div class="canvas__hint">
        <div class="canvas__hint-emoji">🎬</div>
        <h2>开始编织你的剧情</h2>
        <p>从左侧把「开始 / 对话 / 选择」拖进来，或点击它们。<br>
        拖动节点右侧的小圆点连到下一个节点。</p>
      </div>`;
    this.content = root.querySelector('.canvas__content');
    this.svg = root.querySelector('.canvas__edges');
    this.hint = root.querySelector('.canvas__hint');

    // 多选与组：selectedIds 记录当前选中的节点；groupsLayer 在节点下方画组背景
    this.selectedIds = new Set();
    this.onAssetDrop = null; // (assetId, contentPoint) => void，由 main 注入
    this.groupsLayer = document.createElement('div');
    this.groupsLayer.className = 'canvas__groups';
    this.content.insertBefore(this.groupsLayer, this.content.firstChild);

    this._bind();
    this._wireModel();
    this.applyTransform();
    this.renderAll();
  }

  _wireModel() {
    this.model.on('loaded', () => { this.selection = null; this.selectedIds = new Set(); this.onSelect(null); this.renderAll(); });
    this.model.on('nodeAdded', (n) => { this._renderNode(n); this.drawEdges(); this._refreshHint(); });
    this.model.on('nodeRemoved', () => { this.renderAll(); });
    this.model.on('nodeChanged', ({ node }) => { this._renderNode(node); this.drawEdges(); });
    this.model.on('edgeAdded', () => this.drawEdges());
    this.model.on('edgeRemoved', () => this.drawEdges());
    this.model.on('groupsChanged', () => this._renderGroups());
    this.model.on('nodeMoved', (n) => {
      const el = this._nodeEl(n.id);
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
      this.drawEdges();
      this._updateGroupRects();
    });
    this.model.on('nodeResized', (n) => {
      const el = this._nodeEl(n.id);
      if (el) {
        if (n.w) el.style.width = n.w + 'px';
        if (n.h) { el.style.height = n.h + 'px'; el.classList.add('node--sized'); }
      }
      this.drawEdges();
      this._updateGroupRects();
    });
  }

  _bind() {
    this.root.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.root.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    // 允许从调色板拖拽落点
    this.root.addEventListener('dragover', (e) => { e.preventDefault(); });
    this.root.addEventListener('drop', (e) => this._onDrop(e));
  }

  // ---------- 坐标 ----------
  screenToContent(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.panX) / this.zoom,
      y: (clientY - r.top - this.panY) / this.zoom,
    };
  }

  applyTransform() {
    this.content.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    // 无限网格背景跟随平移/缩放
    this.root.style.backgroundSize = `${GRID * this.zoom}px ${GRID * this.zoom}px`;
    this.root.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
    this.onSelect && this.model.emit('viewChanged', { zoom: this.zoom });
  }

  // ---------- 渲染 ----------
  renderAll() {
    [...this.content.querySelectorAll('.node')].forEach((n) => n.remove());
    for (const node of this.model.nodes.values()) this._renderNode(node);
    this._renderGroups();
    this.drawEdges();
    this._refreshHint();
    this._applySelectionClass();
  }

  _refreshHint() {
    this.hint.style.display = this.model.nodes.size ? 'none' : '';
  }

  _nodeEl(id) {
    return this.content.querySelector(`.node[data-node="${id}"]`);
  }

  _renderNode(node) {
    const existing = this._nodeEl(node.id);
    const def = NODE_TYPES[node.type];
    const el = document.createElement('div');
    el.className = `node node--${node.type}`;
    el.dataset.node = node.id;
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.style.setProperty('--node-color', def.color);
    // 旧工程可能保存了过窄的宽度；渲染时兜底，避免英文逐字竖排。
    const width = node.w ? clamp(node.w, NODE_MIN_WIDTH, NODE_MAX_WIDTH) : preferredNodeWidth(node);
    el.style.width = width + 'px';
    if (node.h) { el.style.height = node.h + 'px'; el.classList.add('node--sized'); }
    el.innerHTML = this._nodeInner(node, def);
    if (existing) existing.replaceWith(el);
    else this.content.appendChild(el);
    if (this.selectedIds.has(node.id)) el.classList.add('is-selected');
  }

  _nodeInner(node, def) {
    const input = def.hasInput
      ? `<div class="node__port node__port--in" data-port-in title="上一步接到这里"></div>`
      : '';
    const title = node.data.label && (node.type === 'start' || node.type === 'end')
      ? `${def.label} · ${esc(node.data.label)}`
      : def.label;
    return `
      ${input}
      <div class="node__header">
        <span class="node__icon">${def.icon}</span>
        <span class="node__title">${esc(title)}</span>
      </div>
      <div class="node__body">${this._nodeBody(node)}</div>
      <div class="node__resize" data-resize title="拖动调整节点大小"></div>`;
  }

  _nodeBody(node) {
    const outPort = (id, extra = '') =>
      `<div class="node__port node__port--out ${extra}" data-port="${id}" title="拖动连线到下一个节点"></div>`;

    switch (node.type) {
      case 'start':
        return `<div class="node__single">${outPort('out')}<span class="node__hint-text">剧情从这里开始</span></div>`;
      case 'dialogue':
        return `
          <div class="node__single">
            ${node.data.speaker ? `<span class="node__speaker">${esc(node.data.speaker)}</span>` : `<span class="node__speaker node__speaker--empty">未命名角色</span>`}
            ${outPort('out')}
          </div>
          <div class="node__text">${esc(node.data.text) || '<span class="node__muted">（空对话，点此在右侧编辑）</span>'}</div>`;
      case 'choice': {
        const prompt = node.data.prompt ? `<div class="node__text node__prompt">${esc(node.data.prompt)}</div>` : '';
        const rows = (node.data.options || []).map((o) => `
          <div class="node__row">
            <span class="node__row-text">${esc(o.text) || '<span class="node__muted">空选项</span>'}</span>
            ${(o.effects || []).map(badge).join('')}
            ${outPort(o.id)}
          </div>`).join('');
        return prompt + `<div class="node__rows">${rows || '<div class="node__muted">暂无选项</div>'}</div>`;
      }
      case 'condition': {
        const m = node.data.match || 'all';
        const sep = (m === 'any' || m === 'nor') ? ' <b>或</b> ' : ' <b>且</b> ';
        const clauses = (node.data.clauses || []).map(clauseText).join(sep);
        const modeLabel = { all: '且 AND', any: '或 OR', nand: '与非 NAND', nor: '或非 NOR' }[m];
        const negated = (m === 'nand' || m === 'nor');
        const body = clauses
          ? (negated ? `<span class="node__cond-neg">非（</span>${clauses}<span class="node__cond-neg">）</span>` : clauses)
          : '<span class="node__muted">未设置条件</span>';
        return `
          <div class="node__cond-mode">${modeLabel}</div>
          <div class="node__text node__cond">${body}</div>
          <div class="node__row node__row--true"><span class="node__row-text">是 →</span>${outPort('true', 'node__port--true')}</div>
          <div class="node__row node__row--false"><span class="node__row-text">否 →</span>${outPort('false', 'node__port--false')}</div>`;
      }
      case 'setvar': {
        const items = (node.data.assignments || []).map(badge).join('') || '<span class="node__muted">未设置</span>';
        return `<div class="node__single"><div class="node__badges">${items}</div>${outPort('out')}</div>`;
      }
      case 'end':
        return `<div class="node__text">${node.data.ending ? '🏁 ' + esc(node.data.ending) : '<span class="node__muted">结束（可在右侧命名结局）</span>'}</div>`;
      case 'note':
        return `<div class="node__note">${esc(node.data.text) || ''}</div>`;
      default:
        return this._pluginNodeBody(node, outPort);
    }
  }

  // 插件注册的自定义节点：用类型 def 的 summary + outputPorts 通用渲染。
  _pluginNodeBody(node, outPort) {
    const def = NODE_TYPES[node.type];
    if (!def) return '';
    const summary = def.summary ? def.summary(node, esc) : '';
    const ports = outputPorts(node);
    if (ports.length === 0) {
      return `<div class="node__text">${summary || '<span class="node__muted">（无输出）</span>'}</div>`;
    }
    if (ports.length === 1 && !ports[0].label) {
      return `<div class="node__single"><div class="node__text">${summary || ''}</div>${outPort(ports[0].id)}</div>`;
    }
    const rows = ports.map((p) => `
      <div class="node__row"><span class="node__row-text">${esc(p.label) || ''} →</span>${outPort(p.id)}</div>`).join('');
    return `<div class="node__text">${summary || ''}</div><div class="node__rows">${rows}</div>`;
  }

  // ---------- 连线 ----------
  drawEdges() {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg.innerHTML = '';
    for (const edge of this.model.edges.values()) {
      const sg = this._collapsedGroupOf(edge.source);
      const tg = this._collapsedGroupOf(edge.target);
      if (sg && tg && sg === tg) continue; // 组内连线在折叠时隐藏
      const a = sg ? this._collapsedAnchorOut(sg) : this._portCenter(edge.source, edge.sourcePort, 'out');
      const b = tg ? this._collapsedAnchorIn(tg) : this._inputCenter(edge.target);
      if (!a || !b) continue;
      const d = bezier(a, b);
      const g = document.createElementNS(ns, 'g');
      g.dataset.edge = edge.id;
      g.setAttribute('class', 'edge' + (this.selection?.type === 'edge' && this.selection.id === edge.id ? ' is-selected' : ''));

      const hit = document.createElementNS(ns, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'edge__hit');

      const line = document.createElementNS(ns, 'path');
      line.setAttribute('d', d);
      line.setAttribute('class', 'edge__line');

      g.append(hit, line);

      if (this.selection?.type === 'edge' && this.selection.id === edge.id) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const del = document.createElementNS(ns, 'circle');
        del.setAttribute('cx', mid.x); del.setAttribute('cy', mid.y); del.setAttribute('r', 9);
        del.setAttribute('class', 'edge__del');
        del.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); this.model.removeEdge(edge.id); this._select(null); });
        const x = document.createElementNS(ns, 'text');
        x.setAttribute('x', mid.x); x.setAttribute('y', mid.y + 4); x.setAttribute('class', 'edge__del-x');
        x.textContent = '×';
        x.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); this.model.removeEdge(edge.id); this._select(null); });
        g.append(del, x);
      }
      this.svg.appendChild(g);
    }
  }

  _portCenter(nodeId, portId) {
    const el = this.content.querySelector(`.node[data-node="${nodeId}"] [data-port="${portId}"]`);
    return this._centerOf(el);
  }
  _inputCenter(nodeId) {
    const el = this.content.querySelector(`.node[data-node="${nodeId}"] [data-port-in]`);
    if (el) return this._centerOf(el);
    // 没有显式输入口时，用节点左缘中点
    const node = this._nodeEl(nodeId);
    if (!node) return null;
    const m = this.model.nodes.get(nodeId);
    return { x: m.x, y: m.y + node.offsetHeight / 2 };
  }
  _centerOf(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cr = this.root.getBoundingClientRect();
    return {
      x: (r.left + r.width / 2 - cr.left - this.panX) / this.zoom,
      y: (r.top + r.height / 2 - cr.top - this.panY) / this.zoom,
    };
  }

  // ---------- 交互 ----------
  _onPointerDown(e) {
    const portOut = e.target.closest('.node__port--out');
    const nodeEl = e.target.closest('.node');
    const edgeEl = e.target.closest('[data-edge]');
    const resizeEl = e.target.closest('[data-resize]');
    const groupBar = e.target.closest('[data-group-bar]');
    const collapsedBar = e.target.closest('[data-group-collapsedbar]');

    // 组操作按钮交给各自的 click 处理，不启动拖拽
    if (e.target.closest('[data-group-ungroup],[data-group-collapse],[data-group-saveasset],[data-group-expand]')) return;
    if (collapsedBar) {
      const groupEl = e.target.closest('[data-group]');
      const g = this.model.groups.get(groupEl.dataset.group);
      if (g) { e.preventDefault(); this._setNodeSelection(g.members.slice()); this._startCollapsedDrag(g, e); }
      return;
    }
    if (groupBar) {
      const groupEl = e.target.closest('[data-group]');
      const g = this.model.groups.get(groupEl.dataset.group);
      if (g) {
        e.preventDefault();
        this._setNodeSelection(g.members.slice());
        this._startMoveDrag(g.members.slice(), e);
      }
      return;
    }
    if (resizeEl && nodeEl) {
      e.preventDefault();
      this._setNodeSelection([nodeEl.dataset.node]);
      this._startNodeResize(nodeEl, e);
      return;
    }
    if (portOut && nodeEl) {
      e.preventDefault();
      this._startConnect(nodeEl.dataset.node, portOut.dataset.port, e);
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.node;
      if (e.shiftKey) {
        const ids = new Set(this.selectedIds);
        if (ids.has(id)) ids.delete(id); else ids.add(id);
        this._setNodeSelection([...ids]);
        return; // Shift 只做多选，不拖动
      }
      if (!this.selectedIds.has(id)) this._setNodeSelection([id]);
      this._startMoveDrag([...this.selectedIds], e);
      return;
    }
    if (edgeEl) {
      this._select({ type: 'edge', id: edgeEl.dataset.edge });
      return;
    }
    // 空白处：Shift+拖 = 框选；否则平移
    this._select(null);
    if (e.shiftKey) this._startMarquee(e);
    else this._startPan(e);
  }

  _startNodeDrag(nodeEl, e) {
    this._startMoveDrag([nodeEl.dataset.node], e);
  }

  // 同时移动多个节点（单选/多选/整组拖动共用）
  _startMoveDrag(ids, e) {
    const starts = ids.filter((id) => this.model.nodes.has(id))
      .map((id) => { const n = this.model.nodes.get(id); return { id, ox: n.x, oy: n.y }; });
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - sx) / this.zoom;
      const dy = (ev.clientY - sy) / this.zoom;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      for (const s of starts) this.model.moveNode(s.id, s.ox + dx, s.oy + dy);
      this._updateGroupRects();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) this.model.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // 拖动右下角手柄：调整节点宽/高（解决长文本「挤在一列」的问题）。
  _startNodeResize(nodeEl, e) {
    const id = nodeEl.dataset.node;
    const sx = e.clientX, sy = e.clientY;
    const startW = nodeEl.offsetWidth, startH = nodeEl.offsetHeight;
    let changed = false;
    const move = (ev) => {
      const w = Math.max(160, Math.min(640, startW + (ev.clientX - sx) / this.zoom));
      const h = Math.max(70, Math.min(640, startH + (ev.clientY - sy) / this.zoom));
      changed = true;
      this.model.resizeNode(id, w, h);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (changed) this.model.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _startConnect(sourceId, sourcePort, e) {
    const ns = 'http://www.w3.org/2000/svg';
    const temp = document.createElementNS(ns, 'path');
    temp.setAttribute('class', 'edge__line edge__temp');
    this.svg.appendChild(temp);
    const a = this._portCenter(sourceId, sourcePort);

    const move = (ev) => {
      const b = this.screenToContent(ev.clientX, ev.clientY);
      temp.setAttribute('d', bezier(a, b));
      const overEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node');
      this.content.querySelectorAll('.node.is-drop-target').forEach((n) => n.classList.remove('is-drop-target'));
      if (overEl && overEl.dataset.node !== sourceId) {
        const t = this.model.nodes.get(overEl.dataset.node);
        if (t && NODE_TYPES[t.type].hasInput) overEl.classList.add('is-drop-target');
      }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      temp.remove();
      this.content.querySelectorAll('.node.is-drop-target').forEach((n) => n.classList.remove('is-drop-target'));
      const overEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node');
      if (overEl) {
        // 落在已有节点上：直接连线
        if (overEl.dataset.node !== sourceId) {
          this.model.addEdge(sourceId, sourcePort, overEl.dataset.node);
        }
        return;
      }
      // 落在空白处：在光标旁弹出二级菜单，选完即新建节点并自动连线
      this._openNodeMenu(ev.clientX, ev.clientY, sourceId, sourcePort);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // 从端口拖到空白处松手时：在光标旁弹出「新建并连接」二级菜单
  _openNodeMenu(clientX, clientY, sourceId, sourcePort) {
    this._closeNodeMenu();
    const menu = document.createElement('div');
    menu.className = 'node-menu';
    const order = ['dialogue', 'choice', 'condition', 'setvar', 'end'];
    menu.innerHTML =
      `<div class="node-menu__title">在此新建并连接</div>` +
      order.map((type) => {
        const def = NODE_TYPES[type];
        return `<button class="node-menu__item" data-type="${type}" style="--node-color:${def.color}">
          <span class="node-menu__icon">${def.icon}</span>
          <span class="node-menu__meta">
            <span class="node-menu__name">${def.label}</span>
            <span class="node-menu__desc">${esc(def.desc)}</span>
          </span>
        </button>`;
      }).join('') +
      `<button class="node-menu__item node-menu__item--cancel" data-type="">✕ 取消</button>`;
    document.body.appendChild(menu);
    this._nodeMenu = menu;

    // 定位在光标旁，且不超出视口
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const left = Math.max(8, Math.min(clientX + 4, window.innerWidth - mw - 8));
    const top = Math.max(8, Math.min(clientY + 4, window.innerHeight - mh - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // 落点（内容坐标）：新节点放这里，输入口大致对准光标
    const p = this.screenToContent(clientX, clientY);

    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    menu.querySelectorAll('.node-menu__item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        if (type && NODE_TYPES[type]) {
          const node = this.model.addNode(type, snap(p.x), snap(p.y) - 20);
          this.model.addEdge(sourceId, sourcePort, node.id);
          this._select({ type: 'node', id: node.id });
        }
        this._closeNodeMenu();
      });
    });

    // 点击别处或按 Esc 关闭
    this._onMenuOutside = (e) => { if (this._nodeMenu && !this._nodeMenu.contains(e.target)) this._closeNodeMenu(); };
    this._onMenuKey = (e) => { if (e.key === 'Escape') this._closeNodeMenu(); };
    setTimeout(() => {
      window.addEventListener('pointerdown', this._onMenuOutside, true);
      window.addEventListener('keydown', this._onMenuKey, true);
    }, 0);
  }

  _closeNodeMenu() {
    if (!this._nodeMenu) return;
    this._nodeMenu.remove();
    this._nodeMenu = null;
    window.removeEventListener('pointerdown', this._onMenuOutside, true);
    window.removeEventListener('keydown', this._onMenuKey, true);
  }

  _startPan(e) {
    const sx = e.clientX, sy = e.clientY;
    const px = this.panX, py = this.panY;
    this.root.classList.add('canvas--panning');
    const move = (ev) => {
      this.panX = px + (ev.clientX - sx);
      this.panY = py + (ev.clientY - sy);
      this.applyTransform();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.root.classList.remove('canvas--panning');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _onWheel(e) {
    e.preventDefault();
    const r = this.root.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const old = this.zoom;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const z = Math.min(2.5, Math.max(0.15, old * factor));
    this.panX = mx - (mx - this.panX) * (z / old);
    this.panY = my - (my - this.panY) * (z / old);
    this.zoom = z;
    this.applyTransform();
    this.drawEdges();
  }

  _onDrop(e) {
    e.preventDefault();
    // 从资产库拖拽过来：实例化预制体
    const assetId = e.dataTransfer.getData('text/asset-id');
    if (assetId) {
      const p = this.screenToContent(e.clientX, e.clientY);
      if (this.onAssetDrop) this.onAssetDrop(assetId, { x: snap(p.x), y: snap(p.y) });
      return;
    }
    const type = e.dataTransfer.getData('text/node-type');
    if (!type || !NODE_TYPES[type]) return;
    const p = this.screenToContent(e.clientX, e.clientY);
    const node = this.model.addNode(type, snap(p.x) - 90, snap(p.y) - 20);
    this._select({ type: 'node', id: node.id });
  }

  // ---------- 选择 ----------
  // 单选/边/空：sel 为 {type:'node'|'edge', id} 或 null
  _select(sel) {
    if (sel && sel.type === 'node') { this._setNodeSelection([sel.id]); return; }
    this.selectedIds = new Set();
    this.selection = sel || null;
    this._applySelectionClass();
    this.drawEdges();
    this.onSelect(sel || null);
  }
  select(sel) { this._select(sel); } // 对外

  // 节点多选：一个时同单选驱动检查器；多个时发出 multi 选择
  _setNodeSelection(ids) {
    this.selectedIds = new Set(ids.filter((id) => this.model.nodes.has(id)));
    if (this.selectedIds.size === 1) {
      this.selection = { type: 'node', id: [...this.selectedIds][0] };
      this._applySelectionClass();
      this.drawEdges();
      this.onSelect(this.selection);
    } else if (this.selectedIds.size > 1) {
      this.selection = null;
      this._applySelectionClass();
      this.drawEdges();
      this.onSelect({ type: 'multi', ids: [...this.selectedIds] });
    } else {
      this.selection = null;
      this._applySelectionClass();
      this.drawEdges();
      this.onSelect(null);
    }
  }
  selectNodes(ids) { this._setNodeSelection(ids); } // 对外
  getSelectedNodeIds() { return [...this.selectedIds]; }

  _applySelectionClass() {
    this.content.querySelectorAll('.node.is-selected').forEach((n) => n.classList.remove('is-selected'));
    for (const id of this.selectedIds) this._nodeEl(id)?.classList.add('is-selected');
  }

  // 画布可视中心的内容坐标（资产「实例化到中央」用）
  viewportCenterContent() {
    const r = this.root.getBoundingClientRect();
    return this.screenToContent(r.left + r.width / 2, r.top + r.height / 2);
  }

  /**
   * 按剧情流向重排节点。输出边决定列，列内按上游节点的垂直重心排序，
   * 因而既避免节点相叠，也能显著减少分支连线交叉。
   */
  autoLayout() {
    const nodes = [...this.model.nodes.values()];
    if (!nodes.length) return { count: 0, columns: 0 };

    this._select(null);
    // 统一校正历史工程的窄节点，并解除会把正文拉成超长列的固定高度。
    for (const node of nodes) {
      node.w = preferredNodeWidth(node);
      delete node.h;
    }
    this.renderAll();

    const ids = new Set(nodes.map((n) => n.id));
    const next = new Map(nodes.map((n) => [n.id, []]));
    const prev = new Map(nodes.map((n) => [n.id, []]));
    for (const edge of this.model.edges.values()) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
      next.get(edge.source).push(edge.target);
      prev.get(edge.target).push(edge.source);
    }

    const connected = new Set(nodes.filter((n) => next.get(n.id).length || prev.get(n.id).length).map((n) => n.id));
    const rank = new Map();
    const indegree = new Map(nodes.map((n) => [n.id, prev.get(n.id).length]));
    const roots = nodes
      .filter((n) => connected.has(n.id) && (n.type === 'start' || indegree.get(n.id) === 0))
      .sort((a, b) => (a.type === 'start' ? -1 : 0) - (b.type === 'start' ? -1 : 0) || a.y - b.y);
    const queue = roots.map((n) => n.id);
    for (const id of queue) rank.set(id, 0);

    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      const here = rank.get(id) || 0;
      for (const target of next.get(id)) {
        rank.set(target, Math.max(rank.get(target) ?? 0, here + 1));
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) queue.push(target);
      }
    }

    // 循环图没有入度为 0 的入口时，也保证每个节点都有稳定的位置。
    let maxRank = Math.max(0, ...rank.values());
    for (const node of nodes.filter((n) => connected.has(n.id) && !rank.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x)) {
      const knownParents = prev.get(node.id).map((id) => rank.get(id)).filter((v) => v != null);
      rank.set(node.id, knownParents.length ? Math.max(...knownParents) + 1 : ++maxRank);
      maxRank = Math.max(maxRank, rank.get(node.id));
    }

    // 没有连线的便签/注释单独收在末列，避免占用主剧情起点列。
    for (const node of nodes) if (!connected.has(node.id)) rank.set(node.id, maxRank + 1);
    maxRank = Math.max(...rank.values());

    const columns = Array.from({ length: maxRank + 1 }, () => []);
    for (const node of nodes) columns[rank.get(node.id)].push(node);
    const sizes = new Map(nodes.map((node) => {
      const el = this._nodeEl(node.id);
      return [node.id, { w: el?.offsetWidth || node.w || NODE_MIN_WIDTH, h: el?.offsetHeight || 88 }];
    }));

    // 很长的线性剧情若无限向右铺开，全览会小到难以阅读。
    // 因此固定最多 12 列，到列尾时换到下一条水平带，保留清晰的阅读节奏。
    const visualColumns = Math.min(MAX_LAYOUT_COLUMNS, columns.length);
    const visualColumnWidths = Array.from({ length: visualColumns }, (_, visualColumn) => {
      const widths = columns
        .filter((_, column) => column % visualColumns === visualColumn)
        .flatMap((list) => list.map((node) => sizes.get(node.id).w));
      return Math.max(NODE_MIN_WIDTH, ...widths);
    });
    const columnX = [];
    let x = LAYOUT_MARGIN;
    for (let i = 0; i < visualColumns; i++) {
      columnX[i] = x;
      x += visualColumnWidths[i] + LAYOUT_GAP_X;
    }

    let bandTop = LAYOUT_MARGIN;
    const bands = Math.ceil(columns.length / visualColumns);
    for (let band = 0; band < bands; band++) {
      let bandBottom = bandTop;
      for (let visualColumn = 0; visualColumn < visualColumns; visualColumn++) {
        const column = band * visualColumns + visualColumn;
        const list = columns[column];
        if (!list) continue;
        list.sort((a, b) => layoutBarycenter(a, this.model, prev, rank, sizes) - layoutBarycenter(b, this.model, prev, rank, sizes) || a.y - b.y || a.x - b.x);
        let y = bandTop;
        for (const node of list) {
          node.x = snap(columnX[visualColumn]);
          node.y = snap(y);
          y += sizes.get(node.id).h + LAYOUT_GAP_Y;
        }
        bandBottom = Math.max(bandBottom, y - LAYOUT_GAP_Y);
      }
      bandTop = snap(bandBottom + LAYOUT_GAP_Y * 2);
    }

    this.renderAll();
    this.model.commit();
    return { count: nodes.length, columns: visualColumns, bands };
  }

  // ---------- 框选 ----------
  _startMarquee(e) {
    const box = document.createElement('div');
    box.className = 'marquee';
    this.root.appendChild(box);
    const sx = e.clientX, sy = e.clientY;
    const cr = this.root.getBoundingClientRect();
    const move = (ev) => {
      const x = Math.min(sx, ev.clientX), y = Math.min(sy, ev.clientY);
      box.style.left = (x - cr.left) + 'px';
      box.style.top = (y - cr.top) + 'px';
      box.style.width = Math.abs(ev.clientX - sx) + 'px';
      box.style.height = Math.abs(ev.clientY - sy) + 'px';
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const a = this.screenToContent(Math.min(sx, ev.clientX), Math.min(sy, ev.clientY));
      const b = this.screenToContent(Math.max(sx, ev.clientX), Math.max(sy, ev.clientY));
      box.remove();
      const ids = [];
      for (const n of this.model.nodes.values()) {
        const el = this._nodeEl(n.id);
        const w = el ? el.offsetWidth : 200, h = el ? el.offsetHeight : 80;
        if (n.x < b.x && n.x + w > a.x && n.y < b.y && n.y + h > a.y) ids.push(n.id);
      }
      this._setNodeSelection(ids);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------- 组渲染 ----------
  _renderGroups() {
    this.groupsLayer.innerHTML = '';
    for (const g of this.model.groups.values()) {
      if (g.collapsed) { this._renderCollapsedGroup(g); continue; }
      const rect = this._groupRect(g);
      if (!rect) continue;
      const div = document.createElement('div');
      div.className = 'group';
      div.dataset.group = g.id;
      div.style.left = rect.x + 'px';
      div.style.top = rect.y + 'px';
      div.style.width = rect.w + 'px';
      div.style.height = rect.h + 'px';
      div.style.setProperty('--group-color', g.color || '#64748b');
      div.innerHTML = `<div class="group__bar" data-group-bar>
        <span class="group__label">${esc(g.label || '组')}</span>
        <span class="group__ops">
          <button class="group__btn" data-group-collapse title="折叠为组件（像 UE 蓝图那样收成一个节点）">⊟</button>
          <button class="group__btn" data-group-saveasset title="把这个组存成可复用组件（资产库）">📦</button>
          <button class="group__btn" data-group-ungroup title="解散组（保留节点）">✕</button>
        </span></div>`;
      div.querySelector('[data-group-collapse]').addEventListener('click', (ev) => { ev.stopPropagation(); this.collapseGroup(g.id); });
      div.querySelector('[data-group-saveasset]').addEventListener('click', (ev) => { ev.stopPropagation(); this.onGroupSaveAsset?.(g.members.slice(), g.label); });
      div.querySelector('[data-group-ungroup]').addEventListener('click', (ev) => { ev.stopPropagation(); this.model.removeGroup(g.id); });
      this.groupsLayer.appendChild(div);
    }
    this._applyGroupVisibility();
  }

  // 折叠后的「组件」节点：像 UE 蓝图 Collapse Nodes 那样收成一个块，跨界连线改接到它身上。
  _renderCollapsedGroup(g) {
    const at = g.collapsedAt || { x: 0, y: 0 };
    const div = document.createElement('div');
    div.className = 'group group--collapsed';
    div.dataset.group = g.id;
    div.style.left = at.x + 'px';
    div.style.top = at.y + 'px';
    div.style.width = COLLAPSE_W + 'px';
    div.style.height = COLLAPSE_H + 'px';
    div.style.setProperty('--group-color', g.color || '#64748b');
    div.title = '双击展开组件';
    div.innerHTML = `
      <div class="group__cport group__cport--in"></div>
      <div class="group__cbar" data-group-collapsedbar>
        <span class="group__cicon">🧩</span>
        <span class="group__label">${esc(g.label || '组件')}</span>
        <span class="group__ops">
          <button class="group__btn" data-group-saveasset title="存为可复用组件（资产库）">📦</button>
          <button class="group__btn" data-group-expand title="展开组件">⤢</button>
        </span>
      </div>
      <div class="group__cmeta">${g.members.length} 个节点 · 折叠为组件</div>
      <div class="group__cport group__cport--out"></div>`;
    div.querySelector('[data-group-expand]').addEventListener('click', (ev) => { ev.stopPropagation(); this.expandGroup(g.id); });
    div.querySelector('[data-group-saveasset]').addEventListener('click', (ev) => { ev.stopPropagation(); this.onGroupSaveAsset?.(g.members.slice(), g.label); });
    div.addEventListener('dblclick', () => this.expandGroup(g.id));
    this.groupsLayer.appendChild(div);
  }

  // 折叠 / 展开
  collapseGroup(id) {
    const g = this.model.groups.get(id);
    if (!g) return;
    const rect = this._groupRect(g);
    const at = rect ? { x: rect.x, y: rect.y } : { x: 0, y: 0 };
    this.model.updateGroup(id, { collapsed: true, collapsedAt: at });
    this._select(null);
  }
  expandGroup(id) {
    this.model.updateGroup(id, { collapsed: false });
  }

  _collapsedGroupOf(nodeId) {
    for (const g of this.model.groups.values()) {
      if (g.collapsed && g.members.includes(nodeId)) return g;
    }
    return null;
  }
  _collapsedAnchorIn(g) {
    const at = g.collapsedAt || { x: 0, y: 0 };
    return { x: at.x, y: at.y + COLLAPSE_H / 2 };
  }
  _collapsedAnchorOut(g) {
    const at = g.collapsedAt || { x: 0, y: 0 };
    return { x: at.x + COLLAPSE_W, y: at.y + COLLAPSE_H / 2 };
  }

  // 折叠时隐藏成员节点的 DOM，展开时恢复
  _applyGroupVisibility() {
    const hidden = new Set();
    for (const g of this.model.groups.values()) if (g.collapsed) g.members.forEach((id) => hidden.add(id));
    for (const node of this.model.nodes.values()) {
      const el = this._nodeEl(node.id);
      if (el) el.style.display = hidden.has(node.id) ? 'none' : '';
    }
  }

  // 拖动折叠组件：整体移动其成员，并同步组件框位置
  _startCollapsedDrag(g, e) {
    const starts = g.members.filter((id) => this.model.nodes.has(id))
      .map((id) => { const n = this.model.nodes.get(id); return { id, ox: n.x, oy: n.y }; });
    const at0 = { ...(g.collapsedAt || { x: 0, y: 0 }) };
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - sx) / this.zoom;
      const dy = (ev.clientY - sy) / this.zoom;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      for (const s of starts) this.model.moveNode(s.id, s.ox + dx, s.oy + dy);
      g.collapsedAt = { x: at0.x + dx, y: at0.y + dy };
      const el = this.groupsLayer.querySelector(`[data-group="${g.id}"]`);
      if (el) { el.style.left = g.collapsedAt.x + 'px'; el.style.top = g.collapsedAt.y + 'px'; }
      this.drawEdges();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) this.model.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _groupRect(g) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (const id of g.members) {
      const n = this.model.nodes.get(id);
      if (!n) continue;
      any = true;
      const el = this._nodeEl(id);
      const w = el ? el.offsetWidth : 200, h = el ? el.offsetHeight : 80;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
    }
    if (!any) return null;
    const padX = 16, padTop = 36, padBottom = 14;
    return { x: minX - padX, y: minY - padTop, w: (maxX - minX) + padX * 2, h: (maxY - minY) + padTop + padBottom };
  }

  _updateGroupRects() {
    for (const div of this.groupsLayer.children) {
      const g = this.model.groups.get(div.dataset.group);
      if (!g || g.collapsed) continue; // 折叠组件用固定尺寸，不随成员重算
      const r = this._groupRect(g);
      if (!r) continue;
      div.style.left = r.x + 'px';
      div.style.top = r.y + 'px';
      div.style.width = r.w + 'px';
      div.style.height = r.h + 'px';
    }
  }

  // ---------- 视图 ----------
  fitView() {
    const nodes = [...this.model.nodes.values()];
    if (!nodes.length) { this.panX = 60; this.panY = 60; this.zoom = 1; this.applyTransform(); this.drawEdges(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const el = this._nodeEl(n.id);
      const w = el ? el.offsetWidth : 180;
      const h = el ? el.offsetHeight : 80;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
    }
    const r = this.root.getBoundingClientRect();
    const pad = 70;
    const zx = (r.width - pad * 2) / (maxX - minX || 1);
    const zy = (r.height - pad * 2) / (maxY - minY || 1);
    this.zoom = Math.min(1.2, Math.max(0.1, Math.min(zx, zy)));
    this.panX = pad - minX * this.zoom + Math.max(0, (r.width - pad * 2 - (maxX - minX) * this.zoom) / 2);
    this.panY = pad - minY * this.zoom + Math.max(0, (r.height - pad * 2 - (maxY - minY) * this.zoom) / 2);
    this.applyTransform();
    this.drawEdges();
  }

  resetZoom() { this.zoom = 1; this.applyTransform(); this.drawEdges(); }
}

// ---------- 工具函数 ----------
function bezier(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}
function snap(v) { return Math.round(v / GRID) * GRID; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function preferredNodeWidth(node) {
  const data = node.data || {};
  const texts = [];
  let base = 280;
  switch (node.type) {
    case 'start': base = 248; texts.push(data.label); break;
    case 'dialogue': base = 280; texts.push(data.speaker, data.text); break;
    case 'choice':
      base = 320;
      texts.push(data.prompt, ...(data.options || []).map((option) => option.text));
      break;
    case 'condition': base = 300; texts.push(...(data.clauses || []).map((clause) => `${clause.var || ''} ${clause.op || ''} ${clause.value || ''}`)); break;
    case 'setvar': base = 280; texts.push(...(data.assignments || []).map((item) => `${item.var || ''} ${item.op || ''} ${item.value || ''}`)); break;
    case 'end': base = 280; texts.push(data.label, data.ending); break;
    case 'note': base = 320; texts.push(data.text); break;
    default: base = 300; texts.push(JSON.stringify(data));
  }
  const longest = Math.max(0, ...texts.map((text) => Array.from(String(text || '')).length));
  return snap(clamp(Math.max(base, 200 + longest * 1.45), NODE_MIN_WIDTH, NODE_MAX_WIDTH));
}

function layoutBarycenter(node, model, prev, rank, sizes) {
  const parents = prev.get(node.id) || [];
  const positioned = parents.filter((id) => rank.get(id) < rank.get(node.id));
  if (!positioned.length) return node.y;
  // 上游节点的 y 会在更早的列中写回模型，取其垂直中心作为排序依据。
  const ys = positioned.map((id) => {
    const parent = model.nodes.get(id);
    return parent ? parent.y + (sizes.get(id)?.h || 0) / 2 : node.y;
  });
  return ys.reduce((sum, y) => sum + y, 0) / ys.length;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function badge(e) {
  const sym = OP_SYMBOL[e.op] || e.op;
  return `<span class="node__badge" title="${esc(e.var)} ${sym} ${esc(e.value)}">${esc(e.var) || '?'} ${sym}${esc(e.value)}</span>`;
}
function clauseText(c) {
  const sym = OP_SYMBOL[c.op] || c.op;
  return `<span class="node__clause">${esc(c.var) || '?'} ${sym} ${esc(c.value)}</span>`;
}
