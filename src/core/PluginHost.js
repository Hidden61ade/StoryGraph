// 插件宿主：管理扩展点注册表，并向插件暴露一个稳定的 api 门面。
// 核心通过它把“可扩展能力”开放出去，而插件不直接触碰核心内部实现。
// AI 与 NPC 日程都是“插件”，核心无插件也能完整运行。
import { registerNodeType } from './nodeTypes.js';

export class PluginHost {
  /**
   * @param {object} ctx 由 main.js 注入的运行环境：
   *   { model, canvas, ui:{toast,openDialog,confirm}, config, getMemory, refreshInspector, onToolbarButton }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.nodeActions = [];
    this.toolbarButtons = [];
    this.validators = [];

    // 一次性构建 api，用 getter 保证 config 等始终读到最新值。
    this.api = {
      model: ctx.model,
      canvas: ctx.canvas,
      ui: ctx.ui,
      context: { memory: () => ctx.getMemory() },
      get config() { return ctx.config || {}; },

      // —— 扩展点 ——
      actions: {
        /** 注册节点动作：{ id, label, title?, when(node)?, run(node) } */
        addNodeAction: (action) => this.nodeActions.push(action),
      },
      toolbar: {
        /** 注册工具栏按钮：{ id, label, title?, run() } */
        addButton: (btn) => { this.toolbarButtons.push(btn); ctx.onToolbarButton?.(btn); },
      },
      validators: {
        /** 注册自定义校验器：{ id, label, run(model)->issues[] } */
        register: (v) => this.validators.push(v),
      },
      nodeTypes: {
        /** 注册自定义节点类型（让节点图不只能编剧情）。 */
        register: (type, def) => { registerNodeType(type, def); ctx.onNodeTypeRegistered?.(type, def); },
      },

      /** 让检查器重渲染当前选中节点（动作改了节点数据后调用） */
      refresh: () => ctx.refreshInspector?.(),
    };
  }

  /** 取出适用于某节点的所有动作 */
  nodeActionsFor(node) {
    return this.nodeActions.filter((a) => !a.when || a.when(node));
  }

  /** 依次加载插件模块（每个模块默认导出一个含 setup(api) 的对象） */
  async loadAll(modules) {
    for (const mod of modules) {
      const plugin = mod.default || mod;
      if (!plugin || typeof plugin.setup !== 'function') continue;
      try {
        await plugin.setup(this.api);
        console.log('[plugin] 已加载：', plugin.id || '(匿名插件)');
      } catch (err) {
        console.error('[plugin] 加载失败：', plugin.id, err);
      }
    }
  }
}
