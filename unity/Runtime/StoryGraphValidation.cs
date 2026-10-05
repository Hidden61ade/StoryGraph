using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace StoryGraph
{
    public sealed class StoryGraphValidationException : FormatException
    {
        public StoryGraphValidationException(string message) : base(message) { }
    }

    public static class StoryGraphValidation
    {
        private static readonly Regex DecimalNumber = new Regex(
            @"\A[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\z",
            RegexOptions.CultureInvariant);

        public static object ParseValue(string type, string value)
        {
            if (type == "number")
            {
                double number;
                if (value == null || !DecimalNumber.IsMatch(value)
                    || !double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out number)
                    || double.IsNaN(number) || double.IsInfinity(number))
                    throw new StoryGraphValidationException("Expected a finite decimal number; received '" + value + "'.");
                return number;
            }
            if (type == "boolean")
            {
                if (value == "true" || value == "1") return true;
                if (value == "false" || value == "0") return false;
                throw new StoryGraphValidationException("Expected true, false, 1 or 0 without whitespace; received '" + value + "'.");
            }
            if (type == "string")
            {
                if (value == null) throw new StoryGraphValidationException("A string value cannot be null.");
                return value;
            }
            throw new StoryGraphValidationException("Unknown variable type '" + type + "'.");
        }

        public static void Validate(StoryGraphData data)
        {
            if (data == null) throw new StoryGraphValidationException("Story data is missing.");
            if (data.variables == null || data.nodes == null)
                throw new StoryGraphValidationException("Story variables and nodes must be arrays.");
            var variables = new Dictionary<string, StoryVar>(StringComparer.Ordinal);
            foreach (StoryVar variable in data.variables)
            {
                if (variable == null || string.IsNullOrWhiteSpace(variable.name))
                    throw new StoryGraphValidationException("Every variable needs a nonempty name.");
                if (variables.ContainsKey(variable.name))
                    throw new StoryGraphValidationException("Duplicate variable name '" + variable.name + "'.");
                ParseValue(variable.type, variable.value);
                variables.Add(variable.name, variable);
            }
            var nodes = new Dictionary<string, StoryNode>(StringComparer.Ordinal);
            foreach (StoryNode node in data.nodes)
            {
                if (node == null || string.IsNullOrWhiteSpace(node.id))
                    throw new StoryGraphValidationException("Every node needs a nonempty ID.");
                if (nodes.ContainsKey(node.id)) throw new StoryGraphValidationException("Duplicate node ID '" + node.id + "'.");
                nodes.Add(node.id, node);
            }
            RequireTarget(data.start, nodes, "Story entry");
            foreach (StoryNode node in data.nodes)
            {
                string context = "Node '" + node.id + "'";
                switch (node.type)
                {
                    case "dialogue":
                        RequireTarget(node.next, nodes, context + " output");
                        break;
                    case "choice":
                        if (node.choices == null || node.choices.Length == 0)
                            throw new StoryGraphValidationException(context + " has no choices.");
                        foreach (StoryChoice choice in node.choices)
                        {
                            if (choice == null) throw new StoryGraphValidationException(context + " contains a missing choice.");
                            RequireTarget(choice.next, nodes, context + " choice output");
                            ValidateEffects(choice.effects, variables, context);
                        }
                        break;
                    case "condition":
                        if (node.match != "all" && node.match != "any" && node.match != "nand" && node.match != "nor")
                            throw new StoryGraphValidationException(context + " has unknown matching mode '" + node.match + "'.");
                        RequireTarget(node.whenTrue, nodes, context + " true output");
                        RequireTarget(node.whenFalse, nodes, context + " false output");
                        foreach (StoryClause clause in node.clauses ?? Array.Empty<StoryClause>())
                        {
                            if (clause == null) throw new StoryGraphValidationException(context + " contains a missing clause.");
                            StoryVar variable = RequireVariable(clause.variable, variables, context);
                            bool equality = clause.op == "==" || clause.op == "!=";
                            bool numerical = clause.op == ">" || clause.op == ">=" || clause.op == "<" || clause.op == "<=";
                            if (!equality && !(variable.type == "number" && numerical))
                                throw new StoryGraphValidationException(context + " has invalid comparison '" + clause.op + "' for " + variable.type + ".");
                            ParseValue(variable.type, clause.value);
                        }
                        break;
                    case "set":
                        RequireTarget(node.next, nodes, context + " output");
                        ValidateEffects(node.assignments, variables, context);
                        break;
                    case "end":
                        break;
                    default:
                        throw new StoryGraphValidationException(context + " has unsupported runtime type '" + node.type + "'.");
                }
            }
        }

        private static void ValidateEffects(StoryEffect[] effects, Dictionary<string, StoryVar> variables, string context)
        {
            foreach (StoryEffect effect in effects ?? Array.Empty<StoryEffect>())
            {
                if (effect == null) throw new StoryGraphValidationException(context + " contains a missing assignment.");
                StoryVar variable = RequireVariable(effect.variable, variables, context);
                if (effect.op != "set" && !(variable.type == "number" && (effect.op == "add" || effect.op == "sub")))
                    throw new StoryGraphValidationException(context + " has invalid assignment '" + effect.op + "' for " + variable.type + ".");
                ParseValue(variable.type, effect.value);
            }
        }

        private static StoryVar RequireVariable(string name, Dictionary<string, StoryVar> variables, string context)
        {
            StoryVar variable;
            if (name == null || !variables.TryGetValue(name, out variable))
                throw new StoryGraphValidationException(context + " references unknown variable '" + name + "'.");
            return variable;
        }

        private static void RequireTarget(string target, Dictionary<string, StoryNode> nodes, string context)
        {
            if (string.IsNullOrEmpty(target) || !nodes.ContainsKey(target))
                throw new StoryGraphValidationException(context + " references missing target '" + target + "'.");
        }
    }
}
