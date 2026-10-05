These EditMode tests exercise the standalone StoryGraph package. They do not load The Birthday Party or modify a game project.

The fixture `.json` files contain original `.sg` project data, including canvas nodes and edges. Tests copy a selected file to `Assets/__StoryGraphTests_<random>/story.sg` to exercise the importer. Invalid fixtures deliberately use `.json` or `.txt` so importing the test package does not immediately invoke the `.sg` importer on invalid data. Each test deletes only its own temporary folder.

Run the Unity EditMode filter `StoryGraph.Tests.StoryGraphIntegrationTests` in a project with this package and the Unity Test Framework installed. The test assembly references `StoryGraph.Runtime` and `StoryGraph.Editor`; the importer uses Unity's Newtonsoft JSON package. The suite passed 41 tests in Unity 6000.5.10f1 on 5 October 2026; rerun it when integrating into another Unity project.

From the StoryGraph repository root, regenerate deterministic fixtures with `node scripts/generate-unity-fixtures.mjs` and run the browser runtime against the same expected states with `node scripts/check-runtime-contract.mjs`.

Coverage includes typed set/add/sub and branch effects, all/any/nand/nor and empty clauses, repeated Begin resetting state, authoring-only notes, Unicode dialogue, ISO date strings retaining their exact text, culture-independent decimal parsing, isolated player/asset copies, automatic-loop limits, invalid original graph diagnostics, rejection of trailing JSON content, direct `.sg` import, stable GUID/local ID after forced reimport, a saved prefab's StoryGraphRunner reference surviving ordinary AssetDatabase.Refresh source scanning, newly added dialogue, invalid reimport refusing to expose stale runnable data, and recovery after the source is corrected.

Failure cases also cover atomic multi-effect batches, retention of a previous successful batch when a later batch fails, faulted sessions rejecting repeated Next/Choose until Begin resets them, failed runner starts clearing the old Player, and the first synchronous dialogue callback reading the new Player's variables.
