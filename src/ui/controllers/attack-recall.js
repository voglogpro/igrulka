export function createAttackRecallAction({ getEpoch, execute, persist, refresh, toast }) {
  let pending = null;
  return async (button) => {
    const epoch = getEpoch();
    if (pending?.epoch === epoch) return;
    const request = { epoch };
    pending = request;
    button.dataset.pending = 'true';
    button.disabled = true;
    try {
      const result = await execute('attack-recall', {});
      if (epoch !== getEpoch()) return;
      if (typeof result === 'string') toast(result, true);
      else {
        persist();
        toast(`Возвращаются к обороне: ${result}`);
      }
    } catch {
      if (epoch === getEpoch())
        toast('Не удалось отозвать войска. Повторите после восстановления связи.', true);
    } finally {
      if (pending === request) pending = null;
      delete button.dataset.pending;
      if (epoch === getEpoch()) refresh();
    }
  };
}
