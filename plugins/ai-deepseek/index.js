// AI 助手插件（DeepSeek）。
// 通过扩展点把 AI 能力挂到编辑器上：润色对白、续写下一句、生成分支选项、全篇一致性检查。
// 关键点：AI 是「增强」而非「地基」——没有它，核心编辑/导出照常工作；
// 没配 Key 或调用失败时，这里会优雅降级并给出友好提示，绝不让工具崩溃。
import { polishMessages, continueMessages, branchMessages, consistencyMessages } from './prompts.js';
import { newOption } from '../../src/core/nodeTypes.js';

let _memoryCache = null;

export default {
  id: 'ai-deepseek',
  name: 'AI 助手 (DeepSeek)',

  setup(api) {
    // —— 对话节点：用角色口吻润色 ——
    api.actions.addNodeAction({
      id: 'ai.polish',
      label: '✨ 用角色口吻润色',
      title: '让 AI 按该角色的性格与本作语气重写这句台词',
      when: (n) => n.type === 'dialogue',
      run: (node) => polish(api, node),
    });

    // —— 对话节点：续写下一句 ——
    api.actions.addNodeAction({
      id: 'ai.continue',
      label: '➡️ AI 续写下一句',
      title: '基于当前台词，生成紧接着的一句对白节点',
      when: (n) => n.type === 'dialogue',
      run: (node) => continueLine(api, node),
    });

    // —— 选择节点：生成分支选项 ——
    api.actions.addNodeAction({
      id: 'ai.branches',
      label: '🌿 AI 生成 3 个分支选项',
      title: '为这个选择节点生成贴合剧情的新选项',
      when: (n) => n.type === 'choice',
      run: (node) => genBranches(api, node),
    });

    // —— 工具栏：全篇一致性检查 ——
    api.toolbar.addButton({
      id: 'ai.consistency',
      label: '🤖 AI 一致性检查',
      title: '让 AI 检查全篇对白的角色口吻与设定矛盾',
      run: () => consistency(api),
    });

    console.log('[ai-deepseek] 已注册 AI 动作。');
  },
};

// ============ 各功能实现 ============

async function polish(api, node) {
  const mem = await getMemory(api);
  await runAI(api, '正在按角色口吻润色…', polishMessages(mem, node.data.speaker, node.data.text), (result) => {
    showSuggestion(api, '润色建议', node.data.text, result, () => {
      api.model.updateNodeData(node.id, { text: result.trim() });
      api.refresh();
      api.ui.toast('已应用润色', 'success');
    });
  });
}

async function continueLine(api, node) {
  const mem = await getMemory(api);
  await runAI(api, '正在续写下一句…', continueMessages(mem, node.data.speaker, node.data.text), (result) => {
    const { speaker, text } = parseLine(result, node.data.speaker);
    const newNode = api.model.addNode('dialogue', node.x + 260, node.y + 150, { speaker, text });
    // 仅当当前节点还没有后续时自动连线，避免打断已有流程
    if (!api.model.targetOf(node.id, 'out')) api.model.addEdge(node.id, 'out', newNode.id);
    api.canvas.select({ type: 'node', id: newNode.id });
    api.ui.toast('已生成续写节点', 'success');
  });
}

async function genBranches(api, node) {
  const mem = await getMemory(api);
  await runAI(api, '正在生成分支选项…', branchMessages(mem, node.data.prompt, node.data.options), (result) => {
    let list = [];
    try {
      const parsed = JSON.parse(extractJSON(result));
      list = Array.isArray(parsed.options) ? parsed.options : [];
    } catch {
      // 模型没按 JSON 返回时，按行兜底解析
      list = result.split('\n').map((s) => s.replace(/^[\s\-\d.、)]+/, '').trim()).filter(Boolean).slice(0, 3);
    }
    if (!list.length) { api.ui.toast('未能解析出选项，请重试', 'error'); return; }
    const options = [...(node.data.options || []), ...list.map((t) => newOption(String(t)))];
    api.model.updateNodeData(node.id, { options }, true);
    api.refresh();
    api.ui.toast(`已添加 ${list.length} 个选项`, 'success');
  });
}

async function consistency(api) {
  const lines = [...api.model.nodes.values()]
    .filter((n) => n.type === 'dialogue' && n.data.text)
    .map((n) => ({ speaker: n.data.speaker, text: n.data.text }));
  if (!lines.length) { api.ui.toast('剧情里还没有对白可检查', 'error'); return; }
  const mem = await getMemory(api);
  await runAI(api, `正在检查 ${lines.length} 句对白…`, consistencyMessages(mem, lines), (result) => {
    const body = document.createElement('div');
    body.className = 'ai-report';
    body.innerHTML = `<div class="ai-report__hint">DeepSeek 对 ${lines.length} 句对白的检查结果：</div>
      <div class="ai-report__body">${escapeHtml(result).replace(/\n/g, '<br>')}</div>`;
    api.ui.openDialog('AI 一致性检查', body);
  }, { max_tokens: 1200, temperature: 0.4 });
}

