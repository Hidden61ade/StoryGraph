using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace StoryGraph.Editor
{
    public static class StoryGraphCompiler
    {
        private static readonly HashSet<string> SupportedTypes = new HashSet<string>(StringComparer.Ordinal)
        { "start", "dialogue", "choice", "condition", "setvar", "end", "note" };

        public static StoryGraphData Compile(string rawProjectJson)
        {
            JObject project;
            try
            {
                if (rawProjectJson == null) throw new ArgumentNullException(nameof(rawProjectJson));
                using (var text = new StringReader(rawProjectJson))
                using (var reader = new JsonTextReader(text) { DateParseHandling = DateParseHandling.None })
                {
                    project = JObject.Load(reader, new JsonLoadSettings
                    { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
                    while (reader.Read())
                        if (reader.TokenType != JsonToken.Comment)
                            throw new JsonReaderException("Unexpected content after the project object.");
                }
            }
            catch (Exception error) when (error is JsonException || error is ArgumentException)
            {
                throw new StoryGraphValidationException("Invalid .sg JSON: " + error.Message);
            }

            var variables = new List<StoryVar>();
            var variableTypes = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (JToken token in RequiredArray(project, "variables", "Project"))
            {
                JObject entry = RequiredObject(token, "Variable");
                string name = RequiredString(entry, "name", "Variable");
                if (variableTypes.ContainsKey(name)) Fail("Duplicate variable name '" + name + "'.");
                string type = RequiredString(entry, "type", "Variable '" + name + "'");
                string initial = TypedValue(entry["initial"], type, "Initial value of '" + name + "'");
                variableTypes.Add(name, type);
                variables.Add(new StoryVar { name = name, type = type, value = initial });
            }

            var sourceNodes = new Dictionary<string, JObject>(StringComparer.Ordinal);
            var nodeTypes = new Dictionary<string, string>(StringComparer.Ordinal);
            var nodeOrder = new List<string>();
            var ports = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            string startNode = null;
            int starts = 0;
            foreach (JToken token in RequiredArray(project, "nodes", "Project"))
            {
                JObject node = RequiredObject(token, "Node");
                string id = RequiredString(node, "id", "Node");
                if (sourceNodes.ContainsKey(id)) Fail("Duplicate node ID '" + id + "'.");
                string type = RequiredString(node, "type", "Node '" + id + "'");
                if (!SupportedTypes.Contains(type)) Fail("Node '" + id + "' uses unsupported type '" + type + "'. Custom plugin nodes need an explicit Unity adapter.");
                JObject nodeData = NodeData(node, id);
                var outputs = new HashSet<string>(StringComparer.Ordinal);
                switch (type)
                {
                    case "start": starts++; startNode = id; outputs.Add("out"); break;
                    case "dialogue":
                    case "setvar": outputs.Add("out"); break;
                    case "condition": outputs.Add("true"); outputs.Add("false"); break;
                    case "choice":
                        JArray options = RequiredArray(nodeData, "options", "Choice '" + id + "'");
                        if (options.Count == 0) Fail("Choice '" + id + "' has no options.");
                        foreach (JToken optionToken in options)
                        {
                            JObject option = RequiredObject(optionToken, "Choice option");
                            string optionId = RequiredString(option, "id", "Choice '" + id + "' option");
                            if (!outputs.Add(optionId)) Fail("Choice '" + id + "' has duplicate option ID '" + optionId + "'.");
                        }
                        break;
                }
                sourceNodes.Add(id, node);
                nodeTypes.Add(id, type);
                nodeOrder.Add(id);
                ports.Add(id, outputs);
            }
            if (starts != 1) Fail("A .sg project must contain exactly one start node; found " + starts + ".");

            var connections = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            foreach (string id in nodeOrder) connections.Add(id, new Dictionary<string, string>(StringComparer.Ordinal));
            var edgeIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (JToken token in RequiredArray(project, "edges", "Project"))
            {
                JObject edge = RequiredObject(token, "Edge");
                string edgeId = RequiredString(edge, "id", "Edge");
                if (!edgeIds.Add(edgeId)) Fail("Duplicate edge ID '" + edgeId + "'.");
                string source = RequiredString(edge, "source", "Edge '" + edgeId + "'");
                string port = RequiredString(edge, "sourcePort", "Edge '" + edgeId + "'");
                string target = RequiredString(edge, "target", "Edge '" + edgeId + "'");
                if (!sourceNodes.ContainsKey(source)) Fail("Edge '" + edgeId + "' has unknown source '" + source + "'.");
                if (!sourceNodes.ContainsKey(target)) Fail("Edge '" + edgeId + "' has unknown target '" + target + "'.");
                if (!ports[source].Contains(port)) Fail("Edge '" + edgeId + "' uses unknown output '" + port + "' on node '" + source + "'.");
                if (nodeTypes[target] == "start" || nodeTypes[target] == "note") Fail("Edge '" + edgeId + "' targets a non-runnable " + nodeTypes[target] + " node.");
                if (connections[source].ContainsKey(port)) Fail("Node '" + source + "' has multiple edges on output '" + port + "'.");
                connections[source].Add(port, target);
            }
            foreach (string id in nodeOrder)
                foreach (string port in ports[id])
                    if (!connections[id].ContainsKey(port)) Fail("Node '" + id + "' has an unconnected output '" + port + "'.");

            var runtimeNodes = new List<StoryNode>();
            foreach (string id in nodeOrder)
            {
                string type = nodeTypes[id];
                if (type == "start" || type == "note") continue;
                JObject entry = NodeData(sourceNodes[id], id);
                var node = new StoryNode { id = id, type = type == "setvar" ? "set" : type };
                switch (type)
                {
                    case "dialogue":
                        node.speaker = OptionalString(entry, "speaker", "");
                        node.text = OptionalString(entry, "text", "");
                        node.next = connections[id]["out"];
                        break;
                    case "choice":
                        node.prompt = OptionalString(entry, "prompt", "");
                        var choices = new List<StoryChoice>();
                        foreach (JToken optionToken in RequiredArray(entry, "options", "Choice '" + id + "'"))
                        {
                            JObject option = RequiredObject(optionToken, "Choice option");
                            choices.Add(new StoryChoice
                            {
                                text = OptionalString(option, "text", ""),
                                next = connections[id][RequiredString(option, "id", "Choice option")],
                                effects = Effects(option, "effects", variableTypes, "Choice '" + id + "'")
                            });
                        }
                        node.choices = choices.ToArray();
                        break;
                    case "condition":
                        node.match = OptionalString(entry, "match", "all");
                        node.whenTrue = connections[id]["true"];
                        node.whenFalse = connections[id]["false"];
                        var clauses = new List<StoryClause>();
                        foreach (JToken clauseToken in OptionalArray(entry, "clauses", "Condition '" + id + "'"))
                        {
                            JObject clause = RequiredObject(clauseToken, "Condition clause");
                            string variable = RequiredString(clause, "var", "Condition '" + id + "'");
                            string variableType = VariableType(variableTypes, variable, id);
                            clauses.Add(new StoryClause
                            {
                                variable = variable,
                                op = RequiredString(clause, "op", "Condition '" + id + "'"),
                                value = TypedValue(clause["value"], variableType, "Condition '" + id + "'")
                            });
                        }
                        node.clauses = clauses.ToArray();
                        break;
                    case "setvar":
                        node.next = connections[id]["out"];
                        node.assignments = Effects(entry, "assignments", variableTypes, "Assignment '" + id + "'");
                        break;
                    case "end": node.ending = OptionalString(entry, "ending", OptionalString(entry, "label", "")); break;
                }
                runtimeNodes.Add(node);
            }

            JObject meta = project["meta"] == null ? new JObject() : RequiredObject(project["meta"], "Project metadata");
            var data = new StoryGraphData
            {
                name = OptionalString(meta, "name", "Untitled story"),
                start = connections[startNode]["out"],
                variables = variables.ToArray(),
                nodes = runtimeNodes.ToArray()
            };
            StoryGraphValidation.Validate(data);
            return data;
        }

        private static StoryEffect[] Effects(JObject owner, string key, Dictionary<string, string> types, string context)
        {
            var effects = new List<StoryEffect>();
            foreach (JToken token in OptionalArray(owner, key, context))
            {
                JObject effect = RequiredObject(token, context + " effect");
                string variable = RequiredString(effect, "var", context);
                string type = VariableType(types, variable, context);
                effects.Add(new StoryEffect
                {
                    variable = variable,
                    op = RequiredString(effect, "op", context),
                    value = TypedValue(effect["value"], type, context)
                });
            }
            return effects.ToArray();
        }

        private static string VariableType(Dictionary<string, string> types, string name, string context)
        {
            string type;
            if (!types.TryGetValue(name, out type)) Fail(context + " references unknown variable '" + name + "'.");
            return type;
        }

        private static string TypedValue(JToken value, string type, string context)
        {
            if (value == null || value.Type == JTokenType.Null) Fail(context + " has a missing or null value.");
            string raw;
            if (type == "string")
            {
                if (value.Type != JTokenType.String) Fail(context + " expects a JSON string.");
                raw = (string)value;
            }
            else if (type == "boolean")
            {
                if (value.Type == JTokenType.Boolean) raw = (bool)value ? "true" : "false";
                else if (value.Type == JTokenType.String) raw = (string)value;
                else { Fail(context + " expects a JSON boolean or true/false/1/0 string."); raw = null; }
            }
            else if (type == "number")
            {
                if (value.Type == JTokenType.String) raw = (string)value;
                else if (value.Type == JTokenType.Integer || value.Type == JTokenType.Float)
                    raw = value.ToString(Formatting.None);
                else { Fail(context + " expects a JSON number or decimal string."); raw = null; }
            }
            else { Fail(context + " has unknown variable type '" + type + "'."); raw = null; }
            StoryGraphValidation.ParseValue(type, raw);
            return raw;
        }

        private static JObject NodeData(JObject node, string id)
        {
            return node["data"] == null ? new JObject() : RequiredObject(node["data"], "Data of node '" + id + "'");
        }

        private static JObject RequiredObject(JToken token, string context)
        {
            JObject result = token as JObject;
            if (result == null) Fail(context + " must be an object.");
            return result;
        }

        private static JArray RequiredArray(JObject owner, string key, string context)
        {
            JArray result = owner[key] as JArray;
            if (result == null) Fail(context + " field '" + key + "' must be an array.");
            return result;
        }

        private static JArray OptionalArray(JObject owner, string key, string context)
        {
            return owner[key] == null ? new JArray() : RequiredArray(owner, key, context);
        }

        private static string RequiredString(JObject owner, string key, string context)
        {
            JToken value = owner[key];
            if (value == null || value.Type != JTokenType.String || string.IsNullOrWhiteSpace((string)value))
                Fail(context + " field '" + key + "' must be a nonempty string.");
            return (string)value;
        }

        private static string OptionalString(JObject owner, string key, string fallback)
        {
            if (owner[key] == null) return fallback;
            if (owner[key].Type != JTokenType.String) Fail("Field '" + key + "' must be a string.");
            return (string)owner[key];
        }

        private static void Fail(string message)
        {
            throw new StoryGraphValidationException(message);
        }
    }
}
