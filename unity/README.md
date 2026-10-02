# StoryGraph × Unity 运行时

把 StoryGraph 导出的剧情，在 Unity 里**零依赖**跑起来。本目录提供两份脚本：

| 文件 | 作用 |
| --- | --- |
| `StoryGraphData.cs` | 与「Unity 数据 JSON」一一对应的可序列化数据结构 + `FromJson`。 |
| `StoryGraphPlayer.cs` | 纯 C# 剧情解释器，挂事件即可对接你的对话 UI。 |

> 为什么不用引擎运行时 JSON？Unity 自带的 `JsonUtility` 无法反序列化「字典 / 多态」。
> 所以编辑器里专门提供了 **「⬇ Unity 数据（.json）」** 导出：variables / nodes 拍平成数组、
> value 统一字符串，`JsonUtility.FromJson` 即可直接读取，无需任何第三方库。

## 三步接入

1. 在 StoryGraph 里点 **检查** → **导出 → Unity 数据（.json）**，得到 `xxx.unity.json`。
2. 把该 json 放进 Unity 的 `Resources/`（或 `StreamingAssets/`），把本目录两个 `.cs` 拷进工程。
3. 用下面的脚本驱动剧情，把事件接到你的 UI 即可。

## 最小示例

```csharp
using System.Collections.Generic;
using UnityEngine;
using StoryGraph;

public class StoryDirector : MonoBehaviour
{
    public TextAsset storyJson;        // 拖入导出的 .unity.json（TextAsset）
    StoryGraphPlayer _player;

    void Start()
    {
        var data = StoryGraphData.FromJson(storyJson.text);
        _player = new StoryGraphPlayer(data);

        _player.OnDialogue += ShowLine;
        _player.OnChoice   += ShowChoices;
        _player.OnEnd      += ending => Debug.Log($"【结局】{ending}");

        _player.Begin();
    }

    void ShowLine(string speaker, string text)
    {
        Debug.Log($"{speaker}：{text}");
        // 你的对话框显示完，玩家点「继续」时调用：
        _player.Next();
    }

    void ShowChoices(string prompt, IReadOnlyList<StoryChoice> choices)
    {
        for (int i = 0; i < choices.Count; i++)
            Debug.Log($"  [{i}] {choices[i].text}");
        // 玩家点了第 i 个按钮时调用：
        // _player.Choose(i);
    }
}
```

## 节点 → Unity 处理对照

| 节点类型 | `type` | 运行时行为 |
| --- | --- | --- |
| 对话 | `dialogue` | 触发 `OnDialogue(speaker, text)`，等 `Next()`。 |
| 选择 | `choice` | 触发 `OnChoice(prompt, choices)`，等 `Choose(i)`；选项可带 `effects` 改变量。 |
| 条件 | `condition` | 按 `clauses` + `match`(all/any) 自动走 `whenTrue` / `whenFalse`。 |
| 赋值 | `set` | 自动执行 `assignments`（set/add/sub）后前进。 |
| 结局 | `end` | 触发 `OnEnd(ending)` 并停止。 |

## 进一步优化（可选）

- **ScriptableObject 化**：把 `StoryGraphData` 包一层 `ScriptableObject`，做成可在 Inspector 预览的剧情资产。
- **Addressables / 热更**：剧情是纯数据，改剧情**不需重新编译**，可走 Addressables 远程下发。
- **本地化**：导出后用 `id` 作为本地化 key，把 `text` 抽到 Unity Localization 表，多语言无痛切换。
- **存档**：`Player.Variables` 即完整状态，配合当前节点 id 落盘即可实现存读档。
