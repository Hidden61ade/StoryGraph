# StoryGraph plugin guide

Optional capabilities extend the editor through `PluginHost`. Plugins use the public `api` instead of changing core internals. The included examples are `npc-schedule/` and `ai-deepseek/`.

## Register a plugin

Create an ES module under `plugins/` with a default export containing `setup(api)`:

```js
export default {
  id: 'my-plugin',
  name: 'My plugin',
  setup(api) {
    // Register node types, actions, toolbar buttons, or validators here.
  },
};
```

Add an entry to `plugins/plugins.json`:

```json
{
  "plugins": [
    {
      "id": "my-plugin",
      "name": "My plugin",
      "path": "my-plugin/index.js",
      "enabled": true,
      "desc": "A short description shown in the plugin manager."
    }
  ]
}
```

`main.js` reads this manifest, imports enabled modules, and calls `host.loadAll()`. The plugin manager stores disabled IDs in browser `localStorage`; changing a setting reloads the page. Core story editing, preview, checking, and export work without either included plugin. A graph using custom node types still needs those type definitions to edit or export them correctly.

## API reference

| Extension point | Purpose |
| --- | --- |
| `api.nodeTypes.register(type, def)` | Register a node type. |
| `api.actions.addNodeAction({ id, label, title?, when(node)?, run(node) })` | Add an inspector action for matching nodes. |
| `api.toolbar.addButton({ id, label, title?, run() })` | Add a toolbar action. |
| `api.validators.register({ id, label, run(model) })` | Return issues for the Check dialog. |
| `api.model` | Read and change nodes, edges, groups, and variables. |
| `api.canvas` | Select nodes or obtain the viewport center. |
| `api.ui` | Show toasts and dialogs, ask for input, or download output. |
| `api.context.memory()` | Read `src/context/MEMORY.md`. |
| `api.config` | Access the current local configuration. |
| `api.refresh()` | Rebuild the inspector after changing node data. |

Validators return an array of `{ level: 'error' | 'warn', msg, nodeId? }` objects.

## Define a node type

The canvas, palette, inspector, and exporters use declarative definitions. A plugin can supply fields and a summary without creating a separate editor UI:

```js
api.nodeTypes.register('my-plugin.time_block', {
  label: 'Time block',
  icon: '⏰',
  color: '#0d9488',
  categoryLabel: 'NPC schedules',
  hasInput: true,
  defaultData: () => ({ time: '08:00', activity: '', location: '' }),
  fields: [
    { key: 'time', label: 'Time', type: 'time' },
    { key: 'activity', label: 'Activity', type: 'text', placeholder: 'e.g. Bake bread' },
    { key: 'location', label: 'Location', type: 'text' },
  ],
  summary: (node, esc) => `<b>${esc(node.data.time)}</b> ${esc(node.data.activity)}`,
  toEngine: (node, h) => ({
    type: 'my-plugin.time_block',
    ...node.data,
    next: h.next('out'),
  }),
});
```

Supported field types are `text`, `textarea`, `number`, `time`, `select`, and `var`. A node has a single `out` port by default. Set `terminal: true` for no outputs, or define `ports(node)` to return custom `{ id, label }` ports. The exporter helpers provide `h.next(port)` and `h.coerce(variableName, rawValue)`.

Custom runtime types require an interpreter that knows their behavior. Registering a node and exporter does not add that behavior to the browser story preview or the Unity interpreter automatically.

## Included plugins and boundaries

- **NPC schedules:** adds `npc_day` and `time_block` nodes, a sample, time-format checks, and schedule export. The schedule exporter follows one branch through conditions and skips assignment nodes; it is a configuration example rather than a complete conditional schedule runtime.
- **DeepSeek assistant:** uses English prompts and the project notes to suggest dialogue and choices or review consistency. It requires your own key in `config.local.json`. Requests send selected text and the project notes to the configured provider. Suggestions need an author’s review; the core editor remains usable when requests fail.

Catch network errors and show useful messages through `api.ui`. Use the API rather than importing private core internals. Prefix custom type and action IDs to avoid collisions with other plugins.
