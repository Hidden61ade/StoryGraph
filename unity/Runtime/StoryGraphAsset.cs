using System;
using System.Collections.Generic;
using UnityEngine;

namespace StoryGraph
{
    public sealed class StoryGraphAsset : ScriptableObject
    {
        [SerializeField] private StoryGraphData compiled;
        [SerializeField] private bool isValid;
        [SerializeField] private string[] errors = Array.Empty<string>();

        public bool IsValid => isValid && compiled != null;
        public IReadOnlyList<string> Errors => Array.AsReadOnly(errors ?? Array.Empty<string>());

        public StoryGraphData GetData()
        {
            if (!IsValid) throw new StoryGraphValidationException("This StoryGraph asset is invalid: " + string.Join("; ", errors ?? Array.Empty<string>()));
            return compiled.Clone();
        }

        public StoryGraphPlayer CreatePlayer()
        {
            return new StoryGraphPlayer(GetData());
        }

        public void SetData(StoryGraphData data)
        {
            StoryGraphValidation.Validate(data);
            compiled = data.Clone();
            errors = Array.Empty<string>();
            isValid = true;
        }

        public void SetInvalid(string[] validationErrors)
        {
            compiled = null;
            isValid = false;
            errors = validationErrors == null ? new[] { "Import failed." } : (string[])validationErrors.Clone();
        }
    }
}
