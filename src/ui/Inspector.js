// 右侧检查器：根据当前选中的节点，显示对应的「填空式」表单。
// 设计原则：非技术同学不写代码，只填空、选下拉、点按钮。
import { NODE_TYPES, newOption } from '../core/nodeTypes.js';

const OPERATORS_EFFECT = [
  { v: 'add', t: '增加 (＋)' },
  { v: 'sub', t: '减少 (－)' },
  { v: 'set', t: '设为 (＝)' },
];
const OPERATORS_COND = [
  { v: '>=', t: '大于等于 ≥' },
  { v: '>', t: '大于 >' },
  { v: '<=', t: '小于等于 ≤' },
  { v: '<', t: '小于 <' },
  { v: '==', t: '等于 =' },
  { v: '!=', t: '不等于 ≠' },
];

export class Inspector {
  constructor(model, root) {
    this.model = model;
    this.root = root;
    this.selection = null;
    this.pluginHost = null;
    this.render(null);
  }

  /** 由 main.js 注入；用于在检查器里渲染插件提供的节点动作（如 AI 助手）。 */
  setPluginHost(host) {
    this.pluginHost = host;
    this.render(this.selection);
  }

  render(selection) {
    this.selection = selection;
    const r = this.root;
    if (!selection || selection.type !== 'node') {
      r.innerHTML = `
        <div class="panel__title">属性</div>
        <div class="empty-inspector">
          <div class="empty-inspector__emoji">👈</div>
          <p>选中一个节点即可在这里编辑它的内容。</p>
          <p class="muted">小贴士：双击空白处可平移画布，滚轮缩放。</p>
        </div>`;
      return;
    }
    const node = this.model.nodes.get(selection.id);
    if (!node) { this.render(null); return; }
    const def = NODE_TYPES[node.type];
    r.innerHTML = `
      <div class="panel__title">
        <span class="panel__title-icon" style="color:${def.color}">${def.icon}</span>
        ${def.label}节点
        <button class="icon-btn icon-btn--danger" data-act="delete" title="删除该节点（Delete）">🗑</button>
      </div>
      <div class="panel__hint">${def.desc}</div>
      <div class="inspector__form" id="insForm"></div>`;
    r.querySelector('[data-act="delete"]').addEventListener('click', () => {
      this.model.removeNode(node.id);
    });
    const form = r.querySelector('#insForm');
    this._buildForm(form, node);
    this._renderPluginActions(node);
  }

