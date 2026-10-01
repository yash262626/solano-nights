// Tiny synchronous event bus + game-time scheduler.
// Systems emit gameplay events (gunfire, explosions, kills…) instead of calling Game hooks directly,
// and delayed gameplay actions use game time so they respect pause / time scale.
export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) { list = []; this.handlers.set(type, list); }
    list.push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, payload) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }
}

export class Scheduler {
  constructor() { this.time = 0; this.items = []; }
  // run fn after `delay` seconds of game time
  after(delay, fn) { this.items.push({ at: this.time + delay, fn }); }
  update(dt) {
    this.time += dt;
    if (!this.items.length) return;
    const due = [];
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].at <= this.time) { due.push(this.items[i]); this.items.splice(i, 1); }
    }
    for (let i = due.length - 1; i >= 0; i--) due[i].fn();
  }
  clear() { this.items.length = 0; }
}
