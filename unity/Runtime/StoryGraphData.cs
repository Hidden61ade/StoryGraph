using System;
using UnityEngine;

namespace StoryGraph
{
    // These public DTOs retain the original Unity JSON integration API.
    [Serializable]
    public class StoryGraphData
    {
        public string name;
        public string start;
        public StoryVar[] variables;
        public StoryNode[] nodes;

        public static StoryGraphData FromJson(string json)
        {
            if (string.IsNullOrEmpty(json)) throw new StoryGraphValidationException("Story JSON is empty.");
            StoryGraphData data = JsonUtility.FromJson<StoryGraphData>(json);
            StoryGraphValidation.Validate(data);
            return data;
        }

        public StoryGraphData Clone()
        {
            return FromJson(JsonUtility.ToJson(this));
        }
    }

    [Serializable]
    public class StoryVar
    {
        public string name;
        public string type;
        public string value;
    }

    [Serializable]
    public class StoryNode
    {
        public string id;
        public string type;
        public string speaker;
        public string text;
        public string next;
        public string prompt;
        public StoryChoice[] choices;
        public string match;
        public StoryClause[] clauses;
        public string whenTrue;
        public string whenFalse;
        public StoryEffect[] assignments;
        public string ending;
    }

    [Serializable]
    public class StoryChoice
    {
        public string text;
        public string next;
        public StoryEffect[] effects;
    }

    [Serializable]
    public class StoryEffect
    {
        public string variable;
        public string op;
        public string value;
    }

    [Serializable]
    public class StoryClause
    {
        public string variable;
        public string op;
        public string value;
    }
}
