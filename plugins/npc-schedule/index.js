// NPC 日程编辑器插件（示范二：证明本工具不止能编剧情）。
// 同一套「节点 + 连线 + 逻辑门」可以拿来给「模拟经营 / 大世界」里的 NPC 配置一天的作息：
//   日程起点(npc_day) → 时段(time_block) → 时段 → …，中途可插「条件」按天气/旗标分流、用「赋值」改状态。
// 插件做了三件事：① 注册两个自定义节点类型；② 一键插入示例日程；③ 导出 NPC 日程 JSON。
// 关键：它完全通过 PluginHost 的稳定 api 实现，没有改动核心任何一行——这正是「可扩展性」的证明。

export default {
  id: 'npc-schedule',
  name: 'NPC 日程编辑器',

  setup(api) {
    // ① 注册自定义节点类型（声明式字段 → 检查器自动生成表单；summary → 画布摘要；toEngine → 导出）
    api.nodeTypes.register('npc_day', {
      label: '日程起点',
      icon: '🗓',
      color: '#0ea5e9',
      categoryLabel: '🗓 NPC 日程',
      hasInput: false,
      desc: '一个 NPC 在某一天/某种条件下的作息起点。',
      defaultData: () => ({ npc: '', day: '每天' }),
      fields: [
        { key: 'npc', label: 'NPC 名称', type: 'text', placeholder: '如：面包师 Sam' },
        { key: 'day', label: '适用日 / 条件', type: 'text', placeholder: '如：每天 / 周一 / 晴天' },
      ],
      summary: (n, esc) =>
        `<b>${esc(n.data.npc) || '<span class="node__muted">未命名 NPC</span>'}</b>` +
        `<div class="node__muted">${esc(n.data.day) || '每天'}</div>`,
      toEngine: (n, h) => ({ type: 'npc_day', npc: n.data.npc || '', day: n.data.day || '每天', next: h.next('out') }),
    });

    api.nodeTypes.register('time_block', {
      label: '时段',
      icon: '⏰',
      color: '#0d9488',
      categoryLabel: '🗓 NPC 日程',
      hasInput: true,
      desc: '某个时间点，NPC 去哪里、做什么。',
      defaultData: () => ({ time: '08:00', activity: '', location: '', anim: '' }),
      fields: [
        { key: 'time', label: '时间', type: 'time' },
        { key: 'activity', label: '活动', type: 'text', placeholder: '如：烤面包' },
        { key: 'location', label: '地点', type: 'text', placeholder: '如：面包房' },
        { key: 'anim', label: '动作 / 动画（可选）', type: 'text', placeholder: '如：work_bake' },
      ],
      summary: (n, esc) =>
        `<b>${esc(n.data.time) || '--:--'}</b> ${esc(n.data.activity) || '<span class="node__muted">未设活动</span>'}` +
        `${n.data.location ? `<div class="node__muted">📍 ${esc(n.data.location)}</div>` : ''}`,
      toEngine: (n, h) => ({
        type: 'time_block',
        time: n.data.time || '', activity: n.data.activity || '',
        location: n.data.location || '', anim: n.data.anim || '',
        next: h.next('out'),
      }),
    });

    // ② 工具栏：一键插入示例日程
    api.toolbar.addButton({
      id: 'npc.sample',
      label: '🗓 插入 NPC 日程示例',
      title: '在画布中央生成一个示例 NPC 一天的作息（日程起点 + 若干时段）',
      run: () => insertSample(api),
    });

    // ③ 工具栏：导出 NPC 日程 JSON
    api.toolbar.addButton({
      id: 'npc.export',
      label: '🗓 导出 NPC 日程',
      title: '把所有 NPC 日程导出为引擎可读的 JSON',
      run: () => exportSchedule(api),
    });

    // 顺手注册一个校验器：时段时间为空 / 格式不对会提示
    api.validators.register({
      id: 'npc.timecheck',
      label: 'NPC 日程时间检查',
      run: (model) => {
        const issues = [];
        for (const n of model.nodes.values()) {
          if (n.type !== 'time_block') continue;
          const t = (n.data.time || '').trim();
          if (!t) issues.push({ level: 'warn', msg: `[时段]：未填写时间。`, nodeId: n.id });
          else if (!/^\d{1,2}:\d{2}$/.test(t)) issues.push({ level: 'warn', msg: `[时段] 时间「${t}」格式应为 HH:MM。`, nodeId: n.id });
        }
        return issues;
      },
    });

    console.log('[npc-schedule] 已注册日程节点类型与工具按钮。');
  },
};

// 在画布中央插入一个示例 NPC 日程
function insertSample(api) {
  const c = api.canvas.viewportCenterContent ? api.canvas.viewportCenterContent() : { x: 200, y: 160 };
  const x0 = Math.round(c.x) - 120, y0 = Math.round(c.y) - 120;
  const day = api.model.addNode('npc_day', x0, y0, { npc: '面包师 Sam', day: '晴天' });
  const blocks = [
    { time: '08:00', activity: '开店烤面包', location: '面包房', anim: 'work_bake' },
    { time: '12:00', activity: '广场吃午饭', location: '镇广场', anim: 'eat' },
    { time: '18:00', activity: '回家休息', location: '家', anim: 'idle' },
  ];
  let prev = day, prevPort = 'out', y = y0;
  const ids = [day.id];
  for (const b of blocks) {
    y += 150;
    const node = api.model.addNode('time_block', x0 + 40, y, { ...b });
    api.model.addEdge(prev.id, prevPort, node.id);
    prev = node; prevPort = 'out';
    ids.push(node.id);
  }
  if (api.canvas.selectNodes) api.canvas.selectNodes(ids);
  api.ui.toast('已插入示例 NPC 日程（可继续编辑/插入条件分流）', 'success');
}

// 导出所有 NPC 日程为 JSON
function exportSchedule(api) {
  const model = api.model;
  const days = [...model.nodes.values()].filter((n) => n.type === 'npc_day');
  if (!days.length) { api.ui.toast('没有「日程起点」节点，先插入示例或新建一个', 'error'); return; }

  const npcs = days.map((day) => {
    const blocks = [];
    const visited = new Set();
    let curId = model.targetOf(day.id, 'out');
    while (curId && !visited.has(curId)) {
      visited.add(curId);
      const n = model.nodes.get(curId);
      if (!n) break;
      if (n.type === 'time_block') {
        blocks.push({
          time: n.data.time || '', activity: n.data.activity || '',
          location: n.data.location || '', anim: n.data.anim || '',
        });
        curId = model.targetOf(n.id, 'out');
      } else if (n.type === 'setvar') {
        curId = model.targetOf(n.id, 'out'); // 跳过赋值，继续往下
      } else if (n.type === 'condition') {
        curId = model.targetOf(n.id, 'true') || model.targetOf(n.id, 'false'); // 简化：取一条分支
      } else {
        break;
      }
    }
    return { npc: day.data.npc || '未命名NPC', day: day.data.day || '每天', blocks };
  });

  const json = JSON.stringify({ schedules: npcs }, null, 2);
  const name = (model.meta.name || 'npc').replace(/[\\/:*?"<>|\s]+/g, '_');
  if (api.ui.download) {
    api.ui.download(json, name + '.npc-schedule.json', 'application/json');
    api.ui.toast(`已导出 ${npcs.length} 个 NPC 的日程`, 'success');
  } else {
    const body = document.createElement('div');
    body.innerHTML = `<pre class="export-preview">${escapeHtml(json)}</pre>`;
    api.ui.openDialog('NPC 日程 JSON', body);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
