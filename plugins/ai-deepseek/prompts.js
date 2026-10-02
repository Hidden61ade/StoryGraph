// 提示词模板（提示词工程层）。把它们集中在一处，便于复用、调参与版本管理。
// 每个函数返回 OpenAI 兼容的 messages 数组。memory 为 MEMORY.md 的全文。

const baseSystem = (memory) =>
  `你是一个游戏叙事设计助手，服务于一款互动剧情游戏。下面是该项目的「角色圣经/世界观设定」，` +
  `你产出的一切内容都必须严格贴合其中的角色性格、语气与世界观：\n\n${memory}\n\n` +
  `要求：只输出中文；不要解释你的思路；不要加多余的客套或标题。`;

/** 用某角色的口吻润色一句对白 */
export function polishMessages(memory, speaker, text) {
  return [
    { role: 'system', content: baseSystem(memory) },
    {
      role: 'user',
      content:
        `请用「${speaker || '旁白'}」的口吻润色下面这句台词，使其更贴合该角色的性格与本作语气。\n` +
        `只输出润色后的台词本身，不要引号、不要任何额外说明。\n\n原台词：${text || '（空）'}`,
    },
  ];
}

/** 为某句对白续写下一句（同一说话人或合理的对话推进） */
export function continueMessages(memory, speaker, text) {
  return [
    { role: 'system', content: baseSystem(memory) },
    {
      role: 'user',
      content:
        `这是当前这句对白：\n「${speaker || '旁白'}」：${text || '（空）'}\n\n` +
        `请续写**紧接着的下一句对白**（可以是同一角色，也可以是合理的对话方）。\n` +
        `只输出一行，格式为：说话人｜台词。例如：George｜有些答案，藏在歌词里。`,
    },
  ];
}

/** 为一个「选择」节点生成若干分支选项 */
export function branchMessages(memory, prompt, existing) {
  return [
    { role: 'system', content: baseSystem(memory) },
    {
      role: 'user',
      content:
        `当前剧情来到一个需要玩家做选择的节点。\n` +
        `场景/提示语：${prompt || '（无）'}\n` +
        (existing?.length ? `已有选项：${existing.map((o) => o.text).join(' / ')}\n` : '') +
        `请生成 3 个新的、互不重复、风格贴合本作的玩家选项。\n` +
        `必须只输出一个 JSON 对象，形如：{"options":["选项一","选项二","选项三"]}。不要任何额外文字。`,
    },
  ];
}

/** 对全篇对白做角色一致性 / 设定矛盾检查 */
export function consistencyMessages(memory, lines) {
  const script = lines.map((l, i) => `${i + 1}. 「${l.speaker || '旁白'}」：${l.text}`).join('\n');
  return [
    { role: 'system', content: baseSystem(memory) },
    {
      role: 'user',
      content:
        `下面是这段剧情中所有对白（按节点列出）。请从「角色口吻是否统一」「是否与世界观/设定冲突」` +
        `「前后是否自相矛盾」三个角度检查，指出存在问题的条目并给出简短修改建议。\n` +
        `若整体没有明显问题，请回答「未发现明显问题」。请用简洁的中文条目列出，不要长篇大论。\n\n${script}`,
    },
  ];
}
