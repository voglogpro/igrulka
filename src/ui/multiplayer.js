import { NetworkSession, SESSION_KEY } from '../network/client.js';
import { escape } from './format.js';

export class MultiplayerUI {
  constructor({ onEnter, onState, onRoom, onLeave, pauseLocal }) {
    Object.assign(this, { onEnter, onState, onRoom, onLeave, pauseLocal });
    this.host = document.createElement('section');
    this.host.id = 'network-lobby';
    this.host.className = 'glass';
    this.host.hidden = true;
    this.host.setAttribute('aria-label', 'Сетевая дуэль');
    document.querySelector('#game').append(this.host);
    this.host.addEventListener('click', (e) => this.click(e));
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'Escape' || this.host.hidden) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.dismiss();
      },
      true,
    );
  }
  open() {
    this.pauseLocal?.();
    this.host.hidden = false;
    if (this.session?.room) {
      this.renderRoom();
      return;
    }
    delete this.host.dataset.roomSignature;
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {}
    const address = location.protocol.startsWith('http')
      ? location.origin
      : 'http://127.0.0.1:8788';
    this.host.innerHTML = `<div class="panel-head"><span class="eyebrow">СЕТЕВАЯ ДУЭЛЬ · LAN PREVIEW</span><button data-net="close" aria-label="Закрыть">×</button></div><h2>Два города.<br>Два командира.</h2><p>Равный старт и экономика. Время и бой рассчитывает сервер. При разрыве связи матч ждёт возвращения игрока.</p><label>Сервер<input id="net-address" value="${escape(saved?.address || address)}" placeholder="http://127.0.0.1:8788" maxlength="200"></label><label>Имя<input id="net-name" value="Командир" maxlength="24" autocomplete="nickname"></label><div class="net-join-row"><label>Код комнаты<input id="net-code" maxlength="6" placeholder="ABC234" autocomplete="off"></label><button data-net="join">Войти</button></div><button class="primary" data-net="create">Создать комнату</button>${saved?.token ? '<button data-net="resume" class="net-resume">Вернуться в прошлую комнату</button>' : ''}<p id="net-error" role="status"></p><details><summary>Как подключиться</summary><p>Запустите «Сетевой сервер.cmd». На этом компьютере откройте адрес сервера в двух окнах. Для второго компьютера в локальной сети запустите сервер с --host=0.0.0.0 и используйте IP компьютера сервера. Оба игрока должны открыть одну версию игры.</p></details>`;
  }
  async click(event) {
    const button = event.target.closest('button[data-net]');
    if (!button || button.disabled) return;
    const action = button.dataset.net;
    if (action === 'close') {
      this.dismiss();
      return;
    }
    if (action === 'leave') {
      this.leave();
      return;
    }
    if (action === 'ready') {
      this.session?.send({
        type: 'ready',
        value: !this.session.room.players[this.session.side]?.ready,
      });
      return;
    }
    if (action === 'start') {
      this.session?.send({ type: 'start' });
      return;
    }
    if (!['create', 'join', 'resume'].includes(action)) return;
    const address = this.host.querySelector('#net-address').value.trim();
    const name = this.host.querySelector('#net-name').value.trim();
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {}
    const request =
      action === 'resume'
        ? { type: 'resume', code: saved?.code, token: saved?.token }
        : {
            type: action,
            name,
            code: this.host.querySelector('#net-code').value.trim().toUpperCase(),
          };
    this.session?.disconnect();
    const session = new NetworkSession({
      onState: (state, room) => {
        if (this.session !== session) return;
        this.onState?.(state, room);
        if (!this.hasGameView && room.phase !== 'waiting') {
          this.host.hidden = true;
          this.hasGameView = true;
        }
      },
      onRoom: (room) => {
        if (this.session !== session) return;
        this.onRoom?.(room);
        if (!this.host.hidden) this.renderRoom();
      },
      onStatus: (message) => this.status(message),
      onError: (message) => this.status(message, true),
      onClosed: (message) => {
        if (this.session !== session) return;
        this.session = null;
        this.onLeave?.(message);
        this.host.hidden = true;
      },
    });
    this.session = session;
    this.hasGameView = false;
    for (const b of this.host.querySelectorAll('button[data-net]'))
      if (b.dataset.net !== 'close') b.disabled = true;
    try {
      await session.connect(address, request);
      this.onEnter?.(session);
      this.renderRoom();
    } catch (error) {
      if (this.session !== session) return;
      session.disconnect();
      this.session = null;
      this.open();
      this.status(error.message, true);
    }
  }
  dismiss() {
    if (this.session?.room?.phase === 'waiting') {
      this.leave();
      return;
    }
    if (this.session && !this.session.room) {
      this.session.disconnect();
      this.session = null;
    }
    this.host.hidden = true;
    document.querySelector('#world canvas')?.focus({ preventScroll: true });
  }
  status(message, danger = false) {
    const element = this.host.querySelector('#net-error');
    if (element) {
      element.textContent = message;
      element.classList.toggle('warning', danger);
    }
    const status = document.querySelector('#network-status');
    if (status && !this.host.hidden) {
      status.hidden = true;
      return;
    }
    if (status && this.session?.token) {
      status.hidden = false;
      status.textContent = message;
    }
  }
  renderRoom() {
    const session = this.session,
      room = session?.room;
    if (!room) return;
    const signature = JSON.stringify(room);
    if (this.host.dataset.roomSignature === signature) return;
    this.host.dataset.roomSignature = signature;
    const self = room.players[session.side],
      ready = room.players.every((p) => p?.ready && p.connected);
    this.host.innerHTML = `<div class="panel-head"><span class="eyebrow">СЕТЕВАЯ КОМНАТА</span><button data-net="close" aria-label="Скрыть">×</button></div><h2 class="net-room-code">${escape(room.code)}</h2><p>Передайте этот код второму игроку на том же сервере.</p><div class="net-players">${room.players.map((p, i) => `<div><b>${escape(p?.name || 'Ожидание игрока…')}${i === session.side ? ' · вы' : ''}</b><span>${p ? (p.connected ? (p.ready ? 'Готов' : 'Подключён') : 'Связь потеряна') : 'Свободное место'}</span></div>`).join('')}</div>${room.phase === 'waiting' ? `<button data-net="ready" class="primary">${self?.ready ? 'Отменить готовность' : 'Я готов'}</button>${session.side === 0 ? `<button data-net="start" ${ready ? '' : 'disabled'}>Начать матч</button>` : '<p>Матч начнёт создатель комнаты после готовности обоих игроков.</p>'}` : '<p>Матч уже идёт. Меню можно закрыть.</p>'}<button data-net="leave" class="net-leave">Завершить сессию</button><p id="net-error" role="status"></p>`;
    const close = this.host.querySelector('[data-net="close"]');
    close.title = room.phase === 'waiting' ? 'Выйти из комнаты' : 'Скрыть меню комнаты';
    close.setAttribute('aria-label', close.title);
  }
  leave() {
    this.session?.leave();
    this.session = null;
    this.host.hidden = true;
    this.onLeave?.('Сетевая сессия завершена');
  }
}
