// 浏览器内的剧情解释器：在「预览」模式下逐步播放剧情。
// Core node semantics are tested against the Unity integration with shared fixtures.
// 输入是 exporters.toEngineJSON(model) 的产物（已做类型归一），所以这里只管按图执行。

import { MAX_AUTOMATIC_STEPS } from '../core/runtimeContract.js';

export class StoryPlayer {
  constructor(compiled) {
    this.data = structuredClone(compiled || {});
    this.nodes = this.data.nodes || {};
    this.vars = { ...(this.data.variables || {}) };
    this.current = this.data.start || null;
    this.isFaulted = false;
  }

  /** 重新从入口开始。 */
  begin() {
    this.vars = { ...(this.data.variables || {}) };
    this.ending = '';
    this.current = this.data.start || null;
    this.isFaulted = false;
    return this._execute(() => this._resolve());
  }

  /** 自动跳过不可见节点（条件/赋值），停在下一个可见节点（对话/选择/结局）。 */
  resolve() {
    return this._execute(() => this._resolve());
  }

  _resolve() {
    let guard = 0;
    while (this.current) {
      const node = this.nodes[this.current];
      if (!node) throw new Error(`Missing runtime node ${this.current}.`);
      if (['condition', 'set'].includes(node.type) && ++guard > MAX_AUTOMATIC_STEPS) throw new Error('StoryGraph exceeded 10000 automatic steps. Check condition/assignment loops.');
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
          this.current = null;
          this.ending = node.ending || '';
          return { kind: 'end', ending: this.ending };
        default:
          throw new Error(`Unsupported runtime node ${node.type}.`);
      }
    }
    return { kind: 'end', ending: this.ending || '' };
  }

  /** 处理完一条对话后调用，前进到下一步。 */
  next() {
    return this._execute(() => {
      const node = this.nodes[this.current];
      if (node && node.type === 'dialogue') this.current = node.next;
      return this._resolve();
    });
  }

  /** 处理完一组选项后调用，选择第 index 个分支。 */
  choose(index) {
    return this._execute(() => {
      const node = this.nodes[this.current];
      if (!node || node.type !== 'choice') return this._resolve();
      const c = (node.choices || [])[index];
      if (!c) return this._resolve();
      this._applyEffects(c.effects);
      this.current = c.next;
      return this._resolve();
    });
  }

  _execute(action) {
    if (this.isFaulted) throw new Error('StoryGraph session is faulted. Call begin() to restart.');
    try {
      return action();
    } catch (error) {
      this.isFaulted = true;
      this.current = null;
      throw error;
    }
  }

  _applyEffects(effects) {
    const staged = { ...this.vars };
    for (const e of effects || []) {
      if (!e || !Object.hasOwn(staged, e.var)) throw new Error(`Undefined variable ${e?.var}.`);
      const base = staged[e.var];
      if (typeof base !== typeof e.value) throw new Error(`Invalid value type for ${e.var}.`);
      if (!['number', 'boolean', 'string'].includes(typeof base)) throw new Error(`Invalid variable type for ${e.var}.`);
      if (typeof base === 'number' && (!Number.isFinite(base) || !Number.isFinite(e.value))) throw new Error(`Invalid number for ${e.var}.`);
      if (e.op === 'add' || e.op === 'sub') {
        if (typeof base !== 'number') throw new Error(`Only numbers support ${e.op}.`);
        const val = e.value;
        if (!Number.isFinite(e.op === 'add' ? base + val : base - val)) throw new Error(`Number overflow for ${e.var}.`);
        staged[e.var] = e.op === 'add' ? base + val : base - val;
      } else if (e.op === 'set') {
        staged[e.var] = e.value; // set
      } else throw new Error(`Unknown assignment operator ${e.op}.`);
    }
    this.vars = staged;
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
      case 'all': return allTrue;        // 且 AND
      default: throw new Error(`Unknown condition mode ${node.match}.`);
    }
  }

  _evalClause(c) {
    const a = this.vars[c.var];
    const b = c.value;
    if (!Object.hasOwn(this.vars, c.var)) throw new Error(`Undefined variable ${c.var}.`);
    if (typeof a !== typeof b) throw new Error(`Invalid comparison type for ${c.var}.`);
    if (!['==', '!='].includes(c.op) && typeof a !== 'number') throw new Error(`Only numbers support ${c.op}.`);
    switch (c.op) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '>': return Number(a) > Number(b);
      case '>=': return Number(a) >= Number(b);
      case '<': return Number(a) < Number(b);
      case '<=': return Number(a) <= Number(b);
      default: throw new Error(`Unknown comparison operator ${c.op}.`);
    }
  }
}
