using System;
using System.Collections.Generic;
using UnityEngine;

namespace StoryGraph
{
    public sealed class StoryGraphRunner : MonoBehaviour
    {
        public StoryGraphAsset story;
        public bool beginOnStart = true;
        public event Action<string, string> OnDialogue;
        public event Action<string, IReadOnlyList<StoryChoice>> OnChoice;
        public event Action<string> OnEnd;
        public StoryGraphPlayer Player { get; private set; }

        private void Start()
        {
            if (beginOnStart) Begin();
        }

        public void Begin()
        {
            Player = null;
            if (story == null) throw new InvalidOperationException("Assign a valid imported StoryGraph asset before beginning.");
            // A fresh session observes the latest successful import. Active sessions keep their snapshot.
            try
            {
                var nextPlayer = story.CreatePlayer();
                nextPlayer.OnDialogue += (speaker, text) => OnDialogue?.Invoke(speaker, text);
                nextPlayer.OnChoice += (prompt, choices) => OnChoice?.Invoke(prompt, choices);
                nextPlayer.OnEnd += ending => OnEnd?.Invoke(ending);
                // Initial visible-state callbacks must be able to inspect the new session.
                Player = nextPlayer;
                nextPlayer.Begin();
            }
            catch
            {
                Player = null;
                throw;
            }
        }

        public void Next() => Player?.Next();
        public void Choose(int index) => Player?.Choose(index);
    }
}
