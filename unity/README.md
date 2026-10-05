# StoryGraph Unity integration prototype

This folder contains two dependency-free C# files for running a core StoryGraph export in Unity:

| File | Purpose |
| --- | --- |
| `StoryGraphData.cs` | Serializable structures for Unity JSON and `FromJson()`. |
| `StoryGraphPlayer.cs` | Event-driven interpreter for dialogue, choices, conditions, assignments, and endings. |

The editor’s **Export → Unity JSON (.json)** format uses arrays instead of dictionaries and stores values as strings alongside variable types. Unity’s `JsonUtility.FromJson` can read that schema without another JSON library.

This is an integration prototype, separate from the custom narrative runtime in the released *The Birthday Party*. That game does not automatically import or synchronize the example `.sg` graph.

## Connect a dialogue UI

1. Choose **Check**, then **Export → Unity JSON (.json)** to download `story.unity.json`.
2. Copy both `.cs` files into a Unity project and import the JSON as a `TextAsset`.
3. Create a player and connect its events to your UI:

```csharp
using UnityEngine;
using StoryGraph;

public class StoryBootstrap : MonoBehaviour
{
    public TextAsset storyJson;
    private StoryGraphPlayer player;

    void Start()
    {
        var data = StoryGraphData.FromJson(storyJson.text);
        player = new StoryGraphPlayer(data);
        player.OnDialogue += (speaker, text) => Debug.Log($"{speaker}: {text}");
        player.OnChoice += (prompt, choices) => Debug.Log(prompt);
        player.OnEnd += ending => Debug.Log($"Ending: {ending}");
        player.Begin();
    }

    // Call after the player dismisses a line of dialogue.
    public void ContinueDialogue() => player.Next();

    // Call with the index of the option selected in your UI.
    public void SelectOption(int index) => player.Choose(index);
}
```

Inspect the C# namespace and event signatures when integrating with an existing project. The sample only logs events; it does not build a dialogue UI.

## Core node behavior

| Editor node | Runtime `type` | Behavior |
| --- | --- | --- |
| Dialogue | `dialogue` | Raise `OnDialogue(speaker, text)` and wait for `Next()`. |
| Choice | `choice` | Raise `OnChoice(prompt, choices)` and wait for `Choose(index)`; apply option effects before advancing. |
| Condition | `condition` | Evaluate clauses using AND, OR, NAND, or NOR and follow `whenTrue` or `whenFalse`. |
| Assignment | `set` | Apply `set`, `add`, or `sub` operations, then advance. |
| Ending | `end` | Raise `OnEnd(ending)` and stop. |

## Integration boundaries

The browser and C# players implement the same core node categories, but full behavioral parity has not been validated. The browser’s `begin()` restores initial variables. The C# player’s `Begin()` currently returns to the entry node while keeping its existing variables; create a new player for a fresh run. Neither provides a complete save/load, rewind, or arbitrary-jump contract. Re-entering an assignment can apply it again. The C# interpreter also needs a loop guard for production use.

Room interactions, collection triggers, repeated-playthrough changes, external executables, localization, and custom plugin nodes require game-specific integration. The exposed variable dictionary alone is insufficient for a full save: the current node, effect replay behavior, and any game-side state also need an explicit contract.

Possible next steps include a ScriptableObject wrapper for imported data, localization keyed by node ID, and an explicitly tested save/restart system. These are integration options, not features already implemented by this prototype.
