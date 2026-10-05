// 应用入口：把模型、画布、检查器、变量面板、工具栏装配起来，
// 并处理撤销/重做、文件读写、导出、快捷键、提示气泡等“外壳”逻辑。
import { GraphModel } from './core/GraphModel.js';
import { ProjectFile, assertEditableProject } from './core/ProjectFile.js';
import { NODE_TYPES } from './core/nodeTypes.js';
import { validateRuntime } from './core/runtimeContract.js';
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
let dirty = false;
let revision = 0;
let lastSaveKind = null;
const projectFile = new ProjectFile({ download, getRevision: () => revision });
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
  toast('Asset placed', 'success');
};
// 组「存为组件」→ 存入资产库（可跨工程复用）
canvas.onGroupSaveAsset = (memberIds, label) => {
  assetLib.saveFromSelection(memberIds, label || 'Asset');
  switchTab('assets');
};
setupSidebarTabs();

const toolbar = setupToolbar(document.getElementById('topbar'), {
  new: () => confirmReset(),
  open: () => openFile(),
  save: () => saveFile(),
  saveas: () => saveFile(true),
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
}, { canSaveInPlace: projectFile.supportsSave });
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
    <span class="status__item">📦 Nodes ${model.nodes.size}</span>
    <span class="status__item">🔗 Edges ${model.edges.size}</span>
    <span class="status__item">🔢 Variables ${model.variables.length}</span>
    <span class="status__item status__item--right">🔎 ${Math.round(canvas.zoom * 100)}%</span>
    <span class="status__item">${dirty ? '● Unsaved' : lastSaveKind === 'downloaded' ? '✓ Downloaded copy' : projectFile.hasHandle ? '✓ Saved' : 'No local file'}</span>
    ${projectFile.fileName ? `<span class="status__item">📄 ${escapeHtml(projectFile.fileName)}</span>` : ''}`;
}
model.on('changed', () => { revision++; dirty = true; updateStatus(); });
model.on('viewChanged', updateStatus);
model.on('loaded', () => { toolbar.setTitle(model.meta.name); updateStatus(); });

// ---------- 撤销 / 重做（快照式，简单可靠）----------
const history = createHistory(model);

// ---------- 文件读写 ----------
let openingFile = false;
let fallbackOpenRevision = null;
let fallbackOpenGeneration = null;
async function openFile() {
  if (openingFile) return;
  if (dirty && !confirm('This story has unsaved changes. Open another file and discard them?')) return;
  const approvedRevision = revision;
  const approvedGeneration = projectFile.generation;
  if (!projectFile.supportsOpen) {
    fallbackOpenRevision = approvedRevision;
    fallbackOpenGeneration = approvedGeneration;
    document.getElementById('fileInput').click();
    return;
  }
  openingFile = true;
  try {
    const candidate = await projectFile.open();
    if (candidate) applyOpenedProject(candidate, approvedRevision, approvedGeneration);
  } catch (error) {
    toast('Could not open this project: ' + error.message, 'error');
  } finally {
    openingFile = false;
  }
}

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const approvedRevision = fallbackOpenRevision;
  const approvedGeneration = fallbackOpenGeneration;
  fallbackOpenRevision = null;
  fallbackOpenGeneration = null;
  e.target.value = '';
  if (!file) return;
  openingFile = true;
  try {
    applyOpenedProject(await projectFile.read(file), approvedRevision, approvedGeneration);
  } catch (error) {
    toast('Could not open this project: ' + error.message, 'error');
  } finally {
    openingFile = false;
  }
});

function applyOpenedProject(candidate, approvedRevision, approvedGeneration) {
  if (projectFile.generation !== approvedGeneration) {
    toast('Open cancelled because another project was loaded.');
    return;
  }
  assertEditableProject(candidate.data, { isNodeTypeAvailable: (type) => Object.hasOwn(NODE_TYPES, type) });
  if (revision !== approvedRevision && dirty &&
      !confirm('This story has new unsaved changes. Discard them and open the selected file?')) return;
  model.fromJSON(candidate.data);
  projectFile.adopt(candidate);
  lastSaveKind = null;
  history.reset();
  const result = canvas.autoLayout();
  canvas.fitView();
  dirty = result.count > 0;
  updateStatus();
  toast(`Opened ${candidate.name} and arranged ${result.count} nodes`, 'success');
}

async function saveFile(saveAs = false) {
  try {
    const data = JSON.stringify(model.toJSON(), null, 2);
    const result = await projectFile.save(data, {
      suggestedName: projectFile.fileName || safeName(model.meta.name) + '.sg', saveAs,
    });
    if (result.kind === 'busy') { toast('A project save is already in progress.'); return; }
    if (result.kind === 'cancelled') return;
    if (result.unchanged) dirty = false;
    if (result.kind === 'written') {
      if (result.unchanged) lastSaveKind = 'written';
      toast(`Saved ${result.name}${result.unchanged ? '' : '; newer edits remain unsaved.'}`, 'success');
    } else {
      if (result.unchanged) lastSaveKind = 'downloaded';
      toast('Downloaded an .sg copy. Replace the file in Unity Assets to update the imported story.', 'success');
    }
    updateStatus();
  } catch (error) {
    toast('Could not save the project: ' + error.message, 'error');
    updateStatus();
  }
}

// ---------- 导出引擎文件 ----------
function openExportDialog() {
  try {
    const errors = validateRuntime(model).filter((issue) => issue.level === 'error');
    if (errors.length) {
      toast(`Cannot export: ${errors[0].msg} Use Check for all issues.`, 'error');
      return;
    }
    buildExportDialog();
  } catch (error) {
    toast('Could not export this story: ' + error.message, 'error');
  }
}

function buildExportDialog() {
  const issues = validate(model);
  const errors = issues.filter((i) => i.level === 'error');
  const engine = JSON.stringify(toEngineJSON(model), null, 2);
  const body = document.createElement('div');
  body.innerHTML = `
    <p>Choose a format for your engine or interpreter:</p>
    <div class="export-grid">
      <button class="btn btn--primary" id="expEngine">⬇ Runtime JSON</button>
      <button class="btn" id="expUnity">⬇ Unity JSON (.json)</button>
      <button class="btn" id="expYarn">⬇ Yarn-style text (.yarn)</button>
    </div>
    ${errors.length ? `<div class="dialog__warn">⚠ ${errors.length} errors found. Use Check to fix them before running the export.</div>` : '<div class="dialog__ok">✓ No structural errors found.</div>'}
    <details class="export-preview"><summary>Preview runtime JSON</summary><pre>${escapeHtml(engine.slice(0, 4000))}${engine.length > 4000 ? '\n…(Preview truncated)' : ''}</pre></details>`;
  const dlg = openDialog('Export', body);
  const exportData = (makeText, suffix, mime, message) => {
    try {
      download(makeText(), safeName(model.meta.name) + suffix, mime);
      toast(message, 'success');
      dlg.close();
    } catch (error) {
      toast('Could not export this story: ' + error.message, 'error');
    }
  };
  body.querySelector('#expEngine').addEventListener('click', () => {
    exportData(() => engine, '.engine.json', 'application/json', 'Runtime JSON exported');
  });
  body.querySelector('#expUnity').addEventListener('click', () => {
    exportData(() => JSON.stringify(toUnityJSON(model), null, 2), '.unity.json', 'application/json', 'Unity JSON exported');
  });
  body.querySelector('#expYarn').addEventListener('click', () => {
    exportData(() => toYarn(model), '.yarn', 'text/plain', 'Yarn-style text exported');
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
      catch (err) { console.error('Plugin failed to load:', entry, err); }
    }
    await pluginHost.loadAll(mods);
    refreshPalette(); // 插件可能注册了新节点类型
    inspector.render(inspector.selection); // 让已选中节点立即显示插件动作
  } catch (err) {
    console.error('Plugin initialization failed:', err);
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
        <label class="switch"><input type="checkbox" data-plugin="${escapeHtml(p.id)}" ${on ? 'checked' : ''}/><span>${on ? 'Enabled' : 'Disabled'}</span></label>
      </div>
      <div class="plugin-card__desc">${escapeHtml(p.desc || '')}</div>
      <div class="plugin-card__path">Entry: plugins/${escapeHtml(p.path)}</div>
    </div>`;
  }).join('');
  body.innerHTML = `
    <p class="muted">These optional plugins extend the editor. Register new plugins in <code>plugins/plugins.json</code>.</p>
    <div class="plugin-cards">${list || '<div class="muted">No plugins found.</div>'}</div>
    <div class="dialog__ok" style="margin-top:12px">Changing a plugin reloads the page to apply the setting.</div>`;
  openDialog('🧩 Plugin manager', body);
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
  const issues = [...validateRuntime(model), ...validate(model)];
  // 合并插件注册的校验器（如 NPC 日程时间检查）
  for (const v of (pluginHost.validators || [])) {
    try { issues.push(...(v.run(model) || [])); } catch (e) { console.error('Validator failed:', v.id, e); }
  }
  const seen = new Set();
  const uniqueIssues = issues.filter((issue) => {
    if (seen.has(issue.msg)) return false;
    seen.add(issue.msg);
    return true;
  });
  const body = document.createElement('div');
  if (!uniqueIssues.length) {
    body.innerHTML = `<div class="dialog__ok">🎉 No story issues found.</div>`;
  } else {
    body.innerHTML = `<ul class="issue-list">${uniqueIssues.map((i) =>
      `<li class="issue issue--${i.level}"><span class="issue__tag">${i.level === 'error' ? 'Error' : 'Warning'}</span>${escapeHtml(i.msg)}</li>`
    ).join('')}</ul>`;
  }
  openDialog('Check results', body);
}

