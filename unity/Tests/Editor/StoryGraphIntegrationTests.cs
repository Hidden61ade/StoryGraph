using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using NUnit.Framework;
using StoryGraph.Editor;
using UnityEditor;
using UnityEngine;
using UnityEngine.TestTools;

namespace StoryGraph.Tests
{
    public sealed class StoryGraphIntegrationTests
    {
        private string _temporaryFolder;
        private string _fixtureFolder;
        private FixtureManifest _manifest;

        private static readonly string[] RuntimeFixtureNames =
        {
            "typed-flow", "iso-date-string", "match-all", "match-all-empty", "match-any", "match-any-empty",
            "match-nand", "match-nand-empty", "match-nor", "match-nor-empty",
            "reimport-original", "reimport-updated"
        };

        [SetUp]
        public void SetUp()
        {
            var manifestPath = AssetDatabase.FindAssets("StoryGraphIntegrationFixtures t:TextAsset")
                .Select(AssetDatabase.GUIDToAssetPath)
                .Single(path => Path.GetFileName(path) == "StoryGraphIntegrationFixtures.json");
            _fixtureFolder = Path.GetDirectoryName(AbsolutePath(manifestPath));
            _manifest = JsonUtility.FromJson<FixtureManifest>(File.ReadAllText(AbsolutePath(manifestPath)));
            var name = "__StoryGraphTests_" + Guid.NewGuid().ToString("N");
            _temporaryFolder = "Assets/" + name;
            Assert.That(AssetDatabase.CreateFolder("Assets", name), Is.Not.Empty);
        }

        [TearDown]
        public void TearDown()
        {
            if (string.IsNullOrEmpty(_temporaryFolder)) return;
            Assert.That(_temporaryFolder, Does.StartWith("Assets/__StoryGraphTests_"));
            Assert.That(AssetDatabase.DeleteAsset(_temporaryFolder), Is.True, "Remove only this test's temporary assets.");
        }

        [TestCaseSource(nameof(RuntimeFixtureNames))]
        public void OriginalProjectCompiler_MatchesSharedRuntimeOutcomes(string fixtureName)
        {
            var fixture = _manifest.runtimeCases.Single(item => item.name == fixtureName);
            var data = StoryGraphCompiler.Compile(ReadFixture(fixture.file));
            Assert.That(data.nodes.Any(item => item.type == "start" || item.type == "note"), Is.False,
                "Start and Note are authoring nodes, not runtime dialogue.");
            RunFixture(new StoryGraphPlayer(data), fixture);
        }

        [Test]
        public void OriginalSg_ImportsToRunnableAsset()
        {
            var asset = ImportFixture("typed-flow.json", out _);
            Assert.That(asset.IsValid, Is.True);
            Assert.That(asset.Errors, Is.Empty);
            RunFixture(asset.CreatePlayer(), _manifest.runtimeCases.Single(item => item.name == "typed-flow"));
        }

        [Test]
        public void SourceEdit_ForceReimportRetainsGuidAndLocalIdAndLoadsNewDialogue()
        {
            var originalAsset = ImportFixture(_manifest.reimport.original, out var path);
            Assert.That(AssetDatabase.TryGetGUIDAndLocalFileIdentifier(originalAsset, out string originalGuid, out long originalId), Is.True);
            RunFixture(originalAsset.CreatePlayer(), _manifest.runtimeCases.Single(item => item.name == "reimport-original"));

            WriteSource(path, ReadFixture(_manifest.reimport.updated));
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var updatedAsset = AssetDatabase.LoadAssetAtPath<StoryGraphAsset>(path);
            Assert.That(updatedAsset, Is.Not.Null);
            Assert.That(updatedAsset.IsValid, Is.True);
            Assert.That(AssetDatabase.TryGetGUIDAndLocalFileIdentifier(updatedAsset, out string updatedGuid, out long updatedId), Is.True);
            Assert.That(updatedGuid, Is.EqualTo(originalGuid), "Editing source must retain project references.");
            Assert.That(updatedId, Is.EqualTo(originalId), "The stable importer object identifier must retain sub-asset references.");
            RunFixture(updatedAsset.CreatePlayer(), _manifest.runtimeCases.Single(item => item.name == "reimport-updated"));
        }

