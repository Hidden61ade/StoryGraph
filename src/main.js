// 应用入口：把模型、画布、检查器、变量面板、工具栏装配起来，
// 并处理撤销/重做、文件读写、导出、快捷键、提示气泡等“外壳”逻辑。
import { GraphModel } from './core/GraphModel.js';
import { Canvas } from './canvas/Canvas.js';
import { Inspector } from './ui/Inspector.js';
import { VariablesPanel } from './ui/VariablesPanel.js';
import { setupToolbar, setupPalette } from './ui/Toolbar.js';
import { toEngineJSON, toUnityJSON, toYarn, validate } from './core/exporters.js';
import { PluginHost } from './core/PluginHost.js';
import { PreviewOverlay } from './play/PreviewOverlay.js';
import { AssetLibrary } from './ui/AssetLibrary.js';

// 标记应用已成功启动（模块能执行到这里，说明环境支持 ES 模块）。
// index.html 的兜底引导据此判断：未置位则说明是 file:// 双击打开，展示启动指引。
window.__sgBooted = true;

const model = new GraphModel();
const canvas = new Canvas(model, document.getElementById('canvas'), (sel) => handleSelect(sel));
const inspector = new Inspector(model, document.getElementById('inspector'));
new VariablesPanel(model, document.getElementById('variables'));

// 资产库（预制体）+ 侧栏标签切换
const assetLib = new AssetLibrary(model, document.getElementById('assets'), {
  toast,
  getInstantiatePoint: () => canvas.viewportCenterContent(),
  promptName: (title, def) => promptDialog(title, def),
});
assetLib.onInstantiated = (ids) => canvas.selectNodes(ids);
canvas.onAssetDrop = (assetId, p) => {
  const a = assetLib.assetById(assetId);
  if (!a) return;
  const ids = model.instantiatePrefab(a, p.x, p.y);
  canvas.selectNodes(ids);
  toast('已放置资产', 'success');
};
// 组「存为组件」→ 存入资产库（可跨工程复用）
canvas.onGroupSaveAsset = (memberIds, label) => {
  assetLib.saveFromSelection(memberIds, label || '组件');
  switchTab('assets');
};
setupSidebarTabs();

const toolbar = setupToolbar(document.getElementById('topbar'), {
  new: () => confirmReset(),
  open: () => document.getElementById('fileInput').click(),
  save: () => saveFile(),
  export: () => openExportDialog(),
  preview: () => openPreview(),
  group: () => groupSelection(),
  asset: () => saveSelectionAsAsset(),
  undo: () => history.undo(),
  redo: () => history.redo(),
  fit: () => canvas.fitView(),
  layout: () => organizeLayout(),
  validate: () => runValidate(),
  plugins: () => openPluginsManager(),
  sample: () => loadSample(),
  help: () => openHelp(),
  rename: (name) => model.setMeta({ name }),
});
setupPalette(document.getElementById('palette'), (type) => addCenteredNode(type));
function refreshPalette() { setupPalette(document.getElementById('palette'), (type) => addCenteredNode(type)); }

// ---------- 插件系统 ----------
// 核心通过 PluginHost 暴露扩展点；AI 等能力以插件形式加载，核心无插件也能运行。
const pluginHost = new PluginHost({
  model,
  canvas,
  ui: { toast, openDialog, confirm: (m) => window.confirm(m), download, prompt: (t, d) => promptDialog(t, d) },
  config: {}, // 异步加载后填充
  getMemory: async () => {
    const res = await fetch('src/context/MEMORY.md');
    return res.ok ? res.text() : '';
  },
  refreshInspector: () => inspector.render(inspector.selection),
  onToolbarButton: (btn) => addToolbarPluginButton(btn),
  onNodeTypeRegistered: () => refreshPalette(),
});
inspector.setPluginHost(pluginHost);

function addToolbarPluginButton(btn) {
  const slot = document.getElementById('pluginSlot');
  if (!slot) return;
  const b = document.createElement('button');
  b.className = 'btn btn--ai';
  b.textContent = btn.label;
  if (btn.title) b.title = btn.title;
  b.addEventListener('click', () => { try { btn.run(); } catch (e) { console.error(e); } });
  slot.appendChild(b);
}

