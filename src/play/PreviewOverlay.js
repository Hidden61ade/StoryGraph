// galgame 风格的剧情预览层：把 StoryPlayer 的状态渲染成可点击试玩的对话界面。
// 让策划无需引擎、无需导出，直接在工具里「玩一遍」自己的剧情，快速验证分支与变量。
import { StoryPlayer } from './StoryPlayer.js';

export class PreviewOverlay {
  constructor(compiled, { onClose } = {}) {
    this.player = new StoryPlayer(compiled);
    this.onClose = onClose || (() => {});
    this.name = compiled.name || '未命名剧情';
    this._build();
    this._render(this.player.begin());
    this._onKey = (e) => {
      if (e.key === 'Escape') this.close();
      else if (this._mode === 'dialogue' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault(); this._render(this.player.next());
      }
    };
    window.addEventListener('keydown', this._onKey, true);
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'preview';
    el.innerHTML = `
      <div class="preview__bar">
        <span class="preview__name">▶ 试玩预览 · ${esc(this.name)}</span>
        <span class="preview__hint">点击对话框继续 · 空格/回车下一句 · Esc 退出</span>
        <span class="preview__tools">
          <button class="preview__tbtn" data-act="vars" title="查看当前变量">🔢 变量</button>
          <button class="preview__tbtn" data-act="restart" title="从头开始">↺ 重玩</button>
          <button class="preview__tbtn preview__tbtn--close" data-act="close" title="关闭 (Esc)">✕</button>
        </span>
      </div>
      <div class="preview__stage">
        <div class="preview__vars" id="pvVars" hidden></div>
        <div class="preview__panel">
          <div class="preview__speaker" id="pvSpeaker"></div>
          <div class="preview__box" id="pvBox">
            <div class="preview__text" id="pvText"></div>
            <div class="preview__choices" id="pvChoices"></div>
            <div class="preview__cont" id="pvCont">▼</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    el.querySelector('[data-act="close"]').addEventListener('click', () => this.close());
    el.querySelector('[data-act="restart"]').addEventListener('click', () => { this._endShown = false; this._render(this.player.begin()); });
    el.querySelector('[data-act="vars"]').addEventListener('click', () => this._toggleVars());
    this.box = el.querySelector('#pvBox');
    this.box.addEventListener('click', (e) => {
      if (e.target.closest('.preview__choice')) return; // 选项自己处理
      if (this._mode === 'dialogue') this._render(this.player.next());
    });
  }

  _render(state) {
    const speaker = this.el.querySelector('#pvSpeaker');
    const text = this.el.querySelector('#pvText');
    const choices = this.el.querySelector('#pvChoices');
    const cont = this.el.querySelector('#pvCont');
    choices.innerHTML = '';
    this._mode = state.kind;
    this.box.classList.toggle('preview__box--end', state.kind === 'end');
    this._refreshVars();

    if (state.kind === 'dialogue') {
      speaker.textContent = state.speaker || '';
      speaker.style.visibility = state.speaker ? 'visible' : 'hidden';
      text.textContent = state.text || '';
      cont.hidden = false;
    } else if (state.kind === 'choice') {
      speaker.style.visibility = 'hidden';
      text.textContent = state.prompt || '请选择：';
      cont.hidden = true;
      const list = state.choices || [];
      if (!list.length) {
        text.textContent = '（这里是一个没有选项的选择节点）';
      }
      list.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'preview__choice';
        b.textContent = c.text || ('选项 ' + (i + 1));
        b.addEventListener('click', () => this._render(this.player.choose(i)));
        choices.appendChild(b);
      });
    } else { // end
      speaker.style.visibility = 'hidden';
      text.innerHTML = `🏁 <b>剧情结束</b>${state.ending ? ' · ' + esc(state.ending) : ''}`;
      cont.hidden = true;
      const again = document.createElement('button');
      again.className = 'preview__choice';
      again.textContent = '↺ 再玩一次';
      again.addEventListener('click', () => this._render(this.player.begin()));
      choices.appendChild(again);
    }
  }

  _toggleVars() {
    const v = this.el.querySelector('#pvVars');
    v.hidden = !v.hidden;
    this._refreshVars();
  }
  _refreshVars() {
    const v = this.el.querySelector('#pvVars');
    if (v.hidden) return;
    const entries = Object.entries(this.player.vars);
    v.innerHTML = entries.length
      ? `<div class="preview__vars-title">当前变量</div>` + entries
        .map(([k, val]) => `<div class="preview__var"><span>${esc(k)}</span><b>${esc(String(val))}</b></div>`).join('')
      : '<div class="preview__var muted">（这段剧情没有变量）</div>';
  }

  close() {
    window.removeEventListener('keydown', this._onKey, true);
    this.el.remove();
    this.onClose();
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
