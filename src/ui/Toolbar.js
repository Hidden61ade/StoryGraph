// 顶部工具栏 + 左侧节点调色板的装配。
import { NODE_TYPES, pluginNodeTypesByCategory } from '../core/nodeTypes.js';

export function setupToolbar(root, actions) {
  root.innerHTML = `
    <div class="brand">
      <span class="brand__logo">🕸️</span>
      <div class="brand__text">
        <strong>StoryGraph</strong>
        <small>剧情节点编辑器</small>
      </div>
    </div>
    <input class="title-input" id="storyTitle" title="剧情名称" />
    <div class="toolbar">
      <div class="btn-group">
        <button class="btn" data-act="new" title="新建空白剧情">🆕 新建</button>
        <button class="btn" data-act="open" title="打开本地 .sg 或 .json 剧情文件">📂 打开</button>
        <button class="btn" data-act="save" title="保存为 .sg（也兼容 .json 读取）">💾 保存</button>
      </div>
      <span class="sep"></span>
      <div class="btn-group">
        <button class="btn" data-act="undo" title="撤销 (Ctrl+Z)">↶</button>
        <button class="btn" data-act="redo" title="重做 (Ctrl+Y)">↷</button>
      </div>
      <span class="sep"></span>
      <div class="btn-group">
        <button class="btn" data-act="fit" title="自适应显示全部节点">🔭 全览</button>
        <button class="btn" data-act="layout" title="按剧情流向分层排列节点，统一修正过窄节点并消除重叠">🧹 整理布局</button>
        <button class="btn" data-act="validate" title="检查剧情里的断头路、未定义变量等">🔍 检查</button>
      </div>
      <span class="sep"></span>
      <div class="btn-group">
        <button class="btn btn--primary" data-act="export" title="导出引擎可用的剧情文件">⬇ 导出引擎文件</button>
        <button class="btn" data-act="preview" title="像玩 galgame 一样试玩当前剧情">▶ 预览</button>
      </div>
      <span class="sep"></span>
      <div class="btn-group">
        <button class="btn" data-act="group" title="把多选的节点整合成一个组（可整体移动）">🗚 组合</button>
        <button class="btn" data-act="asset" title="把多选的节点存成可复用资产（Prefab）">📦 存为资产</button>
      </div>
      <span class="sep"></span>
      <span class="plugin-zone">
        <span class="plugin-zone__label" title="以下能力由插件提供">🧩 插件</span>
        <span class="plugin-slot" id="pluginSlot"></span>
        <button class="btn" data-act="plugins" title="查看 / 启用 / 停用已安装的插件">管理</button>
      </span>
      <span class="sep"></span>
      <button class="btn btn--ghost" data-act="sample" title="载入《生日派对》示例剧情">📖 载入示例</button>
      <button class="btn btn--ghost" data-act="help" title="使用帮助">❔</button>
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
  root.innerHTML = `<div class="palette__title">节点</div>
    <div class="palette__hint">拖到画布，或点击添加</div>`;
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
