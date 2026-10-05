using System.Collections.Generic;
using UnityEngine;
using StoryGraph;

public sealed class StoryGraphSample : MonoBehaviour
{
    public StoryGraphAsset story;
    private StoryGraphPlayer player;
    private string heading = "StoryGraph sample";
    private string body = "Assign the imported sample.sg asset, then press Begin.";
    private IReadOnlyList<StoryChoice> choices;
    private bool awaitingDialogue;

    private void Start() => Begin();

    private void Begin()
    {
        if (story == null || !story.IsValid)
        {
            body = "Assign a valid .sg asset in the Inspector.";
            return;
        }
        player = story.CreatePlayer();
        player.OnDialogue += (speaker, text) => { heading = speaker; body = text; choices = null; awaitingDialogue = true; };
        player.OnChoice += (prompt, options) => { heading = "Your choice"; body = prompt; choices = options; awaitingDialogue = false; };
        player.OnEnd += ending => { heading = "Ending"; body = ending; choices = null; awaitingDialogue = false; };
        player.Begin();
    }

    private void OnGUI()
    {
        GUILayout.BeginArea(new Rect(20, 20, Mathf.Min(680, Screen.width - 40), Screen.height - 40), GUI.skin.box);
        GUILayout.Label(heading);
        GUILayout.Label(body);
        if (awaitingDialogue && GUILayout.Button("Continue")) player.Next();
        if (choices != null)
        {
            var visibleChoices = choices;
            for (int index = 0; index < visibleChoices.Count; index++)
                if (GUILayout.Button(visibleChoices[index].text)) { player.Choose(index); break; }
        }
        if (GUILayout.Button("Begin again")) Begin();
        if (player != null)
            foreach (var entry in player.Variables) GUILayout.Label(entry.Key + ": " + entry.Value);
        GUILayout.EndArea();
    }
}
