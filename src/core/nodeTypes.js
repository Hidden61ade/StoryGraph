// 节点类型的定义表。新增节点类型只需在这里登记，画布/检查器会自动适配。
// 这是“数据驱动 UI”的核心：非技术同学看到的中文标签、颜色、说明都来自这里。

export const NODE_TYPES = {
  start: {
    label: '开始',
    icon: '▶',
    color: '#16a34a',
    hasInput: false,
    desc: '剧情的入口。每段剧情有且仅有一个开始节点。',
  },
  dialogue: {
    label: '对话',
    icon: '💬',
    color: '#2563eb',
    hasInput: true,
    desc: '某个角色说一句话。',
  },
  choice: {
    label: '选择',
    icon: '🔀',
    color: '#d97706',
    hasInput: true,
    desc: '让玩家在多个选项中选择，每个选项可改变好感度等变量。',
  },
  condition: {
    label: '条件',
    icon: '❓',
    color: '#7c3aed',
    hasInput: true,
    desc: '根据变量判断，走向「是」或「否」两条路。',
  },
  setvar: {
    label: '赋值',
    icon: '🔧',
    color: '#0d9488',
    hasInput: true,
    desc: '修改变量（如好感度 +1、标记某线索已读）。',
  },
  end: {
    label: '结局',
    icon: '⏹',
    color: '#dc2626',
    hasInput: true,
    desc: '剧情的一个结束点。可标注结局名称。',
  },
  note: {
    label: '便签',
    icon: '📝',
    color: '#ca8a04',
    hasInput: false,
    desc: '写给自己的注释，不会被导出到引擎。',
  },
};

let _optSeq = 1;
export function newOption(text = '新选项') {
  return { id: 'opt_' + (_optSeq++), text, effects: [] };
}

// ---------- 节点类型注册（可扩展性的核心）----------
// 插件可通过 registerNodeType 动态注册新节点类型，无需改动画布/检查器/导出器。
// 一个自定义类型 def 可包含：
//   label, icon, color, hasInput, categoryLabel（调色板分组）,
//   terminal（无输出）, ports(node)（自定义输出端口）,
//   defaultData()（默认数据）, fields[]（声明式表单）,
//   summary(node)（画布上的摘要 HTML）, toEngine(node, helpers)（导出为运行时节点）。
export function registerNodeType(type, def) {
  if (NODE_TYPES[type]) { console.warn('[nodeTypes] 类型已存在，忽略重复注册：', type); return; }
  NODE_TYPES[type] = { hasInput: true, category: 'plugin', desc: '', ...def };
}

/** 取所有「自定义（插件）」节点类型，按 categoryLabel 分组，供调色板渲染。 */
export function pluginNodeTypesByCategory() {
  const builtin = new Set(['start', 'dialogue', 'choice', 'condition', 'setvar', 'end', 'note']);
  const groups = new Map();
  for (const [type, def] of Object.entries(NODE_TYPES)) {
    if (builtin.has(type)) continue;
    const cat = def.categoryLabel || '🧩 插件节点';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(type);
  }
  return groups;
}

/** 某个类型节点的默认数据 */
export function defaultData(type) {
  switch (type) {
    case 'start':
      return { label: '开始' };
    case 'dialogue':
      return { speaker: '', text: '' };
    case 'choice':
      return { prompt: '', options: [newOption('选项一'), newOption('选项二')] };
    case 'condition':
      return { match: 'all', clauses: [{ var: '', op: '>=', value: '0' }] };
    case 'setvar':
      return { assignments: [{ var: '', op: 'add', value: '1' }] };
    case 'end':
      return { label: '结局', ending: '' };
    case 'note':
      return { text: '在这里写注释…' };
    default: {
      const def = NODE_TYPES[type];
      if (def && def.defaultData) {
        return typeof def.defaultData === 'function' ? def.defaultData() : JSON.parse(JSON.stringify(def.defaultData));
      }
      return {};
    }
  }
}

/** 一个节点对外暴露的输出端口（用于连线）。 */
export function outputPorts(node) {
  switch (node.type) {
    case 'start':
    case 'dialogue':
    case 'setvar':
      return [{ id: 'out', label: '' }];
    case 'choice':
      return (node.data.options || []).map((o) => ({ id: o.id, label: o.text }));
    case 'condition':
      return [
        { id: 'true', label: '是', kind: 'true' },
        { id: 'false', label: '否', kind: 'false' },
      ];
    case 'end':
    case 'note':
      return []; // end / note 没有输出
    default: {
      const def = NODE_TYPES[node.type];
      if (def && typeof def.ports === 'function') return def.ports(node);
      if (def && def.terminal) return [];
      if (def) return [{ id: 'out', label: '' }]; // 插件节点默认单输出
      return [];
    }
  }
}

/** 把内部运算符转成给人看的符号 */
export const OP_SYMBOL = {
  set: '=', add: '＋', sub: '－',
  '==': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤',
};