// ---------- 帮助 ----------
function openHelp() {
  const body = document.createElement('div');
  body.innerHTML = `
    <ul class="help-list">
      <li><b>Add nodes:</b> click a palette item or drag it onto the canvas.</li>
      <li><b>Connect:</b> drag an output port to the next node.</li>
      <li><b>Delete connections:</b> click the ✕ at the center of a connection.</li>
      <li><b>Edit:</b> select a node and fill in the inspector on the right.</li>
      <li><b>Variables:</b> add shared values in the lower-right panel, then select them in choices and conditions.</li>
      <li><b>Pan and zoom:</b> drag the empty canvas, scroll to zoom, or choose Fit view.</li>
      <li><b>Auto layout:</b> arrange nodes by story flow and widen nodes with long text.</li>
      <li><b>Save:</b> Save As chooses a local .sg file; Save updates that same file. Put it in your Unity project’s Assets folder for automatic import.</li>
      <li><b>Download:</b> when local file writing is unavailable, Download creates a copy. Replace the Unity source file manually.</li>
      <li><b>Export:</b> export Runtime JSON or Unity JSON when you need a separate runtime file.</li>
    </ul>
    <p class="muted">Shortcuts: Ctrl+S save · Ctrl+Shift+S save as · Ctrl+Z undo · Ctrl+Shift+L auto layout · Delete remove selection.</p>`;
  openDialog('How to use StoryGraph', body);
}

