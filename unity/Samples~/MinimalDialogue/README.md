# Minimal dialogue sample

Import **Minimal Dialogue** from the StoryGraph entry in Unity's Package Manager.

1. Open `StoryGraphSample.unity` in the imported sample folder.
2. Enter Play Mode. The English dialogue starts automatically.
3. Press **Continue**, then select a response. The sample displays the resulting ending and variable values.
4. Change a line in `sample.sg` and save it. Press **Begin again** to start a fresh session with the reimported text.

To build your own scene, add `StoryGraphSample` to an empty GameObject and assign the imported `sample.sg` asset to its **Story** field.

This sample only displays dialogue and variable state. It does not load a game scene, write saves, start external processes or restart the computer.
