// StoryGraphPlayer.cs
// 纯 C# 的剧情解释器：按 StoryGraphData 逐步「播放」剧情。
// 与引擎解耦——不依赖任何 Unity UI，挂上事件即可对接你自己的对话框。
//
// 典型用法见 unity/README.md。核心约定：
//  - 对话(dialogue) / 选择(choice) 是「可见」节点，会触发事件并暂停，等玩家操作；
//  - 赋值(set) / 条件(condition) 是「不可见」节点，会被自动处理直到遇到下一个可见节点；
//  - 处理完一条对话后调用 Next() 继续；处理完一组选项后调用 Choose(index) 继续。

using System;
using System.Collections.Generic;
using System.Globalization;

namespace StoryGraph
{
    public class StoryGraphPlayer
    {
        public event Action<string, string> OnDialogue;                     // speaker, text
        public event Action<string, IReadOnlyList<StoryChoice>> OnChoice;   // prompt, choices
        public event Action<string> OnEnd;                                  // ending 名称

        readonly StoryGraphData _data;
        readonly Dictionary<string, StoryNode> _nodes = new Dictionary<string, StoryNode>();
        readonly Dictionary<string, string> _varType = new Dictionary<string, string>();
        readonly Dictionary<string, object> _state = new Dictionary<string, object>();

        string _current;

        /// 运行时变量当前值（只读，便于存档 / 调试 / UI 展示）。
        public IReadOnlyDictionary<string, object> Variables => _state;

        public StoryGraphPlayer(StoryGraphData data)
        {
            _data = data ?? throw new ArgumentNullException(nameof(data));

            if (data.nodes != null)
                foreach (var n in data.nodes)
                    if (n != null && !string.IsNullOrEmpty(n.id)) _nodes[n.id] = n;

            if (data.variables != null)
                foreach (var v in data.variables)
                {
                    if (v == null || string.IsNullOrEmpty(v.name)) continue;
                    _varType[v.name] = v.type;
                    _state[v.name] = Coerce(v.type, v.value);
                }
        }

        /// 从入口开始播放。
        public void Begin()
        {
            _current = _data.start;
            Resolve();
        }

        /// 处理完一条对话后调用，前进到下一步。
        public void Next()
        {
            var node = Current();
            if (node != null && node.type == "dialogue")
            {
                _current = node.next;
                Resolve();
            }
        }

        /// 处理完一组选项后调用，选择第 index 个分支。
        public void Choose(int index)
        {
            var node = Current();
            if (node == null || node.type != "choice" || node.choices == null) return;
            if (index < 0 || index >= node.choices.Length) return;

            var c = node.choices[index];
            ApplyEffects(c.effects);
            _current = c.next;
            Resolve();
        }

        StoryNode Current()
        {
            if (string.IsNullOrEmpty(_current)) return null;
            return _nodes.TryGetValue(_current, out var n) ? n : null;
        }

        // 自动跳过不可见节点（set / condition），直到遇到可见节点或结束。
        void Resolve()
        {
            while (true)
            {
                var node = Current();
                if (node == null) { OnEnd?.Invoke(string.Empty); return; }

                switch (node.type)
                {
                    case "dialogue":
                        OnDialogue?.Invoke(node.speaker, node.text);
                        return;
                    case "choice":
                        OnChoice?.Invoke(node.prompt, node.choices ?? Array.Empty<StoryChoice>());
                        return;
                    case "condition":
                        _current = EvalCondition(node) ? node.whenTrue : node.whenFalse;
                        continue;
                    case "set":
                        ApplyEffects(node.assignments);
                        _current = node.next;
                        continue;
                    case "end":
                        OnEnd?.Invoke(node.ending);
                        return;
                    default:
                        return;
                }
            }
        }

        void ApplyEffects(StoryEffect[] effects)
        {
            if (effects == null) return;
            foreach (var e in effects)
            {
                if (e == null || string.IsNullOrEmpty(e.variable)) continue;
                var type = _varType.TryGetValue(e.variable, out var t) ? t : "number";

                if (type == "number")
                {
                    double cur = ToNumber(_state.TryGetValue(e.variable, out var cv) ? cv : 0);
                    double val = ParseNumber(e.value);
                    if (e.op == "add") cur += val;
                    else if (e.op == "sub") cur -= val;
                    else cur = val; // set
                    _state[e.variable] = cur;
                }
                else
                {
                    _state[e.variable] = Coerce(type, e.value); // boolean / string 直接赋值
                }
            }
        }

        bool EvalCondition(StoryNode node)
        {
            if (node.clauses == null || node.clauses.Length == 0) return true;
            bool allTrue = true, anyTrue = false;
            foreach (var c in node.clauses)
            {
                bool ok = EvalClause(c);
                allTrue &= ok;
                anyTrue |= ok;
            }
            switch (node.match)
            {
                case "any":  return anyTrue;        // OR
                case "nand": return !allTrue;       // NAND：并非全部满足
                case "nor":  return !anyTrue;       // NOR：全部都不满足
                case "all":
                default:     return allTrue;        // AND
            }
        }

        bool EvalClause(StoryClause c)
        {
            if (c == null || string.IsNullOrEmpty(c.variable)) return false;
            var type = _varType.TryGetValue(c.variable, out var t) ? t : "number";
            object cur = _state.TryGetValue(c.variable, out var cv) ? cv : null;

            if (type == "number")
            {
                double a = ToNumber(cur), b = ParseNumber(c.value);
                switch (c.op)
                {
                    case "==": return a == b;
                    case "!=": return a != b;
                    case ">":  return a > b;
                    case ">=": return a >= b;
                    case "<":  return a < b;
                    case "<=": return a <= b;
                    default:   return false;
                }
            }

            // boolean / string 一律按字符串比较
            string sa = (cur ?? string.Empty).ToString();
            string sb = (Coerce(type, c.value) ?? string.Empty).ToString();
            if (c.op == "==") return sa == sb;
            if (c.op == "!=") return sa != sb;
            return false;
        }

        static object Coerce(string type, string raw)
        {
            if (type == "number") return ParseNumber(raw);
            if (type == "boolean") return raw == "true" || raw == "1" || raw == "True";
            return raw ?? string.Empty;
        }

        static double ParseNumber(string raw)
        {
            return double.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var n) ? n : 0;
        }

        static double ToNumber(object o)
        {
            if (o is double d) return d;
            if (o is int i) return i;
            if (o is bool b) return b ? 1 : 0;
            return ParseNumber(o?.ToString());
        }
    }
}