// ============ 调用与 UI 辅助 ============

async function getMemory(api) {
  if (_memoryCache == null) {
    try { _memoryCache = await api.context.memory(); }
    catch { _memoryCache = ''; }
  }
  return _memoryCache;
}

/** 统一的调用外壳：显示忙碌弹窗 → 调用 → 关闭 → 回调；错误统一友好提示。 */
async function runAI(api, busyText, messages, onResult, opts) {
  const dlg = busy(api, busyText);
  try {
    const content = await callDeepSeek(api.config.ai, messages, opts);
    dlg.close();
    if (!content || !content.trim()) { api.ui.toast('AI 没有返回内容，请重试', 'error'); return; }
    onResult(content);
  } catch (err) {
    dlg.close();
    showError(api, err);
  }
}

async function callDeepSeek(cfg, messages, { temperature = 0.8, max_tokens = 800 } = {}) {
  cfg = cfg || {};
  const key = (cfg.apiKey || '').trim();
  if (!key) throw new AIError('尚未配置 API Key', '请把 DeepSeek Key 填入 config.local.json 的 ai.apiKey 字段（该文件已被 .gitignore 忽略，不会提交）。');

  const baseURL = (cfg.baseURL || 'https://api.deepseek.com').replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: cfg.model || 'deepseek-chat', messages, temperature, max_tokens, stream: false }),
    });
  } catch (e) {
    throw new AIError('网络请求失败', '无法连接到 AI 服务，请检查网络或 baseURL 配置。');
  }

  if (!res.ok) {
    let detail = '';
    try { const e = await res.json(); detail = e?.error?.message || ''; } catch { /* ignore */ }
    if (/insufficient balance/i.test(detail)) {
      throw new AIError('DeepSeek 账户余额不足', '当前 Key 余额为 0，请到 DeepSeek 控制台充值后再使用 AI 功能。（编辑器与导出功能不受影响）');
    }
    if (res.status === 401) throw new AIError('鉴权失败', 'API Key 无效或已失效，请检查 config.local.json。');
    throw new AIError(`请求失败（HTTP ${res.status}）`, detail || '请稍后重试。');
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

class AIError extends Error {
  constructor(title, detail) { super(title); this.title = title; this.detail = detail || ''; }
}

function showError(api, err) {
  if (err instanceof AIError) {
    const body = document.createElement('div');
    body.innerHTML = `<div class="dialog__warn"><b>${escapeHtml(err.title)}</b><br>${escapeHtml(err.detail)}</div>`;
    api.ui.openDialog('AI 助手', body);
  } else {
    console.error(err);
    api.ui.toast('AI 调用出错：' + (err.message || '未知错误'), 'error');
  }
}

function busy(api, text) {
  const el = document.createElement('div');
  el.className = 'ai-busy';
  el.innerHTML = `<div class="ai-spinner"></div><p>${escapeHtml(text)}</p><p class="muted">由 DeepSeek 提供</p>`;
  return api.ui.openDialog('AI 助手', el);
}

function showSuggestion(api, title, before, after, onApply) {
  const body = document.createElement('div');
  body.className = 'ai-suggest';
  body.innerHTML = `
    <div class="ai-suggest__col"><span class="ai-suggest__tag">原文</span><div class="ai-suggest__text ai-suggest__text--old">${escapeHtml(before) || '（空）'}</div></div>
    <div class="ai-suggest__col"><span class="ai-suggest__tag ai-suggest__tag--new">AI 建议</span><div class="ai-suggest__text">${escapeHtml(after.trim())}</div></div>
    <div class="ai-suggest__actions">
      <button class="btn" data-cancel>取消</button>
      <button class="btn btn--primary" data-apply>应用建议</button>
    </div>`;
  const dlg = api.ui.openDialog(title, body);
  body.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
  body.querySelector('[data-apply]').addEventListener('click', () => { onApply(); dlg.close(); });
}

// 解析 "说话人｜台词" / "说话人:台词"
function parseLine(raw, fallbackSpeaker) {
  const line = raw.trim().split('\n')[0].trim();
  const m = line.match(/^\s*([^｜|:：]{1,16})\s*[｜|:：]\s*(.+)$/);
  if (m) return { speaker: m[1].trim(), text: m[2].trim() };
  return { speaker: fallbackSpeaker || '', text: line };
}

function extractJSON(s) {
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
