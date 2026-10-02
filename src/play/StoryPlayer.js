// 浏览器内的剧情解释器：在「预览」模式下逐步播放剧情。
// 语义与 Unity 运行时 (unity/StoryGraphPlayer.cs) 保持一致，做到「预览所见 == 引擎所得」。
// 输入是 exporters.toEngineJSON(model) 的产物（已做类型归一），所以这里只管按图执行。

export class StoryPlayer {
  constructor(compiled) {
    this.data = compiled || {};
    this.nodes = this.data.nodes || {};
    this.vars = { ...(this.data.variables || {}) };
    this.current = this.data.start || null;
  }

  /** 重新从入口开始。 */
  begin() {
    this.vars = { ...(this.data.variables || {}) };
    this.current = this.data.start || null;
    return this.resolve();
  }

  /** 自动跳过不可见节点（条件/赋值），停在下一个可见节点（对话/选择/结局）。 */
  resolve() {
    let guard = 0;
    while (this.current && guard++ < 100000) {
      const node = this.nodes[this.current];
      if (!node) return { kind: 'end', ending: '' };
      switch (node.type) {
        case 'dialogue':
          return { kind: 'dialogue', speaker: node.speaker || '', text: node.text || '' };
        case 'choice':
          return { kind: 'choice', prompt: node.prompt || '', choices: node.choices || [] };
        case 'condition':
          this.current = this._evalCondition(node) ? node.whenTrue : node.whenFalse;
          break;
        case 'set':
          this._applyEffects(node.assignments);
          this.current = node.next;
          break;
        case 'end':
          return { kind: 'end', ending: node.ending || '' };
        default:
          return { kind: 'end', ending: '' };
      }
    }
    return { kind: 'end', ending: '' };
  }

  /** 处理完一条对话后调用，前进到下一步。 */
  next() {
    const node = this.nodes[this.current];
    if (node && node.type === 'dialogue') this.current = node.next;
    return this.resolve();
  }

  /** 处理完一组选项后调用，选择第 index 个分支。 */
  choose(index) {
    const node = this.nodes[this.current];
    if (!node || node.type !== 'choice') return this.resolve();
    const c = (node.choices || [])[index];
    if (!c) return this.resolve();
    this._applyEffects(c.effects);
    this.current = c.next;
    return this.resolve();
  }

  _applyEffects(effects) {
    for (const e of effects || []) {
      if (!e || !e.var) continue;
      if (e.op === 'add' || e.op === 'sub') {
        const base = Number(this.vars[e.var]) || 0;
        const val = Number(e.value) || 0;
        this.vars[e.var] = e.op === 'add' ? base + val : base - val;
      } else {
        this.vars[e.var] = e.value; // set
      }
    }
  }

  _evalCondition(node) {
    const clauses = node.clauses || [];
    if (!clauses.length) return true;
    let allTrue = true, anyTrue = false;
    for (const c of clauses) {
      const ok = this._evalClause(c);
      allTrue = allTrue && ok;
      anyTrue = anyTrue || ok;
    }
    switch (node.match) {
      case 'any': return anyTrue;     // 或 OR
      case 'nand': return !allTrue;   // 与非 NAND
      case 'nor': return !anyTrue;    // 或非 NOR
      case 'all':
      default: return allTrue;        // 且 AND
    }
  }

  _evalClause(c) {
    const a = this.vars[c.var];
    const b = c.value;
    switch (c.op) {
      case '==': return a == b; // eslint-disable-line eqeqeq
      case '!=': return a != b; // eslint-disable-line eqeqeq
      case '>': return Number(a) > Number(b);
      case '>=': return Number(a) >= Number(b);
      case '<': return Number(a) < Number(b);
      case '<=': return Number(a) <= Number(b);
      default: return false;
    }
  }
}
