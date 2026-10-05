// Prompt templates for the optional AI plugin. `memory` is the full project context.
const baseSystem = (memory) =>
  `You are a game narrative design assistant working on an interactive story. ` +
  `The project’s character and world notes follow. Keep all output consistent with ` +
  `these characters, their voices, and the world:\n\n${memory}\n\n` +
  `Write in English only. Do not explain your reasoning or add introductions or headings.`;

/** Rewrite a line in the selected character’s voice. */
export function polishMessages(memory, speaker, text) {
  return [
    { role: 'system', content: baseSystem(memory) },
    {
      role: 'user',
      content:
        `Polish the following line in the voice of ${speaker || 'Narrator'}, matching the character and story tone.\n` +
        `Return only the rewritten line, without quotation marks or commentary.\n\nOriginal: ${text || '(empty)'}`,
    },
  ];
}

/** Suggest the next line of dialogue. */
export function continueMessages(memory, speaker, text) {
  return [
    { role: 'system', content: baseSystem(memory) },
    {
      role: 'user',
      content:
        `Current dialogue:\n${speaker || 'Narrator'}: ${text || '(empty)'}\n\n` +
        `Write the immediately following dialogue line, spoken by the same character or a plausible conversation partner.\n` +
        `Return one line in the format Speaker|Dialogue. Example: George|Some answers are hidden in the lyrics.`,
    },
  ];
}

/** Suggest options for a Choice node. */
export function branchMessages(memory, prompt, existing) {
  return [
    { role: 'system', content: baseSystem(memory) },
    {
      role: 'user',
      content:
        `The story has reached a player choice.\n` +
        `Scene or prompt: ${prompt || '(none)'}\n` +
        (existing?.length ? `Existing options: ${existing.map((o) => o.text).join(' / ')}\n` : '') +
        `Suggest three new, distinct player options that fit this story.\n` +
        `Return only a JSON object in this format: {"options":["Option 1","Option 2","Option 3"]}.`,
    },
  ];
}

/** Review dialogue for character and world consistency. */
export function consistencyMessages(memory, lines) {
  const script = lines.map((l, i) => `${i + 1}. ${l.speaker || 'Narrator'}: ${l.text}`).join('\n');
  return [
    { role: 'system', content: baseSystem(memory) },
    {
      role: 'user',
      content:
        `Review the following dialogue, listed by node, for inconsistent character voices, ` +
        `conflicts with the world notes, and contradictions between lines. Identify affected ` +
        `entries and suggest brief revisions.\n` +
        `If you find no clear problems, say “No clear issues found.” Use concise English bullet points.\n\n${script}`,
    },
  ];
}
