# StoryGraph

StoryGraph is a visual editor for branching narratives. I built it while revising *The Birthday Party* so I could see how a conversation, a collected clue, or a relationship value changes the route through the story.

The editor runs locally in a browser. It has a node canvas, a form-based inspector, a variable panel, and an in-editor story preview. The interface, help, plugin controls, and optional AI prompts are in English. The revised birthday-party example contains English dialogue; the two earlier examples preserve their original Chinese content.

## Run locally

No packages need to be installed. With Node.js 20 or later:

```sh
node serve.mjs 8123
```

Open `http://localhost:8123`. On Windows, `launch.bat` can also start a local server; `启动.bat` remains as a compatible launcher. The app uses ES modules, so opening `index.html` directly from disk will show startup instructions.

## Try the birthday-party example

The app opens `examples/birthday-party-revised.sg`, the revised story source for *The Birthday Party*. It contains 103 nodes, 163 edges, and 16 variables. Choose a node to inspect its text, conditions, or effects. Click **▶ Preview** to play a route, and **🔢 Variables** in the preview to inspect its state. **🔍 Check** reports missing connections and undefined variables.

The first choice gives a short test: accept Adam's friend request to continue the story, or decline it to reach the hidden ending. The graph describes the dialogue route; the preview does not perform the game's operating-system effects.

The earlier 63-node graph and a 23-node slice remain in `examples/` for comparison. They predate the revised story and should not be used as the specification for the current game.

## Editing features

- Seven core node types: start, dialogue, choice, condition, assignment, ending, and note.
- Number, boolean, and string variables. Choices can change values; conditions support AND, OR, NAND, and NOR.
- Dragging, connecting, resizing, multi-selection, automatic layout, undo/redo, and collapsible groups.
- A reusable asset library that stores subgraphs and brings their variable definitions into another graph.
- A story preview that follows choices and shows the current variable values.
- Graph checks for missing starts, empty dialogue, unconnected branches, undefined variables, and unreachable nodes.
- Open and save the same project file in supported Chromium browsers. **Save As** selects a new location; **Ctrl+S** writes subsequent edits there. Other browsers offer a labelled download fallback.

## Files and engine integration

| Output | Purpose |
| --- | --- |
| `.sg` | Editable project: nodes, links, positions, groups, and variables. |
| Runtime JSON | Dictionary-based graph for an interpreter. |
| Unity JSON | Arrays and string-encoded values for Unity's `JsonUtility`. |
| Yarn-style text | An experimental readable export; compatibility with Yarn Spinner has not been certified. |

The [`unity/` package](unity/README.md) imports original `.sg` projects into `StoryGraphAsset` assets. Install it through Unity's Package Manager (**Install package from disk**, select `unity/package.json`), then use **Save As** in the browser to put a graph under your Unity project's `Assets` folder. Later saves update that file. With Unity's Auto Refresh enabled, returning to Unity reimports it while preserving scene references. No separate export is required; older `.sg` files also work.

Import the **Minimal Dialogue** sample from Package Manager for a small graph and a working dialogue/choice UI. The package provides an event-driven player and a component for connecting other UIs. A running session keeps a snapshot of its graph; restart the runner to use newly imported content. This is file-to-asset synchronisation, not live migration of an active playthrough or reverse editing from Unity.

The released *The Birthday Party* continues to use its existing ScriptableObject dialogue assets and C# narrative systems. This generic package does not migrate that game's dialogue or saves.

## Plugins

`PluginHost` exposes node registration, inspector actions, toolbar buttons, and validators. The included NPC schedule plugin adds schedule nodes and a JSON export. An optional DeepSeek plugin can rewrite dialogue, suggest a continuation, propose choices, and check consistency against `src/context/MEMORY.md`.

Core editing, checking, preview, and export work without an API key. To use the AI plugin locally, copy `config.example.json` to `config.local.json` and add your own key. The local configuration is excluded from Git. The plugin sends its prompts and selected story context to the configured provider when its actions are used.

## Checks

```sh
node scripts/check.mjs
node scripts/check-file-session.mjs
node scripts/check-runtime-contract.mjs
```

The checks cover JavaScript syntax, the shipped graphs, JSON exports, editing round-trips, selected routes, file save/cancel/failure handling and shared runtime fixtures. Unity EditMode tests in `unity/Tests` cover the compiler, player, source import and reimport. See the [Unity instructions](unity/README.md) for enabling those tests. Core contract coverage does not establish every possible story route or game-specific save behaviour.

See [the technical design notes](docs/technical-design.md) for the model, export decisions, and current boundaries.

## License

The StoryGraph editor, included plugins, Unity integration code, and tool documentation are available under the [MIT License](LICENSE), copyright 2026 Baohua Fang.

The example dialogue and game narrative content are included to demonstrate the editor; their rights remain with their respective creators. The software license does not grant rights to game artwork, audio, or branding.