// ---------- 载入示例 ----------
async function loadSample() {
  try {
    const res = await fetch('examples/birthday-party-revised.sg');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (dirty && !confirm('This story has unsaved changes. Replace it with the example?')) return;
    projectFile.detach();
    lastSaveKind = null;
    model.fromJSON(data);
    history.reset();
    const result = canvas.autoLayout();
    canvas.fitView();
    dirty = result.count > 0; updateStatus();
    toast(`Loaded The Birthday Party revised story and arranged ${result.count} nodes`, 'success');
  } catch {
    toast('Could not load the example. Open the app through a local server.', 'error');
  }
}

// ---------- 新建 ----------
function confirmReset() {
  if (dirty && !confirm('This story has unsaved changes. Create a blank story?')) return;
  projectFile.detach();
  lastSaveKind = null;
  model.reset();
  model.addNode('start', 80, 200);
  dirty = false; updateStatus(); history.reset();
  toast('Created a blank story', 'success');
}

function addCenteredNode(type) {
  const r = document.getElementById('canvas').getBoundingClientRect();
  const p = canvas.screenToContent(r.left + r.width / 2, r.top + r.height / 2);
  const node = model.addNode(type, Math.round(p.x) - 90, Math.round(p.y) - 30);
  canvas.select({ type: 'node', id: node.id });
}

