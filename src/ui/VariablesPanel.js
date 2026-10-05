// 变量面板：管理整段剧情共享的变量（好感度、线索标记等）。
// 非技术同学在这里“声明”要用到的数字/开关，选择节点里就能直接下拉引用。
export class VariablesPanel {
  constructor(model, root) {
    this.model = model;
    this.root = root;
    this.model.on('variablesChanged', () => this.render());
    this.model.on('loaded', () => this.render());
    this.render();
  }

  render() {
    const rows = this.model.variables.map((v, i) => this._row(v, i));
    this.root.innerHTML = `
      <div class="panel__title">
        Variables
        <span class="panel__title-tag">${this.model.variables.length}</span>
      </div>
      <div class="panel__hint">Shared story state: relationship values, read clues, and other flags.</div>
      <div class="var-list" id="varList"></div>
      <button class="add-btn" id="addVar">＋ Add variable</button>`;
    const list = this.root.querySelector('#varList');
    if (!rows.length) {
      list.innerHTML = `<div class="muted" style="padding:8px 2px">No variables yet. Add one below, such as affection_adam.</div>`;
    } else {
      rows.forEach((r) => list.append(r));
    }
    this.root.querySelector('#addVar').addEventListener('click', () => this.model.addVariable({ name: '', type: 'number', initial: 0 }));
  }

  _row(v, index) {
    const row = document.createElement('div');
    row.className = 'var-row';

    const name = document.createElement('input');
    name.className = 'input input--grow';
    name.value = v.name;
    name.placeholder = 'Variable name';
    name.addEventListener('change', () => {
      const newName = name.value.trim();
      if (!newName) { name.value = v.name; return; }
      if (this.model.variables.some((o, i) => i !== index && o.name === newName)) {
        alert('Variable names must be unique.');
        name.value = v.name;
        return;
      }
      this.model.updateVariable(index, { name: newName });
    });

    const type = document.createElement('select');
    type.className = 'select select--sm';
    type.innerHTML = `
      <option value="number" ${v.type === 'number' ? 'selected' : ''}>Number</option>
      <option value="boolean" ${v.type === 'boolean' ? 'selected' : ''}>Boolean</option>
      <option value="string" ${v.type === 'string' ? 'selected' : ''}>String</option>`;
    type.addEventListener('change', () => {
      const init = type.value === 'number' ? 0 : type.value === 'boolean' ? false : '';
      this.model.updateVariable(index, { type: type.value, initial: init });
    });

    const initial = this._initialControl(v, index);

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '🗑';
    del.title = 'Delete variable';
    del.addEventListener('click', () => this.model.removeVariable(index));

    const top = document.createElement('div');
    top.className = 'var-row__top';
    top.append(name, del);

    const bottom = document.createElement('div');
    bottom.className = 'var-row__bottom';
    const initLabel = document.createElement('span');
    initLabel.className = 'var-row__label';
    initLabel.textContent = 'Initial';
    bottom.append(type, initLabel, initial);

    row.append(top, bottom);
    return row;
  }

  _initialControl(v, index) {
    if (v.type === 'boolean') {
      const sel = document.createElement('select');
      sel.className = 'select select--sm';
      sel.innerHTML = `<option value="false" ${!v.initial || v.initial === 'false' ? 'selected' : ''}>False</option>
                       <option value="true" ${v.initial === true || v.initial === 'true' ? 'selected' : ''}>True</option>`;
      sel.addEventListener('change', () => this.model.updateVariable(index, { initial: sel.value === 'true' }));
      return sel;
    }
    const inp = document.createElement('input');
    inp.className = 'input input--num';
    inp.value = v.initial ?? (v.type === 'number' ? 0 : '');
    if (v.type === 'number') inp.type = 'number';
    inp.addEventListener('change', () => {
      const val = v.type === 'number' ? Number(inp.value) || 0 : inp.value;
      this.model.updateVariable(index, { initial: val });
    });
    return inp;
  }
}
