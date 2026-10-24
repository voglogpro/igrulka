// An explicit registry for data-action buttons. Dataset-specific controls (recruit,
// tech, building IDs) remain independent and may coexist on the same button.
export function createActionRouter(entries = {}) {
  const handlers = new Map(Object.entries(entries));
  return {
    register(name, handler) {
      if (handlers.has(name)) throw Error(`Повторное действие: ${name}`);
      if (typeof handler !== 'function') throw TypeError('Нужен обработчик действия');
      handlers.set(name, handler);
    },
    dispatch(name, button, event) {
      return handlers.get(name)?.(button, event);
    },
    names: () => [...handlers.keys()],
  };
}
