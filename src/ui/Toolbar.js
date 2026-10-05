// 顶部工具栏 + 左侧节点调色板的装配。
import { NODE_TYPES, pluginNodeTypesByCategory } from '../core/nodeTypes.js';

export function setupToolbar(root, actions, { canSaveInPlace = true } = {}) {
  root.innerHTML = `
    <div class="brand">
      <span class="brand__logo">🕸️</span>
      <div class="brand__text">
        <strong>StoryGraph</strong>
        <small>Narrative editor</small>
      </div>
    </div>
    <input class="title-input" id="storyTitle" title="Story title" />
    <div class="toolbar">
      <div class="btn-group">
        <button class="btn" data-act="new" title="Create a blank story">🆕 New</button>
        <button class="btn" data-act="open" title="Open a local .sg or .json story">📂 Open</button>
        <button class="btn" data-act="save" title="${canSaveInPlace ? 'Save changes to the current file (Ctrl+S)' : 'Download an updated .sg copy (Ctrl+S); replace the Unity source file manually'}">${canSaveInPlace ? '💾 Save' : '⬇ Download'}</button>
        ${canSaveInPlace ? '<button class="btn" data-act="saveas" title="Choose a new .sg file (Ctrl+Shift+S). Save inside your Unity project’s Assets folder for automatic import.">Save As…</button>' : ''}
      </div>
      <span class="sep"></span>
      <div class="btn-group">
        <button class="btn" data-act="undo" title="Undo (Ctrl+Z)">↶</button>
        <button class="btn" data-act="redo" title="Redo (Ctrl+Y)">↷</button>
      </div>
      <span class="sep"></span>
      <div class="btn-group">
        <button class="btn" data-act="fit" title="Fit all nodes in view">🔭 Fit view</button>
        <button class="btn" data-act="layout" title="Arrange nodes by story flow, widen narrow nodes, and remove overlaps">🧹 Auto layout</button>
        <button class="btn" data-act="validate" title="Check dead ends and undefined variables">🔍 Check</button>
      </div>
      <span class="sep"></span>
      <div class="btn-group">
        <button class="btn btn--primary" data-act="export" title="Export a story for an engine">⬇ Export</button>
        <button class="btn" data-act="preview" title="Play the current story in the editor">▶ Preview</button>
      </div>
      <span class="sep"></span>
      <div class="btn-group">
        <button class="btn" data-act="group" title="Group selected nodes to move them together">🗚 Group</button>
        <button class="btn" data-act="asset" title="Save selected nodes as a reusable asset">📦 Save asset</button>
      </div>
      <span class="sep"></span>
      <span class="plugin-zone">
        <span class="plugin-zone__label" title="These features are provided by plugins">🧩 Plugins</span>
        <span class="plugin-slot" id="pluginSlot"></span>
        <button class="btn" data-act="plugins" title="View, enable, or disable installed plugins">Manage</button>
      </span>
      <span class="sep"></span>
      <button class="btn btn--ghost" data-act="sample" title="Load The Birthday Party example">📖 Load example</button>
      <button class="btn btn--ghost" data-act="help" title="Help">❔</button>
    </div>`;

  root.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', () => actions[b.dataset.act] && actions[b.dataset.act]());
  });

  const title = root.querySelector('#storyTitle');
  title.addEventListener('change', () => actions.rename && actions.rename(title.value));
  return {
    setTitle: (t) => { title.value = t; },
  };
}

export function setupPalette(root, onAdd) {
  root.innerHTML = `<div class="palette__title">Nodes</div>
    <div class="palette__hint">Drag onto the canvas, or click to add</div>`;
  const addItem = (type) => {
    const def = NODE_TYPES[type];
    if (!def) return;
    const item = document.createElement('div');
    item.className = 'palette__item';
    item.draggable = true;
    item.style.setProperty('--node-color', def.color);
    item.innerHTML = `
      <span class="palette__icon">${def.icon}</span>
      <span class="palette__meta">
        <span class="palette__name">${def.label}</span>
        <span class="palette__desc">${def.desc || ''}</span>
      </span>`;
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/node-type', type);
      e.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('click', () => onAdd(type));
    root.appendChild(item);
  };

  // 内置剧情节点
  ['start', 'dialogue', 'choice', 'condition', 'setvar', 'end', 'note'].forEach(addItem);

  // 插件注册的节点类型，按分类分组显示（如「🗓 NPC 日程」）
  for (const [cat, types] of pluginNodeTypesByCategory()) {
    const h = document.createElement('div');
    h.className = 'palette__group';
    h.textContent = cat;
    root.appendChild(h);
    types.forEach(addItem);
  }
}
