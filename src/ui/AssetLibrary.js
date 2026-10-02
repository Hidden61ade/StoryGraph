// 资产库（预制体 / Prefab）：把选中的若干节点存成可复用的「剧情组件」，随时实例化到画布。
// 借鉴 Unity 的 Prefab 思想——一次设计、多处复用；实例是深拷贝，改实例不影响模板。
// 资产存在浏览器 localStorage，跨工程可用（例如把一段通用的「商店对话」复用到多个剧情）。
const STORE_KEY = 'storygraph.assets.v1';

export class AssetLibrary {
  constructor(model, root, { toast, getInstantiatePoint, promptName } = {}) {
    this.model = model;
    this.root = root;
    this.toast = toast || (() => {});
    this.getPoint = getInstantiatePoint || (() => ({ x: 120, y: 120 }));
    this.promptName = promptName || ((title, def) => Promise.resolve(def));
    this.onInstantiated = null; // (ids) => void，由 main 注入用于选中新节点
    this.assets = this._load();
    this.render();
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  }
  _save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.assets)); }
    catch { /* localStorage 不可用时静默 */ }
  }

  /** 由 main.js 调用：把当前多选的节点存成资产。 */
  saveFromSelection(nodeIds, name) {
    const payload = this.model.serializeSubgraph(nodeIds);
    if (!payload || !payload.nodes.length) {
      this.toast('请先在画布上框选 / Shift 多选若干节点', 'error');
      return;
    }
    const asset = {
      id: 'asset_' + Date.now().toString(36),
      name: name || ('剧情组件 ' + (this.assets.length + 1)),
      ...payload,
    };
    this.assets.unshift(asset);
    this._save();
    this.render();
    this.toast(`已存为资产「${asset.name}」`, 'success');
  }

  render() {
    this.root.innerHTML = `
      <div class="panel__title">资产库 <span class="panel__title-tag">${this.assets.length}</span></div>
      <div class="panel__hint">把选中的节点存成可复用组件（类似 Unity Prefab）。框选或 Shift 多选后，点顶栏「📦 存为资产」。拖动卡片到画布即可放置。</div>
      <div class="asset-list" id="assetList"></div>`;
    const list = this.root.querySelector('#assetList');
    if (!this.assets.length) {
      list.innerHTML = `<div class="muted" style="padding:8px 2px">还没有资产。框选几个节点 → 顶栏「📦 存为资产」。</div>`;
      return;
    }
    for (const a of this.assets) list.append(this._card(a));
  }

  _card(asset) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.draggable = true;
    card.innerHTML = `
      <div class="asset-card__main">
        <div class="asset-card__name">📦 ${esc(asset.name)}</div>
        <div class="asset-card__meta">${asset.nodes.length} 节点 · ${asset.edges.length} 连线${(asset.variables && asset.variables.length) ? ' · ' + asset.variables.length + ' 变量' : ''}</div>
      </div>
      <div class="asset-card__ops">
        <button class="icon-btn" data-act="use" title="实例化到画布中央">➕</button>
        <button class="icon-btn" data-act="rename" title="重命名">✎</button>
        <button class="icon-btn icon-btn--danger" data-act="del" title="删除资产">🗑</button>
      </div>`;
    card.querySelector('[data-act="use"]').addEventListener('click', () => this._instantiate(asset));
    card.querySelector('[data-act="rename"]').addEventListener('click', () => {
      Promise.resolve(this.promptName('资产名称', asset.name)).then((n) => {
        if (n && n.trim()) { asset.name = n.trim(); this._save(); this.render(); }
      });
    });
    card.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (confirm(`删除资产「${asset.name}」？此操作不可撤销。`)) {
        this.assets = this.assets.filter((a) => a !== asset);
        this._save(); this.render();
      }
    });
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/asset-id', asset.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    return card;
  }

  _instantiate(asset, at) {
    const p = at || this.getPoint();
    const ids = this.model.instantiatePrefab(asset, p.x, p.y);
    this.toast(`已实例化「${asset.name}」（${ids.length} 个节点）`, 'success');
    if (this.onInstantiated) this.onInstantiated(ids);
    return ids;
  }

  assetById(id) { return this.assets.find((a) => a.id === id); }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