function organizeLayout() {
  const result = canvas.autoLayout();
  if (!result.count) { toast('There are no nodes to arrange.'); return; }
  canvas.fitView();
  toast(`Arranged ${result.count} nodes by story flow in ${result.columns} columns`, 'success');
}

// ---------- 选择分发：单选→检查器；多选→组合/存资产面板 ----------
function handleSelect(sel) {
  if (sel && sel.type === 'multi') { renderMultiInspector(sel.ids); switchTab('inspector'); }
  else { if (sel && sel.type === 'node') switchTab('inspector'); inspector.render(sel); }
}

function renderMultiInspector(ids) {
  const r = document.getElementById('inspector');
  r.innerHTML = `
    <div class="panel__title">${ids.length} nodes selected</div>
    <div class="panel__hint">Move these nodes together, group them, or save them as a reusable asset.</div>
    <div class="multi-actions">
      <button class="add-btn" id="miGroup">🗚 Group nodes</button>
      <button class="add-btn" id="miAsset">📦 Save reusable asset</button>
      <button class="add-btn" id="miClear">Clear selection</button>
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
  try {
    const errors = validateRuntime(model).filter((issue) => issue.level === 'error');
    if (errors.length) {
      toast(`Cannot preview: ${errors[0].msg} Use Check for all issues.`, 'error');
      return;
    }
    const compiled = toEngineJSON(model);
    new PreviewOverlay(compiled, {});
  } catch (error) {
    toast('Could not preview this story: ' + error.message, 'error');
  }
}

// ---------- 组合 / 存为资产 ----------
function groupSelection() {
  const ids = canvas.getSelectedNodeIds();
  if (ids.length < 2) { toast('Select at least two nodes with a selection box or Shift-click.', 'error'); return; }
  model.addGroup(ids, 'New group');
  toast('Nodes grouped. Drag the group title to move them together.', 'success');
}
function saveSelectionAsAsset() {
  const ids = canvas.getSelectedNodeIds();
  if (!ids.length) { toast('Select the nodes to save with a selection box or Shift-click.', 'error'); return; }
  promptDialog('Name this reusable asset', 'Story asset').then((name) => {
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
        <button class="btn btn--primary" id="pmOk">Confirm</button>
        <button class="btn" id="pmCancel">Cancel</button>
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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(e.shiftKey); return; }
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
  const initialRevision = revision;
  try {
    const res = await fetch('examples/birthday-party-revised.sg');
    if (revision !== initialRevision) return;
    if (res.ok) {
      const data = await res.json();
      if (revision !== initialRevision) return;
      model.fromJSON(data); canvas.autoLayout(); canvas.fitView();
    }
    else throw new Error();
  } catch {
    if (revision !== initialRevision) return;
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
    undo() { if (index > 0) { index--; restore(); toast('Undone'); } },
    redo() { if (index < stack.length - 1) { index++; restore(); toast('Redone'); } },
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
