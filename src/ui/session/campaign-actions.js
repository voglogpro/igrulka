// File/download effects are injected; importing this module has no DOM or storage side effects.
export function createCampaignActions({
  game,
  getState,
  isNetwork,
  getDifficulty,
  persist,
  replaceCampaign,
  toast,
  files,
}) {
  const soloOnly =
    (action) =>
    (...args) => {
      if (isNetwork()) {
        toast('Сначала завершите сетевую сессию');
        return;
      }
      return action(...args);
    };
  return {
    actions: {
      save: () => {
        persist();
        toast(isNetwork() ? 'Матч хранится на сервере во время сессии' : 'Сохранено');
      },
      export: soloOnly(() => {
        const state = getState();
        persist();
        files.download(game.save(state), `skyfront-city-${Math.floor(state.time)}.json`);
      }),
      import: soloOnly(() => files.choose()),
      'new-confirm': soloOnly((button) => {
        button.dataset.action = 'new';
        button.textContent = 'Подтвердить новую игру';
      }),
      new: soloOnly(() =>
        replaceCampaign(game.createGame(undefined, { difficulty: getDifficulty() })),
      ),
    },
    async importFile(event) {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (file.size > 5e6) throw Error('Файл слишком большой');
        const imported = game.load(await file.text());
        replaceCampaign(imported);
      } catch (error) {
        toast(error.message, true);
      }
      event.target.value = '';
    },
  };
}

export function browserCampaignFiles({
  document,
  input,
  url = URL,
  makeBlob = (raw) => new Blob([raw], { type: 'application/json' }),
  schedule = setTimeout,
}) {
  return {
    choose: () => input.click(),
    download(raw, filename) {
      const address = url.createObjectURL(makeBlob(raw)),
        link = document.createElement('a');
      link.href = address;
      link.download = filename;
      link.click();
      schedule(() => url.revokeObjectURL(address), 2000);
    },
  };
}
