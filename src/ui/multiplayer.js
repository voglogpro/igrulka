import { NetworkSession, SESSION_KEY } from '../network/client.js';
import {
  defaultServerAddress,
  normalizeServerAddress,
  parseRoomInvite,
  roomInviteUrl,
} from '../network/invite.js';
import { escape } from './format.js';
import { DIFFICULTY } from '../game/index.js';

const NAME_KEY = 'skyfront-network-name';
const savedSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
};
const savedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || 'Командир';
  } catch {
    return 'Командир';
  }
};

async function readServerInfo(address) {
  const url = new URL(address);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/api/server-info';
  url.search = url.hash = '';
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) return null;
  return response.json();
}

export function resolveJoinTarget(value, address, pageURL) {
  const input = value.trim();
  if (!input) throw Error('Вставьте приглашение или код комнаты');
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
    const invite = parseRoomInvite(input);
    if (!invite) throw Error('В ссылке нет кода комнаты');
    return invite;
  }
  const url = new URL(pageURL);
  url.search = url.hash = '';
  url.searchParams.set('room', input);
  url.searchParams.set('server', normalizeServerAddress(address, pageURL));
  return parseRoomInvite(url.href);
}

export class MultiplayerUI {
  constructor({
    onEnter,
    onState,
    onRoom,
    onLeave,
    pauseLocal,
    createSession = (handlers) => new NetworkSession(handlers),
    serverInfo = readServerInfo,
  }) {
    Object.assign(this, {
      onEnter,
      onState,
      onRoom,
      onLeave,
      pauseLocal,
      createSession,
      serverInfo,
    });
    this.mode = 'pvp';
    this.host = document.createElement('section');
    this.host.id = 'network-lobby';
    this.host.className = 'glass';
    this.host.hidden = true;
    this.host.setAttribute('role', 'dialog');
    this.host.setAttribute('aria-label', 'Сетевая игра');
    document.querySelector('#game').append(this.host);
    this.host.addEventListener('click', (event) => this.click(event));
    this.host.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.target.id !== 'net-code') return;
      event.preventDefault();
      this.host.querySelector('[data-net="join"]')?.click();
    });
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.code !== 'Escape' || this.host.hidden) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.dismiss();
      },
      true,
    );
  }

  open({ invite, address } = {}) {
    this.pauseLocal?.();
    this.host.hidden = false;
    if (this.session?.room) {
      this.renderRoom();
      this.resolvePublicInvite(this.session);
      return;
    }
    delete this.host.dataset.roomSignature;
    this.invite = invite || null;
    const draft = this.draft || {},
      saved = savedSession();
    this.address =
      invite?.address || address || draft.address || defaultServerAddress(location.href);
    this.name = draft.name || savedName();
    this.code = invite?.code || draft.code || '';
    const joining = !!invite;
    this.host.innerHTML = `<div class="panel-head"><span class="eyebrow">ИГРА С ДРУЗЬЯМИ</span><button data-net="close" aria-label="Закрыть">×</button></div><div class="net-intro"><span class="net-step">${joining ? 'ПРИГЛАШЕНИЕ ПОЛУЧЕНО' : '01 / СОБЕРИТЕ КОМАНДУ'}</span><h2>${joining ? 'Вас ждут в комнате.' : 'Вместе за одним фронтом.'}</h2><p>${joining ? `Комната <b>${escape(invite.code)}</b>. Укажите имя и присоединяйтесь. Готовность подтвердите после входа.` : 'Создайте комнату и отправьте другу одну ссылку. Каждый играет со своего компьютера.'}</p></div><label class="net-name-label" for="net-name">Ваше имя<input id="net-name" value="${escape(this.name)}" maxlength="24" autocomplete="nickname"></label><section class="net-create-block" ${joining ? 'hidden' : ''}><div class="net-modes" role="group" aria-label="Режим комнаты"><button data-net-mode="pvp" aria-pressed="${this.mode !== 'coop'}" class="${this.mode !== 'coop' ? 'active' : ''}"><span class="net-mode-symbol">1 × 1</span><b>Дуэль</b><small>Каждый за свою базу</small></button><button data-net-mode="coop" aria-pressed="${this.mode === 'coop'}" class="${this.mode === 'coop' ? 'active' : ''}"><span class="net-mode-symbol">2 × 2</span><b>Общий фронт</b><small>Два города против двух ботов</small></button></div><label id="net-difficulty-row" ${this.mode === 'coop' ? '' : 'hidden'}>Сложность ботов<select id="net-difficulty">${Object.entries(
      DIFFICULTY,
    )
      .map(
        ([key, d]) =>
          `<option value="${key}" ${key === (draft.difficulty || 'normal') ? 'selected' : ''}>${escape(d.name)} · ${d.bonus > 1 ? '+' + Math.round((d.bonus - 1) * 100) + '%' : 'без бонуса'}</option>`,
      )
      .join(
        '',
      )}</select></label><p id="net-mode-note" class="small-muted">${this.mode === 'coop' ? 'Два союзных города против двух ботов. У каждого свои ресурсы, производство и армия.' : 'Две базы, равный старт. Бота нет.'}</p><button class="primary" data-net="create">Создать комнату и пригласить ↗</button></section><section class="net-join-block"><div class="net-divider" ${joining ? 'hidden' : ''}><span>Уже есть приглашение?</span></div><div class="net-join-row"><label for="net-code">Ссылка или код комнаты<input id="net-code" value="${escape(this.code)}" maxlength="2048" placeholder="Вставьте ссылку друга" autocomplete="off" spellcheck="false"></label><button class="${joining ? 'primary' : 'net-secondary'}" data-net="join">Войти ↗</button></div>${joining ? '<button class="net-text-button" data-net="new-room">Создать свою комнату</button>' : ''}</section><details class="net-connection"><summary>Сервер и ручное подключение</summary><label>Адрес игрового сервера<input id="net-address" value="${escape(this.address)}" placeholder="https://адрес-сервера" maxlength="2048" spellcheck="false"></label><p>Ссылка друга уже содержит нужный сервер. Для разных сетей сервер должен быть доступен через интернет.</p><p>Если игра открыта из файла или с локального адреса, запустите режим игры по интернету и оставьте сервер работающим до конца матча.</p></details>${saved?.token ? '<button data-net="resume" class="net-resume">Вернуться в прошлую комнату</button>' : ''}<p id="net-error" role="status" aria-live="polite"></p>`;
    this.host.querySelector('#net-name').focus({ preventScroll: true });
  }

  openInvite(invite, { autoJoin = false } = {}) {
    this.open({ invite });
    if (autoJoin) return this.connect('join');
  }

  rememberDraft() {
    const field = (id) => this.host.querySelector(`#${id}`)?.value;
    this.draft = {
      name: field('net-name') || this.name,
      code: field('net-code') || '',
      address: field('net-address') || this.address,
      difficulty: field('net-difficulty') || 'normal',
    };
  }

  async click(event) {
    const modeButton = event.target.closest('button[data-net-mode]');
    if (modeButton && !modeButton.disabled) {
      this.rememberDraft();
      this.mode = modeButton.dataset.netMode;
      this.open();
      return;
    }
    const button = event.target.closest('button[data-net]');
    if (!button || button.disabled) return;
    switch (button.dataset.net) {
      case 'close':
        this.dismiss();
        return;
      case 'leave':
        this.leave();
        return;
      case 'new-room':
        this.rememberDraft();
        this.open();
        return;
      case 'copy':
        await this.copyInvite();
        return;
      case 'ready':
        this.session?.send({
          type: 'ready',
          value: !this.session.room.players[this.session.seat]?.ready,
        });
        return;
      case 'start':
        this.session?.send({ type: 'start' });
        return;
      default:
        if (['create', 'join', 'resume'].includes(button.dataset.net))
          await this.connect(button.dataset.net);
    }
  }

  async connect(action) {
    this.rememberDraft();
    const saved = savedSession();
    let address, request;
    try {
      address = normalizeServerAddress(
        action === 'resume' ? saved?.address || this.draft.address : this.draft.address,
        location.href,
      );
      const name = this.draft.name.trim().slice(0, 24) || 'Командир';
      if (action === 'resume') {
        if (!saved?.code || !saved?.token) throw Error('Нет сохранённого места в комнате');
        request = { type: 'resume', code: saved.code, token: saved.token };
      } else if (action === 'join') {
        const target = resolveJoinTarget(this.draft.code, address, location.href);
        address = target.address;
        request = { type: 'join', name, code: target.code };
      } else
        request = {
          type: 'create',
          name,
          mode: this.mode === 'coop' ? 'coop' : 'pvp',
          difficulty: this.draft.difficulty,
        };
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {}
    } catch (error) {
      this.status(error.message, true);
      return;
    }
    this.session?.disconnect();
    const session = this.createSession({
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
      onStatus: (message) => {
        if (this.session === session) this.status(message);
      },
      onError: (message) => {
        if (this.session === session) this.status(message, true);
      },
      onClosed: (message) => {
        if (this.session !== session) return;
        if (!session.token) {
          session.disconnect();
          this.session = null;
          this.open({ invite: this.invite });
          this.status(message, true);
          return;
        }
        this.session = null;
        this.onLeave?.(message);
        this.host.hidden = true;
      },
    });
    this.session = session;
    this.hasGameView = false;
    this.publicURL = null;
    this.invitePending = true;
    for (const button of this.host.querySelectorAll('button'))
      if (button.dataset.net !== 'close') button.disabled = true;
    this.status('Подключаемся к игровому серверу…');
    try {
      await session.connect(address, request);
      if (this.session !== session) return;
      this.onEnter?.(session);
      this.renderRoom();
      this.resolvePublicInvite(session);
    } catch (error) {
      if (this.session !== session) return;
      session.disconnect();
      this.session = null;
      this.open({ invite: this.invite });
      this.status(error.message, true);
    }
  }

  async resolvePublicInvite(session) {
    try {
      const info = await this.serverInfo(session.address);
      if (this.session !== session) return;
      this.publicURL = info?.publicUrl || null;
    } catch {
      /* A hosted server can share its own origin even without this optional endpoint. */
    }
    if (this.session !== session) return;
    this.invitePending = false;
    if (!this.host.hidden) this.renderRoom();
  }

  async copyInvite() {
    const session = this.session;
    if (!session) return;
    await this.resolvePublicInvite(session);
    if (this.session !== session) return;
    const input = this.host.querySelector('#net-invite-link');
    if (!input) return;
    try {
      if (!navigator.clipboard?.writeText) throw Error('clipboard unavailable');
      await navigator.clipboard.writeText(input.value);
      if (!input.isConnected) return;
      this.status('Ссылка скопирована. Отправьте её другу.');
    } catch {
      if (!input.isConnected) return;
      input.focus();
      input.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch {}
      if (copied) this.status('Ссылка скопирована. Отправьте её другу.');
      else this.status('Ссылка выделена. Нажмите Ctrl+C, чтобы скопировать.');
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
    const signature = JSON.stringify([room, this.publicURL, this.invitePending]);
    if (this.host.dataset.roomSignature === signature) return;
    this.host.dataset.roomSignature = signature;
    const self = room.players[session.seat],
      coop = room.mode === 'coop',
      ready =
        room.players.length === 2 &&
        room.players.every((player) => player?.ready && player.connected);
    let invite = '',
      inviteError = '';
    try {
      invite = roomInviteUrl({
        pageURL: location.href,
        address: session.address,
        code: room.code,
        publicURL: this.publicURL,
      });
    } catch (error) {
      inviteError = error.message;
    }
    const local = invite && /^(localhost|127\.|\[::1\])/.test(new URL(invite).hostname);
    this.host.innerHTML = `<div class="panel-head"><span class="eyebrow">${coop ? 'ОБЩИЙ ФРОНТ · 2 × 2' : 'ДУЭЛЬ · 1 × 1'}</span><button data-net="close" aria-label="Скрыть">×</button></div><div class="net-room-heading"><div><span class="net-step">02 / ПРИГЛАСИТЕ ДРУГА</span><h2>Ваша комната</h2></div><span class="net-room-code">${escape(room.code)}</span></div><p class="net-room-mode">${coop ? `Четыре города · два союзника против двух ботов · ${escape(DIFFICULTY[room.difficulty]?.name || '')}` : 'Равные ресурсы. Каждый защищает свой город.'}</p><div class="net-invitation"><label for="net-invite-link">Ссылка для второго игрока<input id="net-invite-link" value="${escape(invite)}" readonly aria-label="Ссылка приглашения"></label><button data-net="copy" class="net-secondary" ${!invite || this.invitePending ? 'disabled' : ''}>Копировать ссылку</button><p class="net-share-note">${this.invitePending ? 'Готовим ссылку приглашения…' : inviteError ? escape(inviteError) : local ? 'Сейчас ссылка локальная. Для друга из другой сети запустите режим игры по интернету.' : 'Друг открывает ссылку и нажимает «Войти». Сервер должен оставаться включённым.'}</p></div><div class="net-players">${room.players.map((player, i) => `<div class="${player?.ready ? 'is-ready' : ''}"><span class="net-seat">0${i + 1}</span><div><b>${escape(player?.name || 'Ждём второго игрока')}${i === session.seat ? ' · вы' : ''}</b><small>${player ? (player.connected ? (player.ready ? 'Готов к началу' : 'Подключён · ожидаем готовность') : 'Связь потеряна') : 'Отправьте другу ссылку выше'}</small></div><i>${player?.connected ? (player.ready ? '✓' : '●') : '○'}</i></div>`).join('')}</div>${room.phase === 'waiting' ? `<button data-net="ready" class="primary">${self?.ready ? 'Отменить готовность' : 'Я готов'}</button>${session.seat === 0 ? `<button data-net="start" class="net-start" ${ready ? '' : 'disabled'}>Начать матч${ready ? ' ↗' : ' · ждём готовность обоих'}</button>` : '<p class="small-muted">Создатель начнёт матч, когда оба игрока будут готовы.</p>'}` : '<p>Матч уже идёт. Меню можно закрыть.</p>'}<button data-net="leave" class="net-leave">Выйти из комнаты</button><p id="net-error" role="status" aria-live="polite"></p>`;
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