        [Test]
        public void SourceEdit_AutomaticRefreshPreservesSerializedPrefabRunnerReference()
        {
            var originalAsset = ImportFixture(_manifest.reimport.original, out var storyPath);
            Assert.That(AssetDatabase.TryGetGUIDAndLocalFileIdentifier(originalAsset, out string originalGuid, out long originalId), Is.True);
            var prefabPath = _temporaryFolder + "/runner.prefab";
            var temporaryObject = new GameObject("StoryGraph test runner");
            try
            {
                var component = temporaryObject.AddComponent<StoryGraphRunner>();
                component.story = originalAsset;
                component.beginOnStart = false;
                Assert.That(PrefabUtility.SaveAsPrefabAsset(temporaryObject, prefabPath), Is.Not.Null);
            }
            finally { UnityEngine.Object.DestroyImmediate(temporaryObject); }

            // Load the saved prefab instead of relying on the original in-memory assignment.
            var originalPrefab = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                var component = originalPrefab.GetComponent<StoryGraphRunner>();
                Assert.That(component.story, Is.Not.Null);
                Assert.That(AssetDatabase.GetAssetPath(component.story), Is.EqualTo(storyPath));
                string opening = null;
                component.OnDialogue += (speaker, text) => opening = text;
                component.Begin();
                Assert.That(opening, Is.EqualTo("Original opening."));
            }
            finally { PrefabUtility.UnloadPrefabContents(originalPrefab); }

            WriteSource(storyPath, ReadFixture(_manifest.reimport.updated));
            // Exercise ordinary source-file scanning, with no explicit ImportAsset or ForceUpdate.
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

