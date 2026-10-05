// NPC 日程编辑器插件（示范二：证明本工具不止能编剧情）。
// 同一套「节点 + 连线 + 逻辑门」可以拿来给「模拟经营 / 大世界」里的 NPC 配置一天的作息：
//   日程起点(npc_day) → 时段(time_block) → 时段 → …，中途可插「条件」按天气/旗标分流、用「赋值」改状态。
// 插件做了三件事：① 注册两个自定义节点类型；② 一键插入示例日程；③ 导出 NPC 日程 JSON。
// 关键：它完全通过 PluginHost 的稳定 api 实现，没有改动核心任何一行——这正是「可扩展性」的证明。

export default {
  id: 'npc-schedule',
  name: 'NPC schedule editor',

  setup(api) {
    // ① 注册自定义节点类型（声明式字段 → 检查器自动生成表单；summary → 画布摘要；toEngine → 导出）
    api.nodeTypes.register('npc_day', {
      label: 'Schedule start',
      icon: '🗓',
      color: '#0ea5e9',
      categoryLabel: '🗓 NPC schedules',
      hasInput: false,
      desc: 'The entry point for an NPC schedule on a given day or condition.',
      defaultData: () => ({ npc: '', day: 'Every day' }),
      fields: [
        { key: 'npc', label: 'NPC name', type: 'text', placeholder: 'e.g. Sam the baker' },
        { key: 'day', label: 'Day / condition', type: 'text', placeholder: 'e.g. Every day / Monday / Sunny' },
      ],
      summary: (n, esc) =>
        `<b>${esc(n.data.npc) || '<span class="node__muted">Unnamed NPC</span>'}</b>` +
        `<div class="node__muted">${esc(n.data.day) || 'Every day'}</div>`,
      toEngine: (n, h) => ({ type: 'npc_day', npc: n.data.npc || '', day: n.data.day || 'Every day', next: h.next('out') }),
    });

    api.nodeTypes.register('time_block', {
      label: 'Time block',
      icon: '⏰',
      color: '#0d9488',
      categoryLabel: '🗓 NPC schedules',
      hasInput: true,
      desc: 'An activity and location at a specific time.',
      defaultData: () => ({ time: '08:00', activity: '', location: '', anim: '' }),
      fields: [
        { key: 'time', label: 'Time', type: 'time' },
        { key: 'activity', label: 'Activity', type: 'text', placeholder: 'e.g. Bake bread' },
        { key: 'location', label: 'Location', type: 'text', placeholder: 'e.g. Bakery' },
        { key: 'anim', label: 'Action / animation (optional)', type: 'text', placeholder: 'e.g. work_bake' },
      ],
      summary: (n, esc) =>
        `<b>${esc(n.data.time) || '--:--'}</b> ${esc(n.data.activity) || '<span class="node__muted">No activity</span>'}` +
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
      label: '🗓 Add NPC sample',
      title: 'Add an example daily NPC schedule at the center of the canvas',
      run: () => insertSample(api),
    });

    // ③ 工具栏：导出 NPC 日程 JSON
    api.toolbar.addButton({
      id: 'npc.export',
      label: '🗓 Export NPC schedule',
      title: 'Export NPC schedules as JSON for an engine',
      run: () => exportSchedule(api),
    });

    // 顺手注册一个校验器：时段时间为空 / 格式不对会提示
    api.validators.register({
      id: 'npc.timecheck',
      label: 'NPC schedule time check',
      run: (model) => {
        const issues = [];
        for (const n of model.nodes.values()) {
          if (n.type !== 'time_block') continue;
          const t = (n.data.time || '').trim();
          if (!t) issues.push({ level: 'warn', msg: `[Time block]: time is missing.`, nodeId: n.id });
          else if (!/^\d{1,2}:\d{2}$/.test(t)) issues.push({ level: 'warn', msg: `[Time block]: time ${t} must use HH:MM format.`, nodeId: n.id });
        }
        return issues;
      },
    });

    console.log('[npc-schedule] Schedule node types and toolbar actions registered.');
  },
};

// 在画布中央插入一个示例 NPC 日程
function insertSample(api) {
  const c = api.canvas.viewportCenterContent ? api.canvas.viewportCenterContent() : { x: 200, y: 160 };
  const x0 = Math.round(c.x) - 120, y0 = Math.round(c.y) - 120;
  const day = api.model.addNode('npc_day', x0, y0, { npc: 'Sam the baker', day: 'Sunny' });
  const blocks = [
    { time: '08:00', activity: 'Open the shop and bake bread', location: 'Bakery', anim: 'work_bake' },
    { time: '12:00', activity: 'Have lunch in the square', location: 'Town square', anim: 'eat' },
    { time: '18:00', activity: 'Go home and rest', location: 'Home', anim: 'idle' },
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
  api.ui.toast('Added the NPC sample. Edit it or add condition branches.', 'success');
}

// 导出所有 NPC 日程为 JSON
function exportSchedule(api) {
  const model = api.model;
  const days = [...model.nodes.values()].filter((n) => n.type === 'npc_day');
  if (!days.length) { api.ui.toast('No Schedule start node. Add one or insert the sample first.', 'error'); return; }

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
    return { npc: day.data.npc || 'Unnamed NPC', day: day.data.day || 'Every day', blocks };
  });

  const json = JSON.stringify({ schedules: npcs }, null, 2);
  const name = (model.meta.name || 'npc').replace(/[\\/:*?"<>|\s]+/g, '_');
  if (api.ui.download) {
    api.ui.download(json, name + '.npc-schedule.json', 'application/json');
    api.ui.toast(`Exported schedules for ${npcs.length} NPCs`, 'success');
  } else {
    const body = document.createElement('div');
    body.innerHTML = `<pre class="export-preview">${escapeHtml(json)}</pre>`;
    api.ui.openDialog('NPC schedules JSON', body);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
