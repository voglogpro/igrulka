// Browser persistence belongs here; the simulation's save format stays in game/persistence.
export const SAVE = 'skyfront-realtime-v3';
export const SETTINGS = 'skyfront-settings-v4';

export function loadCampaign(storage, game) {
  let state,
    resumed = false,
    loadNotice = '';
  try {
    const raw = storage.getItem(SAVE);
    if (raw) {
      state = game.load(raw);
      resumed = state.time > 0 || state.buildings.length > 2;
      if (JSON.parse(raw).version < 10 && !storage.getItem(SAVE + '-before-deployment10')) {
        storage.setItem(SAVE + '-before-deployment10', raw);
        loadNotice =
          'Пополнение обновлено: выберите тип бойца и укажите место назначения на карте.';
      }
      if (JSON.parse(raw).version < 9 && !storage.getItem(SAVE + '-before-districts9')) {
        storage.setItem(SAVE + '-before-districts9', raw);
        loadNotice =
          'Открыты стратегические районы: захватывайте пехотой, защищайте доход и инфраструктуру.';
      }
      if (JSON.parse(raw).version < 8) {
        storage.setItem(SAVE + '-before-infantry8', raw);
        loadNotice = 'Пехота и группы обновлены. Старые пушки заменены на МОГ с компенсацией.';
      }
      if (JSON.parse(raw).version === 6) {
        storage.setItem(SAVE + '-before-army7', raw);
        loadNotice = 'Кампания обновлена: армия, маршруты, перегрев ПВО и смена суток.';
      }
      if (JSON.parse(raw).version < 6) {
        storage.setItem(SAVE + '-before-combat6', raw);
        loadNotice =
          'Карта полностью открыта. Разведчики убраны, ресурсы возвращены. Сохранение обновлено.';
      }
      if (JSON.parse(raw).version === 4) {
        storage.setItem(SAVE + '-before-recon', raw);
      }
      if (JSON.parse(raw).version === 3) {
        storage.setItem(SAVE + '-before-roads', raw);
        loadNotice = 'Дорожная система обновлена. Подведите улицы к старым предприятиям.';
      }
    }
  } catch {
    loadNotice = 'Не удалось прочитать кампанию. Предыдущее сохранение оставлено в браузере.';
  }
  state ||= game.createGame();
  return { state, resumed, loadNotice };
}

export function loadSettings(storage) {
  const settings = { sound: true, volume: 0.35, shake: 0.45 };
  try {
    Object.assign(settings, JSON.parse(storage.getItem(SETTINGS) || '{}'));
  } catch {}
  return settings;
}

export function createCampaignStore({ storage, game, notify, reload }) {
  let replacing = false;
  return {
    get replacing() {
      return replacing;
    },
    persist(state, network = false) {
      if (replacing || network) return;
      try {
        storage.setItem(SAVE, game.save(state));
      } catch {
        notify('Не удалось сохранить. Экспортируйте кампанию в настройках.', true);
      }
    },
    replace(next, current, network, beforeReload) {
      if (network) {
        notify('Сначала завершите сетевую сессию');
        return;
      }
      if (replacing) return;
      try {
        const previous = game.save(current),
          replacement = game.save(next);
        storage.setItem(SAVE + '-backup', previous);
        storage.setItem(SAVE, replacement);
      } catch {
        notify(
          'Не удалось записать новую кампанию. Экспортируйте сохранение и проверьте доступ к хранилищу.',
          true,
        );
        return;
      }
      replacing = true;
      beforeReload();
      reload();
    },
    saveSettings(settings, audio) {
      storage.setItem(SETTINGS, JSON.stringify(settings));
      audio.set(settings.sound, settings.volume);
    },
  };
}
