export function event(s, type, data = {}) {
  s.events.push({ id: s.nextId++, type, time: s.time, ...data });
  if (s.events.length > 260) s.events.splice(0, s.events.length - 260);
}

export function log(s, text) {
  s.log.unshift({ time: s.time, text });
  s.log = s.log.slice(0, 16);
}
