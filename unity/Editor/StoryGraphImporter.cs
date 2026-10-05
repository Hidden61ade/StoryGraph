using System;
using System.IO;
using UnityEditor.AssetImporters;
using UnityEngine;

namespace StoryGraph.Editor
{
    [ScriptedImporter(1, "sg")]
    public sealed class StoryGraphImporter : ScriptedImporter
    {
        public override void OnImportAsset(AssetImportContext context)
        {
            var asset = ScriptableObject.CreateInstance<StoryGraphAsset>();
            asset.name = Path.GetFileNameWithoutExtension(context.assetPath);
            try
            {
                // Compile the original project each time. Older .sg files need no resave.
                asset.SetData(StoryGraphCompiler.Compile(File.ReadAllText(context.assetPath)));
            }
            catch (Exception error)
            {
                asset.SetInvalid(new[] { error.Message });
                context.LogImportError("StoryGraph import failed: " + error.Message);
            }
            // Stable identifier preserves scene references and the subasset local ID.
            context.AddObjectToAsset("story", asset);
            context.SetMainObject(asset);
        }
    }
}
