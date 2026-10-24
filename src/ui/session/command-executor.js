// Replies from a previous campaign or WebSocket cannot change the current UI.
export function createCommandExecutor({ getState, getSession, getEpoch, executeLocal }) {
  return async (type, args) => {
    const epoch = getEpoch(),
      session = getSession();
    const result = session
      ? await session.command(type, args)
      : executeLocal(getState(), 0, type, args);
    return epoch === getEpoch() && session === getSession()
      ? result
      : 'Команда относится к завершённой сессии';
  };
}