  /** 渲染插件注册的节点动作（AI 助手等） */
  _renderPluginActions(node) {
    if (!this.pluginHost) return;
    const actions = this.pluginHost.nodeActionsFor(node);
    if (!actions.length) return;
    const sec = document.createElement('div');
    sec.className = 'ai-section';
    const title = document.createElement('div');
    title.className = 'ai-section__title';
    title.textContent = '🤖 AI 助手';
    sec.append(title);
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'ai-btn';
      b.textContent = a.label;
      if (a.title) b.title = a.title;
      b.addEventListener('click', () => {
        try { a.run(node); } catch (err) { console.error('[AI 动作出错]', err); }
      });
      sec.append(b);
    });
    this.root.append(sec);
  }

  _buildForm(form, node) {
    switch (node.type) {
      case 'start':
        form.append(this._textField('入口名称（可选）', node.data.label, (v) => this._set(node, { label: v })));
        break;
      case 'dialogue':
        form.append(
          this._speakerField('说话角色', node.data.speaker, (v) => this._set(node, { speaker: v })),
          this._textareaField('对话内容', node.data.text, (v) => this._set(node, { text: v }))
        );
        break;
      case 'choice':
        form.append(this._textField('提示语（可选，问题/旁白）', node.data.prompt, (v) => this._set(node, { prompt: v })));
        form.append(this._choiceEditor(node));
        break;
      case 'condition':
        form.append(this._conditionEditor(node));
        break;
      case 'setvar':
        form.append(this._assignmentEditor(node));
        break;
      case 'end':
        form.append(
          this._textField('结局名称', node.data.ending, (v) => this._set(node, { ending: v })),
        );
        break;
      case 'note':
        form.append(this._textareaField('便签内容', node.data.text, (v) => this._set(node, { text: v })));
        break;
      default:
        this._buildGenericForm(form, node);
        break;
    }
  }

  // 插件注册的自定义节点：按 def.fields 声明式表单渲染（无需插件写 DOM）。
  _buildGenericForm(form, node) {
    const def = NODE_TYPES[node.type];
    const fields = (def && def.fields) || [];
    if (!fields.length) {
      form.append(hint('该节点暂无可编辑字段。'));
      return;
    }
    for (const f of fields) {
      if (f.type === 'textarea') {
        form.append(this._textareaField(f.label, node.data[f.key], (v) => this._set(node, { [f.key]: v })));
      } else if (f.type === 'select') {
        const wrap = el('div', 'field');
        wrap.append(label(f.label));
        wrap.append(opSelect((f.options || []).map((o) => (typeof o === 'string' ? { v: o, t: o } : o)),
          node.data[f.key], (v) => this._set(node, { [f.key]: v })));
        form.append(wrap);
      } else if (f.type === 'var') {
        const wrap = el('div', 'field');
        wrap.append(label(f.label));
        wrap.append(varSelect(this.model, node.data[f.key], (v) => this._set(node, { [f.key]: v })));
        form.append(wrap);
      } else {
        // text / time / number 统一用输入框（time/number 设置 input 类型）
        const wrap = el('div', 'field');
        wrap.append(label(f.label));
        const inp = input(node.data[f.key], f.placeholder || '', (v) => this._set(node, { [f.key]: v }));
        if (f.type === 'time') inp.type = 'time';
        if (f.type === 'number') inp.type = 'number';
        wrap.append(inp);
        form.append(wrap);
      }
    }
  }

  // —— 选项编辑（选择节点）——
  _choiceEditor(node) {
    const wrap = el('div', 'editor-block');
    wrap.append(label('玩家可选的选项'));
    const list = el('div', 'list');
    (node.data.options || []).forEach((opt, i) => list.append(this._optionRow(node, opt, i)));
    wrap.append(list);
    const add = button('＋ 添加选项', 'add-btn', () => {
      const options = [...(node.data.options || []), newOption('新选项')];
      this._setStructural(node, { options });
    });
    wrap.append(add);
    return wrap;
  }

  _optionRow(node, opt, index) {
    const row = el('div', 'list__item');
    const head = el('div', 'list__head');
    head.append(
      input(opt.text, '选项文字（玩家看到的）', (v) => {
        opt.text = v; this._set(node, { options: node.data.options }, true);
      }, 'input input--grow'),
      iconBtn('🗑', '删除该选项', () => {
        const options = node.data.options.filter((_, i) => i !== index);
        this._setStructural(node, { options });
      })
    );
    row.append(head);

    // 该选项的好感度/变量效果
    const effWrap = el('div', 'sub-list');
    (opt.effects || []).forEach((eff, ei) => effWrap.append(this._effectRow(node, opt, eff, ei)));
    const addEff = button('＋ 添加效果（如好感度+1）', 'add-btn add-btn--sm', () => {
      opt.effects = [...(opt.effects || []), { var: this._firstVar(), op: 'add', value: '1' }];
      this._setStructural(node, { options: node.data.options });
    });
    effWrap.append(addEff);
    row.append(effWrap);
    return row;
  }

  _effectRow(node, opt, eff, index) {
    const row = el('div', 'effect-row');
    row.append(
      varSelect(this.model, eff.var, (v) => { eff.var = v; this._set(node, { options: node.data.options }); }),
      opSelect(OPERATORS_EFFECT, eff.op, (v) => { eff.op = v; this._set(node, { options: node.data.options }); }),
      input(eff.value, '值', (v) => { eff.value = v; this._set(node, { options: node.data.options }); }, 'input input--num'),
      iconBtn('✕', '删除效果', () => {
        opt.effects = opt.effects.filter((_, i) => i !== index);
        this._setStructural(node, { options: node.data.options });
      })
    );
    return row;
  }

  // —— 条件编辑 ——
  _conditionEditor(node) {
    const wrap = el('div', 'editor-block');
    const matchRow = el('div', 'field');
    matchRow.append(label('满足方式'));
    matchRow.append(opSelect(
      [
        { v: 'all', t: '满足全部条件（且 AND）' },
        { v: 'any', t: '满足任一条件（或 OR）' },
        { v: 'nand', t: '并非全部满足（与非 NAND）' },
        { v: 'nor', t: '全部都不满足（或非 NOR）' },
      ],
      node.data.match, (v) => this._set(node, { match: v })
    ));
    wrap.append(matchRow);

    wrap.append(label('条件'));
    const list = el('div', 'list');
    (node.data.clauses || []).forEach((c, i) => list.append(this._clauseRow(node, c, i)));
    wrap.append(list);
    wrap.append(button('＋ 添加条件', 'add-btn', () => {
      const clauses = [...(node.data.clauses || []), { var: this._firstVar(), op: '>=', value: '0' }];
      this._setStructural(node, { clauses });
    }));
    wrap.append(hint('「是」走绿色端口，「否」走红色端口。'));
    return wrap;
  }

  _clauseRow(node, clause, index) {
    const row = el('div', 'effect-row');
    row.append(
      varSelect(this.model, clause.var, (v) => { clause.var = v; this._set(node, { clauses: node.data.clauses }); }),
      opSelect(OPERATORS_COND, clause.op, (v) => { clause.op = v; this._set(node, { clauses: node.data.clauses }); }),
      input(clause.value, '值', (v) => { clause.value = v; this._set(node, { clauses: node.data.clauses }); }, 'input input--num'),
      iconBtn('✕', '删除条件', () => {
        const clauses = node.data.clauses.filter((_, i) => i !== index);
        this._setStructural(node, { clauses });
      })
    );
    return row;
  }

  // —— 赋值编辑 ——
  _assignmentEditor(node) {
    const wrap = el('div', 'editor-block');
    wrap.append(label('要修改的变量'));
    const list = el('div', 'list');
    (node.data.assignments || []).forEach((a, i) => list.append(this._assignRow(node, a, i)));
    wrap.append(list);
    wrap.append(button('＋ 添加一条修改', 'add-btn', () => {
      const assignments = [...(node.data.assignments || []), { var: this._firstVar(), op: 'add', value: '1' }];
      this._setStructural(node, { assignments });
    }));
    return wrap;
  }

  _assignRow(node, a, index) {
    const row = el('div', 'effect-row');
    row.append(
      varSelect(this.model, a.var, (v) => { a.var = v; this._set(node, { assignments: node.data.assignments }); }),
      opSelect(OPERATORS_EFFECT, a.op, (v) => { a.op = v; this._set(node, { assignments: node.data.assignments }); }),
      input(a.value, '值', (v) => { a.value = v; this._set(node, { assignments: node.data.assignments }); }, 'input input--num'),
      iconBtn('✕', '删除', () => {
        const assignments = node.data.assignments.filter((_, i) => i !== index);
        this._setStructural(node, { assignments });
      })
    );
    return row;
  }

  // —— 通用字段 ——
  _textField(labelText, value, onChange) {
    const f = el('div', 'field');
    f.append(label(labelText));
    f.append(input(value, '', onChange));
    return f;
  }
  _textareaField(labelText, value, onChange) {
    const f = el('div', 'field');
    f.append(label(labelText));
    const ta = document.createElement('textarea');
    ta.className = 'textarea';
    ta.value = value || '';
    ta.rows = 4;
    ta.addEventListener('input', () => onChange(ta.value));
    f.append(ta);
    return f;
  }
  _speakerField(labelText, value, onChange) {
    const f = el('div', 'field');
    f.append(label(labelText));
    const inp = input(value, '如：Adam、Lizz、旁白', onChange);
    inp.setAttribute('list', 'speakerList');
    // 收集已有说话人作为建议
    const dl = document.getElementById('speakerList') || createDatalist();
    const names = new Set([...this.model.nodes.values()].filter((n) => n.type === 'dialogue' && n.data.speaker).map((n) => n.data.speaker));
    dl.innerHTML = [...names].map((n) => `<option value="${n}">`).join('');
    f.append(inp);
    return f;
  }

  // 写回模型；structural=true 时表示端口变化，需要重建检查器+画布节点
  _set(node, patch, _silentInspector) {
    this.model.updateNodeData(node.id, patch, false);
  }
  _setStructural(node, patch) {
    this.model.updateNodeData(node.id, patch, true);
    this.render(this.selection); // 重建表单以显示新增/删除的行
  }
  _firstVar() {
    return this.model.variables[0]?.name || '';
  }
}

