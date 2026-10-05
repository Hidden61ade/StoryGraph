# StoryGraph for Unity

This local UPM package imports the original **`.sg` project** directly. Saving a graph into a Unity project's `Assets` folder triggers Unity's normal asset refresh and recompiles it into a `StoryGraphAsset`. You do not need to export Unity JSON or resave an older graph to add embedded runtime data.

## Install and run

1. In Unity's Package Manager, select **Add package from disk** and choose this folder's `package.json`.
2. Save a StoryGraph `.sg` file anywhere under your Unity project's `Assets` folder. Unity creates its `StoryGraphAsset` automatically.
3. Add `StoryGraphRunner` to a GameObject and assign that asset to **Story**. Connect its events to your dialogue UI; call `Next()` after a line and `Choose(index)` for a response.

```csharp
using StoryGraph;
using UnityEngine;

public sealed class DialogueUI : MonoBehaviour
{
    public StoryGraphRunner runner;

    private void Awake()
    {
        runner.OnDialogue += (speaker, text) => Debug.Log(speaker + ": " + text);
        runner.OnChoice += (prompt, choices) => Debug.Log(prompt);
        runner.OnEnd += ending => Debug.Log("Ending: " + ending);
    }

    public void Continue() => runner.Next();
    public void Respond(int index) => runner.Choose(index);
}
```

The package's **Minimal Dialogue** sample supplies a working English OnGUI interface and a ready-to-play scene. Import it in Package Manager, open `StoryGraphSample.unity` and enter Play Mode. The dialogue begins automatically.

## Synchronisation and sessions

With Unity's Auto Refresh enabled, saved source changes are detected when the Editor regains focus. If Auto Refresh is disabled, use **Assets → Refresh**. The importer recompiles the source using a stable main-asset identifier, so existing asset references survive reimports. Layout, groups and notes remain authoring information; the original `.sg` remains the editable source. Unsupported plugin nodes produce an explicit import error rather than silently disappearing.

An invalid graph imports as an invalid `StoryGraphAsset` with `Errors` and cannot create a player. It does not retain old runnable data as a fallback. Fix the source and save it to import again.

Running sessions snapshot their graph. Reimporting does not replace dialogue or variables in the middle of a choice. `StoryGraphRunner.Begin()` creates a new session from the latest asset. For a manually held `StoryGraphPlayer`, construct a new player with `asset.CreatePlayer()` to pick up source changes; its own `Begin()` resets its snapshot's variables and starts that snapshot again.

## Core contract

| Editor type | Runtime behavior |
| --- | --- |
| `start` | Exactly one entry; omitted from runtime data. |
| `dialogue` | Raise `OnDialogue` and wait for `Next()`. |
| `choice` | Raise `OnChoice`; `Choose(index)` applies effects and follows that option. |
| `condition` | Evaluate clauses with `all`, `any`, `nand` or `nor`. Empty clauses return true for all four modes for compatibility. |
| `setvar` | Compile to `set`, apply assignments, then advance automatically. |
| `end` | Raise `OnEnd` and stop. |
| `note` | Authoring only; omitted from runtime data. |

Import rejects duplicate node/edge IDs, duplicate variable names or choice IDs, extra starts, missing targets, unknown or multiply connected source ports, unconnected required outputs, empty choices, unknown variables, invalid operators and unsupported node types. A graph may contain a deliberate cycle; execution throws a clear exception after 10,000 consecutive automatic steps rather than freezing the Editor.

| Variable type | Accepted values | Assignments | Comparisons |
| --- | --- | --- | --- |
| `number` | JSON number or finite decimal string, including decimal exponent syntax; no whitespace, empty value, hex, NaN or Infinity | `set`, `add`, `sub` | `==`, `!=`, `>`, `>=`, `<`, `<=` |
| `boolean` | JSON boolean or exact strings `true`, `false`, `1`, `0`; no trimming or case conversion | `set` | `==`, `!=` |
| `string` | JSON string preserved exactly, including whitespace; no implicit conversion from null or another type | `set` | `==`, `!=` |

An effect batch commits only after every operation succeeds. Arithmetic producing a nonfinite result throws and faults the session; Next and Choose are blocked until Begin resets it. Values in the compatible Unity JSON DTO remain strings and are reconstructed using the declared variable type.

## Public API and compatibility

- `StoryGraph.Editor.StoryGraphCompiler.Compile(string)` validates and compiles an original `.sg` string in Editor code.
- `StoryGraphAsset.IsValid`, `Errors`, `GetData()` and `CreatePlayer()` expose imported status and fresh data snapshots.
- `new StoryGraphPlayer(data)`, `Begin()`, `Next()`, `Choose(index)`, `Variables`, `OnDialogue`, `OnChoice` and `OnEnd` retain the original API. `CurrentNodeId` exposes the session's location; it becomes null after an ending.
- `StoryGraphData.FromJson(string)` continues to accept the existing Unity-oriented array JSON format, with the same strict runtime validation. The original public DTO type and field names are retained.

Runtime and Editor assemblies are separate. Newtonsoft JSON 3.2.2 is used only by the Editor compiler to read original `.sg` objects. The runtime DTO loader still uses Unity's `JsonUtility`.

## Scope and verification

This integrates a graph with Unity's import pipeline and provides a standalone narrative runner. Existing game-specific dialogue, scene, save, collection and external-process systems need a deliberate adapter or migration. The Birthday Party continues to use its current runtime until separately migrated.

There is no general save/load, rewind, arbitrary jump, or cross-session exactly-once assignment guarantee. Traversing a cycle intentionally executes its assignments again. Restart is explicitly defined as resetting the session to initial values.

EditMode tests under `Tests/Editor` cover import/reimport identity, invalid imports, conditions, effects and session reset. Add `"testables": ["com.hidden61ade.storygraph"]` to the project's `Packages/manifest.json` and install Unity Test Framework, then run the `StoryGraph.EditModeTests` assembly. The package was verified with Unity **6000.5.10f1** on 5 October 2026: **41 EditMode tests passed**, including a source edit detected through `AssetDatabase.Refresh()` and a serialized prefab reference that remained usable after the reimport. See [the test instructions](Tests/README.md) for the shared browser fixtures and [the verification record](../docs/unity-integration-verification.md) for scope.
