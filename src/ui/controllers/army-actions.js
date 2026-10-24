// An army action receives selection and revision readers, never the entire app closure.
export function createAutoDefenseAction({
  getSelection,
  getEpoch,
  getRevision,
  execute,
  persist,
  renderInspector,
  toast,
}) {
  return async (button) => {
    const epoch = getEpoch(),
      revision = getRevision();
    const result = await execute('auto-defense', {
      ids: [...getSelection()],
      enabled: button.dataset.enabled === 'true',
    });
    if (epoch !== getEpoch()) return;
    if (typeof result === 'string') toast(result, true);
    else {
      persist();
      if (revision === getRevision()) renderInspector();
    }
  };
}