// ---------- 小工具 ----------
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function label(t) { const l = el('label', 'field__label'); l.textContent = t; return l; }
function hint(t) { const h = el('div', 'panel__hint'); h.textContent = t; return h; }
function input(value, placeholder, onChange, cls = 'input') {
  const i = document.createElement('input');
  i.className = cls; i.value = value || ''; i.placeholder = placeholder || '';
  i.addEventListener('input', () => onChange(i.value));
  return i;
}
function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls; b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
function iconBtn(text, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn'; b.textContent = text; b.title = title;
  b.addEventListener('click', onClick);
  return b;
}
function opSelect(options, value, onChange) {
  const s = document.createElement('select');
  s.className = 'select';
  s.innerHTML = options.map((o) => `<option value="${o.v}" ${o.v === value ? 'selected' : ''}>${o.t}</option>`).join('');
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function varSelect(model, value, onChange) {
  const s = document.createElement('select');
  s.className = 'select select--var';
  const opts = model.variables.map((v) => `<option value="${v.name}" ${v.name === value ? 'selected' : ''}>${v.name}</option>`).join('');
  s.innerHTML = `<option value="" ${!value ? 'selected' : ''}>选择变量…</option>` + opts;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function createDatalist() {
  const dl = document.createElement('datalist');
  dl.id = 'speakerList';
  document.body.appendChild(dl);
  return dl;
}
