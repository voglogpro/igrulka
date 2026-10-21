import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { createGame, step } from '../src/game/index.js';
import { executeCommand, PROTOCOL_VERSION } from '../src/network/commands.js';
import { playerView } from '../src/network/perspective.js';
import { createGameServer } from '../scripts/dev-server.mjs';

const codePattern = /^[A-HJ-NP-Z2-9]{6}$/;
const code = () =>
  [...randomBytes(6)].map((n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');
const name = (value) =>
  typeof value === 'string' ? value.trim().slice(0, 24) || 'Командир' : 'Командир';
const send = (socket, value) => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount >= 2_000_000) {
    socket.close(1013, 'Connection too slow');
    return;
  }
  socket.send(JSON.stringify(value));
};

export function createRoomServer({
  autoTick = true,
  seed = 1022,
  maxRooms = 16,
  now = () => Date.now(),
} = {}) {
  const http = createGameServer();
  const wss = new WebSocketServer({
    server: http,
    path: '/match',
    maxPayload: 16_384,
    perMessageDeflate: false,
  });
  const rooms = new Map();
  let closed = false;

  function meta(room) {
    const connected = room.players
      .filter(Boolean)
      .every((p) => p.socket?.readyState === WebSocket.OPEN);
    return {
      code: room.code,
      phase: !room.started
        ? 'waiting'
        : room.state.result
          ? 'finished'
          : connected
            ? 'playing'
            : 'disconnected',
      players: room.players.map((p) =>
        p
          ? { name: p.name, ready: p.ready, connected: p.socket?.readyState === WebSocket.OPEN }
          : null,
      ),
    };
  }
  function broadcast(room, snapshots = false) {
    const status = meta(room);
    for (let side = 0; side < 2; side++) {
      const p = room.players[side];
      if (!p?.socket) continue;
      send(p.socket, {
        type: snapshots ? 'snapshot' : 'room',
        room: status,
        tick: room.tick,
        ...(snapshots && room.started ? { state: playerView(room.state, side) } : {}),
      });
    }
  }
  function attach(socket, room, side, player) {
    socket.roomCode = room.code;
    socket.playerSide = side;
    player.socket = socket;
    socket.lastSequence = player.lastSequence || 0;
    player.disconnectedAt = null;
    room.players[side] = player;
    send(socket, {
      type: 'joined',
      protocol: PROTOCOL_VERSION,
      lastSequence: socket.lastSequence,
      token: player.token,
      side,
      room: meta(room),
    });
    broadcast(room, room.started);
  }
  function endRoom(room, reason) {
    for (const p of room.players) {
      if (!p?.socket) continue;
      send(p.socket, { type: 'closed', message: reason });
      p.socket.roomCode = null;
    }
    rooms.delete(room.code);
  }
  function error(socket, message) {
    send(socket, { type: 'error', message });
  }

  wss.on('connection', (socket) => {
    if (closed || wss.clients.size > 64) {
      socket.close(1013, 'Server full');
      return;
    }
    socket.alive = true;
    socket.lastSequence = 0;
    socket.messageWindow = now();
    socket.messageCount = 0;
    socket.badMessages = 0;
    socket.on('pong', () => {
      socket.alive = true;
    });
    socket.on('error', () => {});
    socket.on('message', (raw, binary) => {
      try {
        if (now() - socket.messageWindow >= 1000) {
          socket.messageWindow = now();
          socket.messageCount = 0;
        }
        if (++socket.messageCount > 40) {
          socket.close(1008, 'Rate limit');
          return;
        }
        if (binary) throw Error('Требуется JSON');
        const message = JSON.parse(raw.toString());
        if (!message || typeof message !== 'object' || Array.isArray(message))
          throw Error('Некорректное сообщение');
        if (message.protocol != null && message.protocol !== PROTOCOL_VERSION)
          throw Error('Версии игры не совпадают');
        if (message.type === 'ping') {
          send(socket, { type: 'pong', clientTime: message.clientTime });
          return;
        }
        let room = rooms.get(socket.roomCode);
        if (message.type === 'create') {
          if (room) throw Error('Сначала выйдите из текущей комнаты');
          if (rooms.size >= maxRooms) throw Error('На сервере нет свободных комнат');
          let roomCode;
          do {
            roomCode = code();
          } while (rooms.has(roomCode));
          const state = createGame(seed);
          state.mode = 'multiplayer';
          room = {
            code: roomCode,
            state,
            players: [null, null],
            started: false,
            tick: 0,
            createdAt: now(),
          };
          rooms.set(roomCode, room);
          attach(socket, room, 0, {
            name: name(message.name),
            token: randomBytes(24).toString('hex'),
            ready: false,
          });
          return;
        }
        if (message.type === 'join' || message.type === 'resume') {
          if (room) throw Error('Вы уже в комнате');
          if (!codePattern.test(message.code)) throw Error('Некорректный код комнаты');
          room = rooms.get(message.code);
          if (!room) throw Error('Комната не найдена');
          if (message.type === 'resume') {
            const side = room.players.findIndex(
              (p) => p && typeof message.token === 'string' && p.token === message.token,
            );
            if (side < 0) throw Error('Не удалось восстановить место игрока');
            const p = room.players[side];
            if (p.socket?.readyState === WebSocket.OPEN) throw Error('Это место уже подключено');
            attach(socket, room, side, p);
          } else {
            if (room.started || room.players[1]) throw Error('Комната заполнена');
            attach(socket, room, 1, {
              name: name(message.name),
              token: randomBytes(24).toString('hex'),
              ready: false,
            });
          }
          return;
        }
        if (!room) throw Error('Сначала создайте комнату или присоединитесь');
        const side = socket.playerSide,
          player = room.players[side];
        if (!player || player.socket !== socket) throw Error('Подключение потеряло место');
        if (message.type === 'leave') {
          endRoom(room, 'Один из игроков завершил сессию');
          return;
        }
        if (message.type === 'ready') {
          if (room.started || typeof message.value !== 'boolean')
            throw Error('Нельзя менять готовность');
          player.ready = message.value;
          broadcast(room);
          return;
        }
        if (message.type === 'start') {
          if (
            side !== 0 ||
            room.started ||
            !room.players.every((p) => p?.ready && p.socket?.readyState === WebSocket.OPEN)
          )
            throw Error('Нужна готовность обоих игроков');
          room.started = true;
          broadcast(room, true);
          return;
        }
        if (message.type === 'command') {
          if (!Number.isSafeInteger(message.sequence) || message.sequence <= socket.lastSequence)
            throw Error('Повторная или некорректная команда');
          socket.lastSequence = message.sequence;
          player.lastSequence = message.sequence;
          if (!room.started || meta(room).phase !== 'playing') {
            send(socket, {
              type: 'ack',
              sequence: message.sequence,
              error: 'Матч ещё не начат или соперник отключён',
            });
            return;
          }
          const result = executeCommand(room.state, side, message.command, message.args);
          send(socket, {
            type: 'ack',
            sequence: message.sequence,
            ...(typeof result === 'string' ? { error: result } : { result }),
            room: meta(room),
            tick: room.tick,
            state: playerView(room.state, side),
          });
          return;
        }
        throw Error('Неизвестный тип сообщения');
      } catch (cause) {
        error(socket, cause.message || 'Некорректное сообщение');
        if (++socket.badMessages >= 5) socket.close(1008, 'Invalid messages');
      }
    });
    socket.on('close', () => {
      const room = rooms.get(socket.roomCode),
        player = room?.players[socket.playerSide];
      if (player?.socket === socket) {
        player.socket = null;
        player.disconnectedAt = now();
        broadcast(room, room.started);
      }
    });
  });
  function tick() {
    for (const room of rooms.values()) {
      if (room.started && meta(room).phase === 'playing') {
        step(room.state, 0.05);
        room.tick++;
        if (room.tick % 2 === 0 || room.state.result) broadcast(room, true);
      }
      if (
        room.players.every((p) => !p?.socket) &&
        now() -
          Math.max(
            room.createdAt,
            ...room.players.map((p) => p?.disconnectedAt || room.createdAt),
          ) >
          15 * 60_000
      )
        endRoom(room, 'Срок ожидания истёк');
    }
  }
  const timer = autoTick ? setInterval(tick, 50) : null;
  timer?.unref();
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.alive) {
        socket.terminate();
        continue;
      }
      socket.alive = false;
      socket.ping();
    }
  }, 5000);
  heartbeat.unref();
  return {
    http,
    wss,
    rooms,
    tick,
    async close() {
      closed = true;
      clearInterval(timer);
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
      if (http.listening) await new Promise((resolve) => http.close(resolve));
    },
  };
}