// ---------- 状态栏 ----------
const statusbar = document.getElementById('statusbar');
function updateStatus() {
  statusbar.innerHTML = `
    <span class="status__item">📦 节点 ${model.nodes.size}</span>
    <span class="status__item">🔗 连线 ${model.edges.size}</span>
    <span class="status__item">🔢 变量 ${model.variables.length}</span>
    <span class="status__item status__item--right">🔎 ${Math.round(canvas.zoom * 100)}%</span>
    <span class="status__item">${dirty ? '● 未保存' : '✓ 已同步'}</span>`;
}
model.on('changed', () => { dirty = true; updateStatus(); });
model.on('viewChanged', updateStatus);
model.on('loaded', () => { toolbar.setTitle(model.meta.name); updateStatus(); });

// ---------- 撤销 / 重做（快照式，简单可靠）----------
const history = createHistory(model);

// ---------- 文件读写 ----------
let dirty = false;
document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      model.fromJSON(JSON.parse(reader.result));
      history.reset();
      const result = canvas.autoLayout();
      canvas.fitView();
      dirty = result.count > 0; updateStatus();
      toast(`已打开并整理 ${result.count} 个节点：${file.name}`, 'success');
    } catch (err) {
      toast('打开失败：文件格式不正确', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

function saveFile() {
  const data = JSON.stringify(model.toJSON(), null, 2);
  download(data, safeName(model.meta.name) + '.sg', 'application/json');
  dirty = false; updateStatus();
  toast('已保存工程文件', 'success');
}

// ---------- 导出引擎文件 ----------
function openExportDialog() {
  const issues = validate(model);
  const errors = issues.filter((i) => i.level === 'error');
  const engine = JSON.stringify(toEngineJSON(model), null, 2);
  const body = document.createElement('div');
  body.innerHTML = `
    <p>选择导出格式，导出后即可交给引擎/程序读取：</p>
    <div class="export-grid">
      <button class="btn btn--primary" id="expEngine">⬇ 引擎运行时 JSON</button>
      <button class="btn" id="expUnity">⬇ Unity 数据（.json）</button>
      <button class="btn" id="expYarn">⬇ Yarn 脚本（.yarn）</button>
    </div>
    ${errors.length ? `<div class="dialog__warn">⚠ 有 ${errors.length} 个错误，建议先「检查」修复，否则引擎可能无法正确运行。</div>` : '<div class="dialog__ok">✓ 未发现致命错误。</div>'}
    <details class="export-preview"><summary>预览引擎 JSON</summary><pre>${escapeHtml(engine.slice(0, 4000))}${engine.length > 4000 ? '\n…（已截断预览）' : ''}</pre></details>`;
  const dlg = openDialog('导出', body);
  body.querySelector('#expEngine').addEventListener('click', () => {
    download(engine, safeName(model.meta.name) + '.engine.json', 'application/json');
    toast('已导出引擎 JSON', 'success'); dlg.close();
  });
  body.querySelector('#expUnity').addEventListener('click', () => {
    download(JSON.stringify(toUnityJSON(model), null, 2), safeName(model.meta.name) + '.unity.json', 'application/json');
    toast('已导出 Unity 数据 JSON（配合 unity/ 里的 C# 脚本使用）', 'success'); dlg.close();
  });
  body.querySelector('#expYarn').addEventListener('click', () => {
    download(toYarn(model), safeName(model.meta.name) + '.yarn', 'text/plain');
    toast('已导出 Yarn 脚本', 'success'); dlg.close();
  });
}

(async function initPlugins() {
  // 1) 加载配置：优先 config.local.json（含 Key，已 gitignore），回退 config.example.json
  let config = {};
  for (const file of ['config.local.json', 'config.example.json']) {
    try {
      const res = await fetch(file);
      if (res.ok) { config = await res.json(); break; }
    } catch { /* 忽略，继续尝试 */ }
  }
  pluginHost.ctx.config = config;

  // 2) 读插件清单并动态加载（用户在「🧩 插件」面板里停用的记在 localStorage）
  try {
    const res = await fetch('plugins/plugins.json');
    if (!res.ok) return;
    pluginManifest = await res.json();
    const disabled = loadDisabledPlugins();
    const mods = [];
    for (const entry of pluginManifest.plugins || []) {
      if (entry.enabled === false || disabled.has(entry.id)) continue;
      try { mods.push(await import('../plugins/' + entry.path)); }
      catch (err) { console.error('插件载入失败：', entry, err); }
    }
    await pluginHost.loadAll(mods);
    refreshPalette(); // 插件可能注册了新节点类型
    inspector.render(inspector.selection); // 让已选中节点立即显示插件动作
  } catch (err) {
    console.error('插件系统初始化失败：', err);
  }
})();

// ---------- 插件管理（让「可插拔」可见可感）----------
let pluginManifest = { plugins: [] };
const DISABLED_KEY = 'storygraph.plugins.disabled';
function loadDisabledPlugins() {
  try { return new Set(JSON.parse(localStorage.getItem(DISABLED_KEY)) || []); }
  catch { return new Set(); }
}
function saveDisabledPlugins(set) {
  try { localStorage.setItem(DISABLED_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}
function openPluginsManager() {
  const disabled = loadDisabledPlugins();
  const body = document.createElement('div');
  const list = (pluginManifest.plugins || []).map((p) => {
    const on = p.enabled !== false && !disabled.has(p.id);
    return `<div class="plugin-card">
      <div class="plugin-card__head">
        <span class="plugin-card__name">🧩 ${escapeHtml(p.name || p.id)}</span>
        <label class="switch"><input type="checkbox" data-plugin="${escapeHtml(p.id)}" ${on ? 'checked' : ''}/><span>${on ? '已启用' : '已停用'}</span></label>
      </div>
      <div class="plugin-card__desc">${escapeHtml(p.desc || '')}</div>
      <div class="plugin-card__path">入口：plugins/${escapeHtml(p.path)}</div>
    </div>`;
  }).join('');
  body.innerHTML = `
    <p class="muted">以下能力都是「插件」——核心不依赖它们也能完整运行。在 <code>plugins/plugins.json</code> 登记新插件即生效。</p>
    <div class="plugin-cards">${list || '<div class="muted">未发现插件。</div>'}</div>
    <div class="dialog__ok" style="margin-top:12px">切换启用状态后，页面会重新加载以生效。</div>`;
  openDialog('🧩 插件管理', body);
  body.querySelectorAll('input[data-plugin]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const set = loadDisabledPlugins();
      if (cb.checked) set.delete(cb.dataset.plugin); else set.add(cb.dataset.plugin);
      saveDisabledPlugins(set);
      setTimeout(() => location.reload(), 350);
    });
  });
}

// ---------- 校验 ----------
function runValidate() {
  const issues = validate(model);
  // 合并插件注册的校验器（如 NPC 日程时间检查）
  for (const v of (pluginHost.validators || [])) {
    try { issues.push(...(v.run(model) || [])); } catch (e) { console.error('校验器出错：', v.id, e); }
  }
  const body = document.createElement('div');
  if (!issues.length) {
    body.innerHTML = `<div class="dialog__ok">🎉 剧情结构完整，没有发现问题！</div>`;
  } else {
    body.innerHTML = `<ul class="issue-list">${issues.map((i) =>
      `<li class="issue issue--${i.level}"><span class="issue__tag">${i.level === 'error' ? '错误' : '提醒'}</span>${escapeHtml(i.msg)}</li>`
    ).join('')}</ul>`;
  }
  openDialog('检查结果', body);
}

// ---------- 帮助 ----------
function openHelp() {
  const body = document.createElement('div');
  body.innerHTML = `
    <ul class="help-list">
      <li><b>加节点</b>：左侧点击或拖拽「对话/选择…」到画布。</li>
      <li><b>连线</b>：按住节点右侧的小圆点，拖到下一个节点上松开。</li>
      <li><b>删连线</b>：点连线中点出现的 ✕。</li>
      <li><b>编辑</b>：选中节点后，在右侧填空即可（无需写代码）。</li>
      <li><b>变量</b>：右下角新建好感度等变量，选择节点里可下拉引用。</li>
      <li><b>移动/缩放</b>：拖空白处平移，滚轮缩放，「全览」回到全貌。</li>
      <li><b>整理布局</b>：点击「🧹 整理布局」，会按剧情流向分层排开节点，并自动加宽长文本节点。</li>
      <li><b>保存与导出</b>：工程建议保存为 .sg（也兼容 .json 打开）；发布时导出引擎 JSON。</li>
    </ul>
    <p class="muted">快捷键：Ctrl+S 保存 · Ctrl+Z 撤销 · Ctrl+Shift+L 整理布局 · Delete 删除选中。</p>`;
  openDialog('怎么用', body);
}

// ---------- 载入示例 ----------
async function loadSample() {
  try {
    const res = await fetch('examples/birthday-party-revised.sg');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (dirty && !confirm('当前剧情未保存，载入示例会覆盖，确定吗？')) return;
    model.fromJSON(data);
    history.reset();
    const result = canvas.autoLayout();
    canvas.fitView();
    dirty = result.count > 0; updateStatus();
    toast(`已载入并整理《生日派对》修订剧情（${result.count} 个节点）`, 'success');
  } catch {
    toast('载入示例失败（请用本地服务器打开，而非直接双击 html）', 'error');
  }
}

// ---------- 新建 ----------
function confirmReset() {
  if (dirty && !confirm('当前剧情未保存，确定新建空白剧情吗？')) return;
  model.reset();
  model.addNode('start', 80, 200);
  dirty = false; updateStatus(); history.reset();
  toast('已新建空白剧情', 'success');
}

function addCenteredNode(type) {
  const r = document.getElementById('canvas').getBoundingClientRect();
  const p = canvas.screenToContent(r.left + r.width / 2, r.top + r.height / 2);
  const node = model.addNode(type, Math.round(p.x) - 90, Math.round(p.y) - 30);
  canvas.select({ type: 'node', id: node.id });
}

function organizeLayout() {
  const result = canvas.autoLayout();
  if (!result.count) { toast('当前没有可整理的节点'); return; }
  canvas.fitView();
  toast(`已按剧情流向整理 ${result.count} 个节点，共 ${result.columns} 列`, 'success');
}

// ---------- 选择分发：单选→检查器；多选→组合/存资产面板 ----------
function handleSelect(sel) {
  if (sel && sel.type === 'multi') { renderMultiInspector(sel.ids); switchTab('inspector'); }
  else { if (sel && sel.type === 'node') switchTab('inspector'); inspector.render(sel); }
}

function renderMultiInspector(ids) {
  const r = document.getElementById('inspector');
  r.innerHTML = `
    <div class="panel__title">已选中 ${ids.length} 个节点</div>
    <div class="panel__hint">可整体拖动；或把它们组合成组、或存成可复用资产（Prefab）。</div>
    <div class="multi-actions">
      <button class="add-btn" id="miGroup">🗚 组合成组</button>
      <button class="add-btn" id="miAsset">📦 存为资产（可复用）</button>
      <button class="add-btn" id="miClear">取消选择</button>
    </div>`;
  r.querySelector('#miGroup').addEventListener('click', groupSelection);
  r.querySelector('#miAsset').addEventListener('click', saveSelectionAsAsset);
  r.querySelector('#miClear').addEventListener('click', () => canvas.select(null));
}

function switchTab(name) {
  document.querySelectorAll('#sidebarTabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  document.getElementById('inspector').hidden = name !== 'inspector';
  document.getElementById('assets').hidden = name !== 'assets';
}
function setupSidebarTabs() {
  document.getElementById('sidebarTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });
}

// ---------- 预览（像玩 galgame 一样试玩）----------
function openPreview() {
  const compiled = toEngineJSON(model);
  if (!compiled.start) { toast('没有起点：请把「开始」节点连到第一句对话', 'error'); return; }
  new PreviewOverlay(compiled, {});
}

// ---------- 组合 / 存为资产 ----------
function groupSelection() {
  const ids = canvas.getSelectedNodeIds();
  if (ids.length < 2) { toast('请先框选（或 Shift 多选）至少 2 个节点', 'error'); return; }
  model.addGroup(ids, '新建组');
  toast('已组合成组：拖动组标题可整体移动', 'success');
}
function saveSelectionAsAsset() {
  const ids = canvas.getSelectedNodeIds();
  if (!ids.length) { toast('请先选中（框选 / Shift 多选）要保存的节点', 'error'); return; }
  promptDialog('给这个可复用资产起个名字', '剧情组件').then((name) => {
    if (name === null) return;
    assetLib.saveFromSelection(ids, name.trim() || undefined);
    switchTab('assets');
  });
}

// 自带输入框的弹窗（代替 window.prompt，后者在部分嵌入式/沙箱环境不可用）
function promptDialog(title, defaultValue = '') {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `<input class="input" id="pmInput" value="${escapeHtml(defaultValue)}" />
      <div class="export-grid" style="margin-top:14px">
        <button class="btn btn--primary" id="pmOk">确定</button>
        <button class="btn" id="pmCancel">取消</button>
      </div>`;
    const dlg = openDialog(title, body);
    const input = body.querySelector('#pmInput');
    setTimeout(() => { input.focus(); input.select(); }, 0);
    const done = (val) => { dlg.close(); resolve(val); };
    body.querySelector('#pmOk').addEventListener('click', () => done(input.value));
    body.querySelector('#pmCancel').addEventListener('click', () => done(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      else if (e.key === 'Escape') done(null);
    });
  });
}

// ---------- 键盘 ----------
window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); history.undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); history.redo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); groupSelection(); return; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); organizeLayout(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
    const ids = canvas.getSelectedNodeIds();
    if (ids.length) { ids.forEach((id) => model.removeNode(id)); canvas.select(null); }
    else if (canvas.selection?.type === 'edge') { model.removeEdge(canvas.selection.id); canvas.select(null); }
  }
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- 启动：尝试加载示例，失败则给空白开始 ----------
(async function boot() {
  try {
    const res = await fetch('examples/birthday-party-revised.sg');
    if (res.ok) { model.fromJSON(await res.json()); canvas.autoLayout(); canvas.fitView(); }
    else throw new Error();
  } catch {
    model.addNode('start', 80, 220);
  }
  dirty = false; history.reset(); updateStatus();
})();

