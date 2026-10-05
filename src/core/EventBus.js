// 一个极简的事件总线：所有模块通过它解耦通信。
// 插件后续也通过订阅这些事件来扩展功能，而无需改动核心。
export class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  /** 订阅事件，返回取消订阅的函数 */
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    this._handlers.get(type)?.forEach((fn) => {
      try { fn(payload); } catch (err) { console.error(`[EventBus] ${type} handler failed:`, err); }
    });
    // '*' 通配监听，便于调试 / 插件统一观察
    if (type !== '*') {
      this._handlers.get('*')?.forEach((fn) => {
        try { fn({ type, payload }); } catch (err) { console.error(err); }
      });
    }
  }
}
