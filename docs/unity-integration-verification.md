# Unity integration verification — 5 October 2026

The generic package was compiled and tested in an isolated Unity **6000.5.10f1** project on Windows. The Birthday Party project was not modified or run.

## Completed checks

- `node scripts/check.mjs`: 23 JavaScript modules parse; all three shipped stories validate, round-trip and reach named endings; the revised refusal reaches the hidden ending.
- `node scripts/check-file-session.mjs`: nine groups cover opening, same-file saving, Save As, cancellation, failed writes, concurrent edits, project-switch races, download fallback and malformed project preservation.
- `node scripts/check-runtime-contract.mjs`: 12 runtime fixtures, 14 invalid fixtures and two fault fixtures pass 53 execution/rejection checkpoints shared with the C# tests.
- Unity EditMode: **41 passed, 0 failed, 0 skipped**. Coverage includes raw `.sg` compilation, source import/reimport, stable GUID and local ID, a saved prefab's runner reference surviving ordinary `AssetDatabase.Refresh()`, invalid imports clearing stale data, typed conditions/effects, restart, fault recovery and synchronous event access.
- Real-source smoke checks: the 23-, 63- and 103-node project sources import and reach their expected first-option endings. The revised source also reaches `Hidden Ending · Kept in the Dark` after refusing the first request. Imported assets and direct compilation produce identical route state.
- The Minimal Dialogue scene was created with Unity's scene API, with its sample script and imported story assigned. The script, graph and scene are included with stable metadata in `unity/Samples~/MinimalDialogue`.
- Browser UI: the English editor loads, offers Save/Save As, reports no issues for the revised graph and opens its dialogue preview.

## Limits of this verification

The file-session tests inject file handles and picker outcomes. A native operating-system file-picker save/open round-trip was not verified through browser automation. They are separate from the real Unity source-file and reimport tests.

The shipped scene was generated and compiled; its Play Mode UI was not manually played in this verification. The narrative player is exercised directly by the Unity tests. Other Unity versions and every possible story route have not been certified.

The package synchronises source files to assets. Active sessions retain snapshots; save migration, rewind and game-specific integrations remain separate work.