// ====================================================================
// 撤销栈：监听 model 的 'changed'，做去抖快照
function createHistory(model) {
  let stack = [];
  let index = -1;
  let lock = false;
  const debouncedPush = debounce(push, 200);
  model.on('changed', () => { if (!lock) debouncedPush(); });

  function push() {
    const snap = JSON.stringify(model.toJSON());
    if (stack[index] === snap) return;
    stack = stack.slice(0, index + 1);
    stack.push(snap);
    if (stack.length > 80) stack.shift();
    index = stack.length - 1;
  }
  function restore() {
    lock = true;
    model.fromJSON(JSON.parse(stack[index]));
    lock = false;
    updateStatus();
  }
  return {
    reset() { stack = [JSON.stringify(model.toJSON())]; index = 0; },
    undo() { if (index > 0) { index--; restore(); toast('已撤销'); } },
    redo() { if (index < stack.length - 1) { index++; restore(); toast('已重做'); } },
  };
}

// ---------- 通用 UI 小工具 ----------
function openDialog(title, bodyEl) {
  const back = document.createElement('div');
  back.className = 'dialog-backdrop';
  back.innerHTML = `<div class="dialog"><div class="dialog__head"><h3>${escapeHtml(title)}</h3><button class="icon-btn" data-close>✕</button></div><div class="dialog__body"></div></div>`;
  back.querySelector('.dialog__body').append(bodyEl);
  const close = () => back.remove();
  back.querySelector('[data-close]').addEventListener('click', close);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.appendChild(back);
  return { close };
}

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' toast--' + kind : '');
  t.textContent = msg;
  document.getElementById('toast').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 2200);
}

function download(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(name) { return (name || 'story').replace(/[\\/:*?"<>|\s]+/g, '_'); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
