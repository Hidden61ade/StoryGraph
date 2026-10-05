using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace StoryGraph
{
    public class StoryGraphPlayer
    {
        public const int MaxAutomaticSteps = 10000;
        public event Action<string, string> OnDialogue;
        public event Action<string, IReadOnlyList<StoryChoice>> OnChoice;
        public event Action<string> OnEnd;

        private readonly StoryGraphData data;
        private readonly Dictionary<string, StoryNode> nodes = new Dictionary<string, StoryNode>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> variableTypes = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Dictionary<string, object> state = new Dictionary<string, object>(StringComparer.Ordinal);
        private readonly ReadOnlyDictionary<string, object> stateView;
        private string current;
        private bool isFaulted;

        public IReadOnlyDictionary<string, object> Variables => stateView;
        public string CurrentNodeId => current;
        public bool IsFaulted => isFaulted;

        public StoryGraphPlayer(StoryGraphData data)
        {
            if (data == null) throw new ArgumentNullException(nameof(data));
            StoryGraphValidation.Validate(data);
            // A session is a snapshot. Asset reimports cannot mutate a running route.
            this.data = data.Clone();
            foreach (StoryNode node in this.data.nodes) nodes.Add(node.id, node);
            foreach (StoryVar variable in this.data.variables) variableTypes.Add(variable.name, variable.type);
            stateView = new ReadOnlyDictionary<string, object>(state);
            ResetVariables();
        }

        public void Begin()
        {
            isFaulted = false;
            current = null;
            try
            {
                ResetVariables();
                current = data.start;
                Resolve();
            }
            catch
            {
                Fault();
                throw;
            }
        }

        public void Next()
        {
            RequireHealthySession();
            try
            {
                StoryNode node = Current();
                if (node == null || node.type != "dialogue") return;
                current = node.next;
                Resolve();
            }
            catch
            {
                Fault();
                throw;
            }
        }

        public void Choose(int index)
        {
            RequireHealthySession();
            try
            {
                StoryNode node = Current();
                if (node == null || node.type != "choice") return;
                if (index < 0 || index >= node.choices.Length) return;
                StoryChoice choice = node.choices[index];
                ApplyEffects(choice.effects);
                current = choice.next;
                Resolve();
            }
            catch
            {
                Fault();
                throw;
            }
        }

        private void RequireHealthySession()
        {
            if (isFaulted)
                throw new InvalidOperationException("StoryGraph session is faulted. Call Begin() to restart.");
        }

        private void Fault()
        {
            isFaulted = true;
            current = null;
        }

        private void ResetVariables()
        {
            state.Clear();
            foreach (StoryVar variable in data.variables)
                state.Add(variable.name, StoryGraphValidation.ParseValue(variable.type, variable.value));
        }

        private StoryNode Current()
        {
            if (current == null) return null;
            StoryNode node;
            if (!nodes.TryGetValue(current, out node))
                throw new InvalidOperationException("StoryGraph session has missing current node '" + current + "'.");
            return node;
        }

        private void Resolve()
        {
            int automaticSteps = 0;
            while (true)
            {
                StoryNode node = Current();
                if (node == null) return;
                switch (node.type)
                {
                    case "dialogue":
                        OnDialogue?.Invoke(node.speaker ?? string.Empty, node.text ?? string.Empty);
                        return;
                    case "choice":
                        OnChoice?.Invoke(node.prompt ?? string.Empty, Array.AsReadOnly(node.choices));
                        return;
                    case "end":
                        current = null;
                        OnEnd?.Invoke(node.ending ?? string.Empty);
                        return;
                    case "condition":
                    case "set":
                        if (++automaticSteps > MaxAutomaticSteps)
                            throw new InvalidOperationException("StoryGraph exceeded " + MaxAutomaticSteps
                                + " automatic steps at node '" + node.id + "'. Check for a logic cycle.");
                        if (node.type == "condition") current = EvaluateCondition(node) ? node.whenTrue : node.whenFalse;
                        else
                        {
                            ApplyEffects(node.assignments);
                            current = node.next;
                        }
                        break;
                    default:
                        throw new InvalidOperationException("Unsupported runtime node '" + node.type + "'.");
                }
            }
        }

        private void ApplyEffects(StoryEffect[] effects)
        {
            // Sequential effects can depend on earlier effects in the same batch, but
            // a later error must not leave a partially applied choice or assignment.
            var staged = new Dictionary<string, object>(state, StringComparer.Ordinal);
            foreach (StoryEffect effect in effects ?? Array.Empty<StoryEffect>())
            {
                object value = StoryGraphValidation.ParseValue(variableTypes[effect.variable], effect.value);
                if (effect.op == "set") staged[effect.variable] = value;
                else if (effect.op == "add" || effect.op == "sub")
                {
                    double result = effect.op == "add" ? (double)staged[effect.variable] + (double)value
                        : (double)staged[effect.variable] - (double)value;
                    if (double.IsNaN(result) || double.IsInfinity(result))
                        throw new InvalidOperationException("Assignment produced a nonfinite number for '" + effect.variable + "'.");
                    staged[effect.variable] = result;
                }
                else throw new InvalidOperationException("Unknown assignment operator '" + effect.op + "'.");
            }
            foreach (var item in staged) state[item.Key] = item.Value;
        }

        private bool EvaluateCondition(StoryNode node)
        {
            if (node.clauses == null || node.clauses.Length == 0) return true;
            bool all = true;
            bool any = false;
            foreach (StoryClause clause in node.clauses)
            {
                object a = state[clause.variable];
                object b = StoryGraphValidation.ParseValue(variableTypes[clause.variable], clause.value);
                bool result;
                switch (clause.op)
                {
                    case "==": result = Equals(a, b); break;
                    case "!=": result = !Equals(a, b); break;
                    case ">": result = (double)a > (double)b; break;
                    case ">=": result = (double)a >= (double)b; break;
                    case "<": result = (double)a < (double)b; break;
                    case "<=": result = (double)a <= (double)b; break;
                    default: throw new InvalidOperationException("Unknown comparison '" + clause.op + "'.");
                }
                all &= result;
                any |= result;
            }
            switch (node.match)
            {
                case "all": return all;
                case "any": return any;
                case "nand": return !all;
                case "nor": return !any;
                default: throw new InvalidOperationException("Unknown condition match '" + node.match + "'.");
            }
        }
    }
}
