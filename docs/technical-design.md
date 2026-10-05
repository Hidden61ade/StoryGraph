# Technical design notes

## The design problem

The Birthday Party uses conversations and objects in a room to change relationship values and unlock later events. A small script revision can affect an ending several days later. StoryGraph makes those dependencies visible while the story is being edited.

The revised graph includes eight critical-event flags as well as relationship and clue variables. Its true-ending gate checks the event flags alongside the relationship thresholds. This lets an author distinguish a high score from completing the conversations the ending depends on.

## Data ownership

`src/core/GraphModel.js` owns the nodes, edges, groups, and variable definitions. The canvas and form inspector edit the same model. Changes are broadcast through `EventBus`, and `main.js` stores model snapshots for undo/redo.

A graph keeps editor data such as coordinates and groups. Exporters remove that layout information and resolve each output port into the next runtime node ID. Notes remain in the editable project and are omitted from runtime output.

## Preview and checks

`StoryPlayer.js` reads the runtime JSON. It pauses on dialogue or choices and automatically evaluates assignments and conditions until it reaches another visible node. `PreviewOverlay.js` supplies the dialogue interface and the variable display.

The validator reports common authoring mistakes before export. Its checks are structural. An unreachable-node check cannot prove that every condition is satisfiable, and a connected route cannot prove that its dialogue makes sense. The author still needs to review choices and play the relevant routes.

## Unity source import and runtime contract

Unity's `JsonUtility` does not deserialize the dictionary-shaped runtime format directly. `toUnityJSON()` therefore writes arrays of nodes and variables, and stores values as strings alongside their declared types. `StoryGraphData.cs` describes that schema; `StoryGraphPlayer.cs` converts the values and raises events for dialogue, choices, and endings.

The Unity package also compiles the original `.sg` source with an Editor-only Newtonsoft JSON parser. A `ScriptedImporter` resolves its output ports into runtime node IDs and creates a `StoryGraphAsset` with a stable main-object identifier. Keeping the `.sg` path and its Unity `.meta` file preserves asset references across reimports. Compiling source directly avoids storing a second, potentially stale runtime graph inside the editable project.

The browser's file session retains the handle selected through Open or Save As. Save writes the current source to that file; an edit made while the write is pending remains unsaved. Unsupported browsers clearly fall back to downloading a copy. Unity's Auto Refresh sees the changed source when the Editor regains focus. An incomplete graph can still be saved; the importer records a validation error, clears the asset's compiled data and prevents new sessions from starting with stale content.

The C# example is separate from the shipped game's custom narrative code. It does not handle room interaction, collection triggers, save migration, multi-loop environmental changes, or the game's external ending executable. Those responsibilities remain in The Birthday Party's Unity project.

Both players reset initial variables on Begin and limit consecutive automatic condition/assignment steps to 10,000. Numbers are finite decimal values with set/add/sub and numerical comparisons. Booleans accept exact true/false or string 1/0; booleans and strings support assignment and equality comparisons. Strings preserve their content and use case-sensitive equality. Unknown variables, unsupported operations and broken references are rejected. Shared fixtures exercise the same choices and expected state in JavaScript and C#.

A player owns a snapshot of the graph. Reimport updates the asset for future sessions; it does not rewrite a running player's state. The supplied runner creates a fresh player on Begin, while calling Begin on an existing player resets that player's snapshot. A batch of choice effects or assignments commits only after every operation succeeds. Runtime errors stop the session until Begin, so retrying a failed choice cannot repeatedly retain its partial effects. Neither API supplies save/load, rewind or arbitrary-jump semantics. Revisiting an assignment through a graph cycle applies it again, so game-specific persistence still needs an explicit policy.

## Reuse and extensions

Subgraph assets keep their internal edges and referenced variable definitions. Instantiating an asset assigns fresh node IDs, reconstructs its edges, and adds missing variables. This supports repeating a conversation pattern without manually rebuilding its structure.

Plugins register additional node definitions through `PluginHost`. The NPC schedule example uses this for time, activity, and location fields. The AI plugin is optional and uses the project's character notes as prompt context. Neither plugin is required to edit or export a story.

## What this project demonstrates

The tool is part of my work toward technical design: taking an authoring problem from a game, describing its data and rules, and building an interface in which those rules can be edited and checked. The project also made an integration boundary visible. A visual graph needs an explicit runtime contract before it can replace the game's existing story implementation.

## Release validation, 2 October 2026

`node scripts/check.mjs` passes for the 23-node slice, the earlier 63-node graph, and the revised 103-node graph. Each graph has valid references and passes the editor's validator. Both JSON exports and the editable round-trip pass. The preview interpreter reaches a named ending through each graph and reaches the hidden ending through the revised graph's initial refusal.

The release copy contains the editor, examples, plugin source, and Unity integration package. It excludes local credentials and the surrounding recruitment-test documents. The original working directory is unchanged.
