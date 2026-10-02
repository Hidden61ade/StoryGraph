# StoryGraph 插件开发规范

StoryGraph 的「非核心」能力都是插件。核心通过 `PluginHost` 暴露一组**稳定的扩展点**，
插件只碰这个 `api`，不直接触碰核心内部——这样核心可以独立演进，插件也能独立增删。

> 本目录已内置两个示范：`npc-schedule/`（注册新节点类型，做 NPC 日程）与 `ai-deepseek/`（AI 增强）。

---

## 一、一个插件长什么样

插件是 `plugins/` 下的一个 ES Module，默认导出一个含 `setup(api)` 的对象：

```js
// plugins/my-plugin/index.js
export default {
  id: 'my-plugin',         // 唯一 id
  name: '我的插件',         // 显示在「🧩 插件」管理面板
  setup(api) {
    // 在这里用 api 注册扩展点（见下）
  },
};
```

然后在 `plugins/plugins.json` 登记即生效：

```jsonc
{
  "plugins": [
    { "id": "my-plugin", "name": "我的插件", "path": "my-plugin/index.js", "enabled": true,
      "desc": "一句话说明，显示在插件管理面板里。" }
  ]
}
```

启动时 `main.js` 读清单 → 动态 `import()` → `host.loadAll()`。用户在「🧩 插件」面板停用的插件记在
`localStorage`，下次不加载。**核心没有任何插件也能完整运行。**

---

## 二、api 扩展点速查

| 扩展点 | 用途 |
| --- | --- |
| `api.nodeTypes.register(type, def)` | **注册全新节点类型**（让节点图不只能编剧情）。 |
| `api.actions.addNodeAction({ id, label, title?, when(node)?, run(node) })` | 在检查器里给某类节点加按钮（如 AI 润色）。 |
| `api.toolbar.addButton({ id, label, title?, run() })` | 在顶栏「🧩 插件」区加一个按钮。 |
| `api.validators.register({ id, label, run(model) -> issues[] })` | 加自定义校验，结果并入「🔍 检查」。 |
| `api.model` | 唯一数据源：增删节点/连线/变量、`targetOf(id, port)` 等。 |
| `api.canvas` | `viewportCenterContent()`、`selectNodes(ids)` 等。 |
| `api.ui` | `toast` / `openDialog` / `confirm` / `download` / `prompt`。 |
| `api.context.memory()` | 读取 `src/context/MEMORY.md`（角色圣经）。 |
| `api.config` | 读取 `config.local.json`（如 AI 的 apiKey）。 |
| `api.refresh()` | 改完节点数据后让检查器重渲染。 |

---

## 三、注册自定义节点类型（重点）

`def` 用**声明式**描述，检查器据此自动生成表单、画布据此渲染摘要、导出器据此编译——插件无需写任何 DOM：

```js
api.nodeTypes.register('time_block', {
  label: '时段',                 // 显示名
  icon: '⏰',                    // 图标
  color: '#0d9488',              // 主题色
  categoryLabel: '🗓 NPC 日程',  // 调色板分组标题
  hasInput: true,                // 是否有输入口
  // terminal: true,             // 无输出口（如「结局」类）
  // ports: (node) => [{ id:'out', label:'' }],  // 自定义多输出口（默认单 out）

  defaultData: () => ({ time: '08:00', activity: '', location: '' }),

  // 声明式表单：type 支持 text / textarea / number / time / select / var
  fields: [
    { key: 'time', label: '时间', type: 'time' },
    { key: 'activity', label: '活动', type: 'text', placeholder: '如：烤面包' },
    { key: 'location', label: '地点', type: 'text' },
  ],

  // 画布上的摘要（第二参是 HTML 转义函数）
  summary: (node, esc) => `<b>${esc(node.data.time)}</b> ${esc(node.data.activity)}`,

  // 导出为引擎运行时节点；h.next(port) 取该端口连到的目标 id
  toEngine: (node, h) => ({
    type: 'time_block', time: node.data.time, activity: node.data.activity,
    location: node.data.location, next: h.next('out'),
  }),
});
```

注册后，这个类型会自动出现在左侧调色板（按 `categoryLabel` 分组），可拖拽、可连线、可校验、可导出，
与内置节点完全平权。

---

## 四、设计约定

- **优雅降级**：插件出错不应让工具崩溃。涉及网络/Key 的（如 AI）要 try/catch 并用 `api.ui` 给友好提示。
- **只通过 api**：不要 import 核心内部文件去改私有状态；只用 `api.model` 等公开入口。
- **可停用**：任何插件都应能被关掉而不影响核心编辑/导出。
- **命名空间**：节点类型、按钮 id 建议带插件前缀，避免与其他插件冲突。