            var refreshedPrefab = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                var component = refreshedPrefab.GetComponent<StoryGraphRunner>();
                Assert.That(component.story, Is.Not.Null, "The serialized prefab reference must survive automatic source refresh.");
                Assert.That(component.story.IsValid, Is.True);
                Assert.That(AssetDatabase.GetAssetPath(component.story), Is.EqualTo(storyPath));
                Assert.That(AssetDatabase.TryGetGUIDAndLocalFileIdentifier(component.story, out string refreshedGuid, out long refreshedId), Is.True);
                Assert.That(refreshedGuid, Is.EqualTo(originalGuid));
                Assert.That(refreshedId, Is.EqualTo(originalId));
                var dialogues = new List<string>();
                string ending = null;
                component.OnDialogue += (speaker, text) => dialogues.Add(text);
                component.OnEnd += value => ending = value;
                component.Begin();
                component.Next();
                component.Next();
                Assert.That(dialogues, Is.EqualTo(new[] { "Updated opening.", "A newly added dialogue." }),
                    "A fresh runner session must observe automatically reimported source.");
                Assert.That(ending, Is.EqualTo("finished"));
                Assert.That(component.Player.CurrentNodeId, Is.Null);
            }
            finally { PrefabUtility.UnloadPrefabContents(refreshedPrefab); }
        }

        [TestCase("missing-start")]
        [TestCase("unknown-effect-variable")]
        [TestCase("unknown-condition-variable")]
        [TestCase("plugin-node")]
        [TestCase("dangling-edge")]
        [TestCase("duplicate-output")]
        [TestCase("missing-output")]
        [TestCase("duplicate-variable")]
        [TestCase("hex-number")]
        [TestCase("boolean-whitespace")]
        [TestCase("nonstring-string")]
        [TestCase("boolean-add-effect")]
        [TestCase("malformed-json")]
        [TestCase("trailing-json")]
        public void InvalidOriginalProject_CompilerRejectsWithDiagnostic(string fixtureName)
        {
            var fixture = _manifest.invalidCases.Single(item => item.name == fixtureName);
            var exception = Assert.Throws<StoryGraphValidationException>(() => StoryGraphCompiler.Compile(ReadFixture(fixture.file)));
            Assert.That(exception.Message, Is.Not.Empty);
            if (!string.IsNullOrEmpty(fixture.diagnostic)) Assert.That(exception.Message.ToLowerInvariant(), Does.Contain(fixture.diagnostic.ToLowerInvariant()));
        }

        [TestCase("missing-start")]
        [TestCase("unknown-effect-variable")]
        [TestCase("plugin-node")]
        public void InvalidReimport_ClearsRunnableDataInsteadOfRetainingOldStory(string fixtureName)
        {
            var original = ImportFixture(_manifest.reimport.original, out var path);
            Assert.That(original.IsValid, Is.True);
            var fixture = _manifest.invalidCases.Single(item => item.name == fixtureName);
            WriteSource(path, ReadFixture(fixture.file));
            LogAssert.Expect(LogType.Error, new Regex("StoryGraph import failed:"));
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var invalidAsset = AssetDatabase.LoadAssetAtPath<StoryGraphAsset>(path);
            Assert.That(invalidAsset, Is.Not.Null, "An invalid source retains an inspectable diagnostic asset.");
            Assert.That(invalidAsset.IsValid, Is.False);
            Assert.That(invalidAsset.Errors, Is.Not.Empty);
            Assert.Throws<StoryGraphValidationException>(() => invalidAsset.GetData());
            Assert.Throws<StoryGraphValidationException>(() => invalidAsset.CreatePlayer());

            // Fixing the same file must recover it, rather than leaving a sticky failure.
            WriteSource(path, ReadFixture(_manifest.reimport.updated));
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var recovered = AssetDatabase.LoadAssetAtPath<StoryGraphAsset>(path);
            Assert.That(recovered.IsValid, Is.True);
            Assert.That(recovered.Errors, Is.Empty);
            RunFixture(recovered.CreatePlayer(), _manifest.runtimeCases.Single(item => item.name == "reimport-updated"));
        }

        [Test, Timeout(2000)]
        public void AutomaticCycle_ThrowsAtGuardInsteadOfHangingEditor()
        {
            var data = StoryGraphCompiler.Compile(ReadFixture(_manifest.automaticLoop.file));
            var player = new StoryGraphPlayer(data);
            Assert.That(StoryGraphPlayer.MaxAutomaticSteps, Is.EqualTo(_manifest.automaticLoop.automaticStepLimit));
            var exception = Assert.Throws<InvalidOperationException>(() => player.Begin());
            Assert.That(exception.Message, Does.Contain(_manifest.automaticLoop.automaticStepLimit.ToString(CultureInfo.InvariantCulture)));
            Assert.That(exception.Message, Does.Contain("n_loop_"), "The error should identify the active graph location.");
            Assert.That(player.IsFaulted, Is.True);
            Assert.That(player.CurrentNodeId, Is.Null);
            Assert.Throws<InvalidOperationException>(() => player.Next());
            Assert.Throws<InvalidOperationException>(() => player.Choose(0));
        }

        [TestCase("choice-overflow")]
        [TestCase("automatic-overflow")]
        public void EffectsFailure_IsAtomicAndFaultedRetriesCannotAccumulateState(string fixtureName)
        {
            var fixture = _manifest.faultCases.Single(item => item.name == fixtureName);
            var player = new StoryGraphPlayer(StoryGraphCompiler.Compile(ReadFixture(fixture.file)));
            var initial = new RuntimeFixture { name = fixture.name, steps = new[] { fixture.initial } };
            RunFixture(player, initial);
            Assert.That(player.IsFaulted, Is.False);
            var exception = Assert.Throws<InvalidOperationException>(() => player.Choose(fixture.choiceIndex));
            Assert.That(exception.Message, Does.Contain("nonfinite"));
            Assert.That(player.IsFaulted, Is.True);
            Assert.That(player.CurrentNodeId, Is.Null);
            AssertVariables(player, fixture.failureVariables, fixture.name + " atomic failure");

            Assert.That(Assert.Throws<InvalidOperationException>(() => player.Next()).Message, Does.Contain("faulted"));
            Assert.That(Assert.Throws<InvalidOperationException>(() => player.Choose(fixture.choiceIndex)).Message, Does.Contain("faulted"));
            AssertVariables(player, fixture.failureVariables, fixture.name + " rejected retries");

            RunFixture(player, initial);
            Assert.That(player.IsFaulted, Is.False, "Begin must create a clean attempt with initial variables.");
            Assert.Throws<InvalidOperationException>(() => player.Choose(fixture.choiceIndex));
            AssertVariables(player, fixture.failureVariables, fixture.name + " independent attempt after Begin");
        }

        [TestCase("invalid-asset")]
        [TestCase("null-asset")]
        [TestCase("automatic-loop")]
        public void Runner_FailedBeginClearsOldPlayerAndCanRecover(string failure)
        {
            var asset = ImportFixture(_manifest.reimport.original, out _);
            var gameObject = new GameObject("StoryGraph failed Begin test");
            try
            {
                var runner = gameObject.AddComponent<StoryGraphRunner>();
                runner.beginOnStart = false;
                runner.story = asset;
                var dialogues = new List<string>();
                runner.OnDialogue += (speaker, text) => dialogues.Add(text);
                runner.Begin();
                Assert.That(runner.Player, Is.Not.Null);
                Assert.That(runner.Player.CurrentNodeId, Is.EqualTo("n_intro"));
                switch (failure)
                {
                    case "invalid-asset": asset.SetInvalid(new[] { "Test invalid source." }); break;
                    case "null-asset": runner.story = null; break;
                    case "automatic-loop": asset.SetData(StoryGraphCompiler.Compile(ReadFixture(_manifest.automaticLoop.file))); break;
                    default: Assert.Fail("Unknown Begin failure scenario."); break;
                }
                Assert.Catch<Exception>(() => runner.Begin());
                Assert.That(runner.Player, Is.Null, "A failed Begin must not keep the old runnable session.");
                runner.Next();
                runner.Choose(0);
                Assert.That(dialogues, Is.EqualTo(new[] { "Original opening." }), "Runner cannot replay old data after failure.");

                asset.SetData(StoryGraphCompiler.Compile(ReadFixture(_manifest.reimport.updated)));
                runner.story = asset;
                runner.Begin();
                Assert.That(runner.Player, Is.Not.Null);
                Assert.That(runner.Player.IsFaulted, Is.False);
                runner.Next();
                Assert.That(dialogues, Is.EqualTo(new[] { "Original opening.", "Updated opening.", "A newly added dialogue." }));
            }
            finally { UnityEngine.Object.DestroyImmediate(gameObject); }
        }

        [Test]
        public void Runner_InitialDialogueCallbackCanReadCurrentPlayerState()
        {
            var asset = ImportFixture("typed-flow.json", out _);
            var gameObject = new GameObject("StoryGraph synchronous callback test");
            try
            {
                var runner = gameObject.AddComponent<StoryGraphRunner>();
                runner.beginOnStart = false;
                runner.story = asset;
                StoryGraphPlayer observedPlayer = null;
                runner.OnDialogue += (speaker, text) =>
                {
                    observedPlayer = runner.Player;
                    Assert.That(observedPlayer, Is.Not.Null, "The first synchronous callback needs the current session.");
                    Assert.That(observedPlayer.IsFaulted, Is.False);
                    Assert.That(observedPlayer.CurrentNodeId, Is.EqualTo("n_intro"));
                    Assert.That(observedPlayer.Variables["score"], Is.EqualTo(1.25d));
                };
                runner.Begin();
                Assert.That(runner.Player, Is.SameAs(observedPlayer));
            }
            finally { UnityEngine.Object.DestroyImmediate(gameObject); }
        }

        [Test]
        public void PlayerSessionsAndAssetCopies_DoNotShareMutableState()
        {
            var asset = ImportFixture("typed-flow.json", out _);
            var copy = asset.GetData();
            copy.nodes.Single(item => item.id == "n_intro").text = "Mutated caller copy.";
            var first = asset.CreatePlayer();
            var second = asset.CreatePlayer();
            RunFixture(first, _manifest.runtimeCases.Single(item => item.name == "typed-flow"));
            var untouched = new RuntimeFixture
            {
                name = "independent session",
                steps = new[] { _manifest.runtimeCases.Single(item => item.name == "typed-flow").steps[0] }
            };
            RunFixture(second, untouched);
            RunFixture(asset.CreatePlayer(), untouched);
        }

        [Test]
        public void NumericParsingAndComparison_AreIndependentOfEditorCulture()
        {
            var originalCulture = CultureInfo.CurrentCulture;
            var originalUiCulture = CultureInfo.CurrentUICulture;
            try
            {
                CultureInfo.CurrentCulture = new CultureInfo("fr-FR");
                CultureInfo.CurrentUICulture = new CultureInfo("fr-FR");
                var fixture = _manifest.runtimeCases.Single(item => item.name == "typed-flow");
                RunFixture(new StoryGraphPlayer(StoryGraphCompiler.Compile(ReadFixture(fixture.file))), fixture);
            }
            finally
            {
                CultureInfo.CurrentCulture = originalCulture;
                CultureInfo.CurrentUICulture = originalUiCulture;
            }
        }

        private StoryGraphAsset ImportFixture(string file, out string assetPath)
        {
            assetPath = _temporaryFolder + "/story.sg";
            WriteSource(assetPath, ReadFixture(file));
            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var asset = AssetDatabase.LoadAssetAtPath<StoryGraphAsset>(assetPath);
            Assert.That(asset, Is.Not.Null, "The .sg importer must create StoryGraphAsset directly from original project JSON.");
            return asset;
        }

        private static void RunFixture(StoryGraphPlayer player, RuntimeFixture fixture)
        {
            ObservedState observed = null;
            player.OnDialogue += (speaker, text) => observed = new ObservedState { kind = "dialogue", speaker = speaker, text = text };
            player.OnChoice += (prompt, choices) => observed = new ObservedState { kind = "choice", prompt = prompt, choices = choices.Select(item => item.text).ToArray() };
            player.OnEnd += ending => observed = new ObservedState { kind = "end", ending = ending };
            foreach (var expected in fixture.steps)
            {
                observed = null;
                switch (expected.command)
                {
                    case "begin": player.Begin(); break;
                    case "next": player.Next(); break;
                    case "choose": player.Choose(expected.choiceIndex); break;
                    default: Assert.Fail("Unknown fixture command " + expected.command); break;
                }
                var context = fixture.name + ": " + expected.command;
                Assert.That(observed, Is.Not.Null, context + " should emit a visible state.");
                // JsonUtility normalizes JSON null string fields to empty strings. The runtime
                // contract explicitly closes the current node at End; assert that semantic state.
                if (expected.state.kind == "end") Assert.That(player.CurrentNodeId, Is.Null, context + " closed node");
                else Assert.That(player.CurrentNodeId, Is.EqualTo(expected.currentNodeId), context + " node");
                Assert.That(observed.kind, Is.EqualTo(expected.state.kind), context + " kind");
                switch (observed.kind)
                {
                    case "dialogue":
                        Assert.That(observed.speaker, Is.EqualTo(expected.state.speaker), context + " speaker");
                        Assert.That(observed.text, Is.EqualTo(expected.state.text), context + " text");
                        break;
                    case "choice":
                        Assert.That(observed.prompt, Is.EqualTo(expected.state.prompt), context + " prompt");
                        Assert.That(observed.choices, Is.EqualTo(expected.state.choices), context + " choices");
                        break;
                    case "end": Assert.That(observed.ending, Is.EqualTo(expected.state.ending), context + " ending"); break;
                }
                AssertVariables(player, expected.variables, context);
            }
        }

        private static void AssertVariables(StoryGraphPlayer player, ExpectedVariable[] variables, string context)
        {
            foreach (var variable in variables ?? Array.Empty<ExpectedVariable>())
            {
                Assert.That(player.Variables.ContainsKey(variable.name), Is.True, context + " variable " + variable.name);
                var value = player.Variables[variable.name];
                switch (variable.type)
                {
                    case "number":
                        Assert.That(value, Is.TypeOf<double>(), context + " typed number");
                        Assert.That((double)value, Is.EqualTo(double.Parse(variable.value, CultureInfo.InvariantCulture)).Within(1e-10), context + " " + variable.name);
                        break;
                    case "boolean": Assert.That(value, Is.TypeOf<bool>()); Assert.That(value, Is.EqualTo(variable.value == "true"), context + " " + variable.name); break;
                    case "string": Assert.That(value, Is.TypeOf<string>()); Assert.That(value, Is.EqualTo(variable.value), context + " " + variable.name); break;
                    default: Assert.Fail("Unknown fixture variable type " + variable.type); break;
                }
            }
        }

        private string ReadFixture(string file) => File.ReadAllText(Path.Combine(_fixtureFolder, file));
        private static string AbsolutePath(string path) => Path.Combine(Directory.GetParent(Application.dataPath).FullName, path);
        private static void WriteSource(string path, string text) => File.WriteAllText(AbsolutePath(path), text, new UTF8Encoding(false));

        [Serializable] private sealed class FixtureManifest { public int version; public RuntimeFixture[] runtimeCases; public InvalidFixture[] invalidCases; public FaultFixture[] faultCases; public LoopFixture automaticLoop; public ReimportFixture reimport; }
        [Serializable] private sealed class RuntimeFixture { public string name; public string file; public ExpectedStep[] steps; }
        [Serializable] private sealed class InvalidFixture { public string name; public string file; public string diagnostic; }
        [Serializable] private sealed class LoopFixture { public string file; public int automaticStepLimit; }
        [Serializable] private sealed class ReimportFixture { public string original; public string updated; }
        [Serializable] private sealed class ExpectedStep { public string command; public int choiceIndex; public string currentNodeId; public ObservedState state; public ExpectedVariable[] variables; }
        [Serializable] private sealed class ObservedState { public string kind; public string speaker; public string text; public string prompt; public string[] choices; public string ending; }
        [Serializable] private sealed class ExpectedVariable { public string name; public string type; public string value; }
        [Serializable] private sealed class FaultFixture { public string name; public string file; public int choiceIndex; public ExpectedStep initial; public ExpectedVariable[] failureVariables; }
    }
}
