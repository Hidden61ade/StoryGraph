// StoryGraphData.cs
// StoryGraph 导出的「Unity 数据 JSON」对应的可序列化数据结构。
//
// 设计要点（为什么这样写）：
//  - Unity 自带的 JsonUtility 无法反序列化「字典/Map」与「多态类型」，
//    所以导出格式把 variables / nodes 都拍平成「数组」，节点共用同一套字段（缺省留空）。
//  - 所有 value 统一是字符串，运行时再按变量类型（number/boolean/string）还原，
//    这样无需任何第三方 JSON 库，JsonUtility.FromJson 即可直接读取。
//
// 用法：StoryGraphData data = StoryGraphData.FromJson(textAsset.text);

using System;
using UnityEngine;

namespace StoryGraph
{
    [Serializable]
    public class StoryGraphData
    {
        public string name;
        public string start;            // 入口节点 id
        public StoryVar[] variables;
        public StoryNode[] nodes;

        /// 从导出的 .unity.json 文本解析。
        public static StoryGraphData FromJson(string json)
        {
            return JsonUtility.FromJson<StoryGraphData>(json);
        }
    }

    [Serializable]
    public class StoryVar
    {
        public string name;
        public string type;             // number | boolean | string
        public string value;            // 初始值（字符串，按 type 还原）
    }

    /// 扁平节点：不同 type 只用到其中一部分字段，其余留空即可。
    [Serializable]
    public class StoryNode
    {
        public string id;
        public string type;             // dialogue | choice | condition | set | end

        // dialogue
        public string speaker;
        public string text;

        // dialogue / set：下一步节点 id
        public string next;

        // choice
        public string prompt;
        public StoryChoice[] choices;

        // condition
        public string match;            // all | any
        public StoryClause[] clauses;
        public string whenTrue;
        public string whenFalse;

        // set
        public StoryEffect[] assignments;

        // end
        public string ending;
    }

    [Serializable]
    public class StoryChoice
    {
        public string text;
        public string next;
        public StoryEffect[] effects;
    }

    /// 变量改动（选择项效果 / 赋值节点共用）。
    [Serializable]
    public class StoryEffect
    {
        public string variable;
        public string op;               // set | add | sub
        public string value;
    }

    /// 条件判断子句。
    [Serializable]
    public class StoryClause
    {
        public string variable;
        public string op;               // == | != | > | >= | < | <=
        public string value;
    }
}
