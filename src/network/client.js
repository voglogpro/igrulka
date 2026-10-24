import { PROTOCOL_VERSION } from './commands.js';

export const SESSION_KEY = 'skyfront-room-v1';
export function serverAddress(value) {
  const url = new URL(value);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password)
    throw Error('Укажите адрес http:// или ws:// сервера');
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
  url.pathname = '/match';
  url.search = '';
  url.hash = '';
  return url.href;
}

export class NetworkSession {
  constructor({ onState, onRoom, onStatus, onClosed, onError }) {
    Object.assign(this, { onState, onRoom, onStatus, onClosed, onError });
    this.pending = new Map();
    this.sequence = 0;
    this.retries = 0;
    this.intentional = false;
  }
  connect(address, request) {
    this.address = serverAddress(address);
    this.request = request;
    this.intentional = false;
    return new Promise((resolve, reject) => {
      this.resolveJoin = resolve;
      this.rejectJoin = reject;
      this.open();
    });
  }
  open() {
    clearTimeout(this.reconnectTimer);
    this.onStatus?.(this.retries ? 'Восстановление подключения…' : 'Подключение…');
    let socket;
    try {
      socket = new WebSocket(this.address);
    } catch (e) {
      this.rejectJoin?.(e);
      this.onError?.(e.message);
      return;
    }
    this.socket = socket;
    let disconnected = false,
      lastReceived = null;
    const handleDisconnect = () => {
      clearTimeout(timeout);
      if (this.socket !== socket || disconnected) return false;
      disconnected = true;
      // Native close can arrive much later. Detach first so callbacks and stale events
      // cannot send commands or interfere with a replacement connection.
      this.socket = null;
      clearInterval(this.pingTimer);
      this.resolvePending('Подключение прервано. Проверьте состояние после возврата.');
      if (this.intentional) return true;
      if (this.token && this.room) {
        this.room = { ...this.room, phase: 'disconnected' };
        this.onRoom?.(this.room);
      }
      if (this.intentional || this.socket) return true;
      this.onStatus?.(this.token ? 'Связь потеряна. Матч приостановлен.' : 'Сервер недоступен');
      if (this.intentional || this.socket) return true;
      if (this.token && this.retries < 12) {
        this.retries++;
        this.reconnectTimer = setTimeout(() => this.open(), Math.min(6000, 750 * this.retries));
      } else {
        this.rejectJoin?.(Error('Не удалось подключиться к серверу'));
        this.rejectJoin = null;
        this.resolveJoin = null;
        this.onClosed?.('Сервер недоступен. Место можно восстановить из меню сети.');
      }
      return true;
    };
    const timeout = setTimeout(() => {
      if (handleDisconnect()) socket.close();
    }, 8000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      if (this.socket !== socket || this.intentional) return;
      lastReceived = performance.now();
      this.send(
        this.token ? { type: 'resume', code: this.room.code, token: this.token } : this.request,
      );
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || this.intentional) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message.type !== 'string') return;
      lastReceived = performance.now();
      if (message.type === 'joined') {
        this.sequence = Math.max(this.sequence, message.lastSequence || 0);
        this.token = message.token;
        this.side = message.side;
        this.seat = message.seat ?? message.side;
        this.room = message.room;
        this.retries = 0;
        try {
          sessionStorage.setItem(
            SESSION_KEY,
            JSON.stringify({ address: this.address, code: this.room.code, token: this.token }),
          );
        } catch {}
        this.resolveJoin?.(message);
        this.resolveJoin = null;
        this.rejectJoin = null;
        this.onStatus?.('Подключено');
      }
      if (message.room) {
        this.room = message.room;
        this.onRoom?.(this.room);
      }
      if (message.state) {
        this.previous = this.latest;
        this.latest = { state: message.state, received: performance.now() };
        this.onState?.(structuredClone(message.state), this.room);
      }
      if (message.type === 'ack') {
        const pending = this.pending.get(message.sequence);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.sequence);
          pending.resolve(message.error ?? message.result);
        }
      }
      if (message.type === 'error') {
        this.onError?.(message.message);
        if (this.rejectJoin) {
          this.rejectJoin(Error(message.message));
          this.rejectJoin = null;
          this.resolveJoin = null;
          this.intentional = true;
          socket.close();
        } else if (this.token && this.retries) {
          this.intentional = true;
          socket.close();
          this.clearCredentials();
          this.onClosed?.(message.message);
        }
      }
      if (message.type === 'closed') {
        this.intentional = true;
        this.clearCredentials();
        this.disconnect();
        this.onClosed?.(message.message);
      }
      if (message.type === 'pong' && Number.isFinite(message.clientTime))
        this.latency = Math.max(0, performance.now() - message.clientTime);
    });
    socket.addEventListener('close', handleDisconnect);
    socket.addEventListener('error', () => {});
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.socket !== socket || this.intentional) return;
      if (lastReceived !== null && performance.now() - lastReceived >= 15_000) {
        if (handleDisconnect()) socket.close();
        return;
      }
      this.send({ type: 'ping', clientTime: performance.now() });
    }, 3000);
  }
  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, ...message }));
    return true;
  }
  command(command, args) {
    if (this.room?.phase !== 'playing')
      return Promise.resolve('Матч ещё не начат или приостановлен');
    const sequence = ++this.sequence;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(sequence);
        resolve('Ответ задержан. Проверьте состояние перед повтором.');
      }, 8000);
      this.pending.set(sequence, { resolve, timer });
      if (!this.send({ type: 'command', sequence, command, args })) {
        clearTimeout(timer);
        this.pending.delete(sequence);
        resolve('Нет подключения к серверу');
      }
    });
  }
  renderInto(display, now = performance.now()) {
    if (!this.latest || !this.previous) return;
    const a = this.previous.state,
      b = this.latest.state,
      span = b.time - a.time;
    if (span <= 0 || span > 1 || this.room?.phase !== 'playing') return;
    const t = Math.max(0, Math.min(1, (span - 0.1 + (now - this.latest.received) / 1000) / span));
    display.time = a.time + span * t;
    for (const key of ['units', 'groundUnits', 'serviceVehicles', 'ships', 'projectiles']) {
      const before = new Map((a[key] || []).map((u) => [u.id, u]));
      const after = new Map((b[key] || []).map((u) => [u.id, u]));
      for (const u of display[key] || []) {
        const start = before.get(u.id),
          end = after.get(u.id);
        if (!start || !end) continue;
        for (const field of ['x', 'y', 'z', 'travelled', 'fallAge', 'setup'])
          if (Number.isFinite(start[field]) && Number.isFinite(end[field]))
            u[field] = start[field] + (end[field] - start[field]) * t;
        if (key === 'projectiles') {
          for (const field of ['life', 'vx', 'vy', 'vz'])
            if (Number.isFinite(start[field]) && Number.isFinite(end[field]))
              u[field] = start[field] + (end[field] - start[field]) * t;
          // A linear blend of heights cuts through a parabola. Re-evaluate the
          // same physical trajectory at the displayed age, including its tangent.
          const peak = u.arc > 0 ? u.arc : u.loft > 0 ? u.loft : 0;
          if (Number.isFinite(u.life) && peak && u.flight > 0) {
            const age = Math.max(0, Math.min(1, u.life / u.flight));
            const originY = u.originY ?? 6,
              endY = u.endY ?? 2;
            u.y = originY * (1 - age) + endY * age + 4 * peak * age * (1 - age);
            u.vy = (4 * peak * (1 - 2 * age) + endY - originY) / u.flight;
          } else if (
            u.domain === 'ground' &&
            Number.isFinite(u.life) &&
            Number.isFinite(u.originY) &&
            Number.isFinite(u.gravity) &&
            Number.isFinite(end.vy) &&
            Number.isFinite(end.life)
          ) {
            const initialVy = end.vy + u.gravity * end.life;
            u.y = u.originY + initialVy * u.life - 0.5 * u.gravity * u.life * u.life;
            u.vy = initialVy - u.gravity * u.life;
          }
        }
        if (Number.isFinite(start.yaw) && Number.isFinite(end.yaw)) {
          const delta = ((end.yaw - start.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          u.yaw = start.yaw + delta * t;
        }
      }
    }
  }
  clearCredentials() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }
  resolvePending(message) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve(message);
    }
    this.pending.clear();
  }
  disconnect() {
    this.intentional = true;
    this.rejectJoin?.(Error('Подключение отменено'));
    this.rejectJoin = null;
    this.resolveJoin = null;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.resolvePending('Сетевая сессия закрыта');
    this.socket?.close();
  }
  leave() {
    this.send({ type: 'leave' });
    this.clearCredentials();
    this.disconnect();
  }
}
