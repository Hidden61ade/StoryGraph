# StoryGraph

StoryGraph is a visual editor for branching narratives. I built it while revising *The Birthday Party* so I could see how a conversation, a collected clue, or a relationship value changes the route through the story.

The editor runs locally in a browser. It has a node canvas, a form-based inspector, a variable panel, and an in-editor story preview. The interface is in Chinese; the revised birthday-party example contains English dialogue.

## Run locally

No packages need to be installed. With Node.js 20 or later:

```sh
node serve.mjs 8123
```

Open `http://localhost:8123`. On Windows, `启动.bat` can also start a local server. The app uses ES modules, so opening `index.html` directly from disk will show startup instructions.

## Try the birthday-party example

The app opens `examples/birthday-party-revised.sg`, the revised story source for *The Birthday Party*. It contains 103 nodes, 163 edges, and 16 variables. Choose a node to inspect its text, conditions, or effects. Click **▶ 预览** to play a route, and **🔢 变量** in the preview to inspect its state. **🔍 检查** reports missing connections and undefined variables.

The first choice gives a short test: accept Adam's friend request to continue the story, or decline it to reach the hidden ending. The graph describes the dialogue route; the preview does not perform the game's operating-system effects.

The earlier 63-node graph and a 23-node slice remain in `examples/` for comparison. They predate the revised story and should not be used as the specification for the current game.

## Editing features

- Seven core node types: start, dialogue, choice, condition, assignment, ending, and note.
- Number, boolean, and string variables. Choices can change values; conditions support AND, OR, NAND, and NOR.
- Dragging, connecting, resizing, multi-selection, automatic layout, undo/redo, and collapsible groups.
- A reusable asset library that stores subgraphs and brings their variable definitions into another graph.
- A story preview that follows choices and shows the current variable values.
- Graph checks for missing starts, empty dialogue, unconnected branches, undefined variables, and unreachable nodes.

## Files and engine integration

| Output | Purpose |
| --- | --- |
| `.sg` | Editable project: nodes, links, positions, groups, and variables. |
| Runtime JSON | Dictionary-based graph for an interpreter. |
| Unity JSON | Arrays and string-encoded values for Unity's `JsonUtility`. |
| Yarn-style text | An experimental readable export; compatibility with Yarn Spinner has not been certified. |

The `unity/` folder contains a data model and an event-driven C# interpreter. Dialogue, choice, and ending events can be connected to a game's UI. This is a separate integration prototype. The released *The Birthday Party* still uses its own ScriptableObject dialogue assets and C# narrative systems; its `.sg` file is not automatically imported or synchronized with that runtime.

## Plugins

`PluginHost` exposes node registration, inspector actions, toolbar buttons, and validators. The included NPC schedule plugin adds schedule nodes and a JSON export. An optional DeepSeek plugin can rewrite dialogue, suggest a continuation, propose choices, and check consistency against `src/context/MEMORY.md`.

Core editing, checking, preview, and export work without an API key. To use the AI plugin locally, copy `config.example.json` to `config.local.json` and add your own key. The local configuration is excluded from Git. The plugin sends its prompts and selected story context to the configured provider when its actions are used.

## Checks

```sh
node scripts/check.mjs
```

The check parses the JavaScript modules, validates all three shipped graphs, exercises both JSON exporters, checks an editing round-trip, and plays a route through each graph. It also checks the revised graph's hidden-ending route. These are headless data and preview checks; they do not claim browser interaction coverage or Unity runtime equivalence.

See [the technical design notes](docs/technical-design.md) for the model, export decisions, and current boundaries.
