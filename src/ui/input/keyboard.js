// Capture handles army groups and Escape before the camera sees the event. Bubble
// handles global panels/strike shortcuts; camera movement keys deliberately pass through.
export function createKeyboardController({
  getMode,
  army,
  tools,
  strike,
  focusInput,
  now = () => performance.now(),
  createChangeEvent = () => new Event('change', { bubbles: true }),
}) {
  let lastGroupTap = { n: 0, at: 0 };
  const capture = (e) => {
    const { started, panel, lobbyOpen, tool, aiming, armySelection } = getMode();

    if (!started || e.repeat) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (tool || aiming) tools.cancelTool();
      else {
        tools.clearInspection();
      }
      army.clearArmySelection();
      army.clearTroopTarget();
      focusInput();
      return;
    }
    if (
      e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
    ) {
      if (e.code === 'Enter' && e.target.matches('input[type="number"]')) {
        e.preventDefault();
        e.target.dispatchEvent(createChangeEvent());
        focusInput();
      }
      return;
    }
    if (!started || panel === 'settings' || lobbyOpen) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && (e.ctrlKey || army.getGroup(Number(digit[1])).length)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const n = Number(digit[1]);
      if (e.ctrlKey) {
        if (armySelection.length) {
          const ids = [
            ...new Set(e.shiftKey ? [...army.getGroup(n), ...armySelection] : armySelection),
          ];
          army.saveGroup(n, ids);
        }
      } else {
        const ids = army.getGroup(n),
          timestamp = now();
        // A second tap of the same group key centres the camera on it.
        if (!e.shiftKey && lastGroupTap.n === n && timestamp - lastGroupTap.at < 400)
          army.focusUnits(ids);
        lastGroupTap = { n, at: timestamp };
        army.selectArmy(ids, e.shiftKey);
      }
      return;
    }
    if (e.code === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      army.cycleArmy(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.code === 'Period' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      army.nextIdleUnit();
      return;
    }
    if (e.code === 'Home' && armySelection.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      army.focusUnits(armySelection);
      return;
    }
    if (e.ctrlKey && e.code === 'KeyA') {
      e.preventDefault();
      e.stopImmediatePropagation();
      army.selectAll();
      return;
    }
    const command = {
      KeyH: 'dig',
      KeyK: 'camo',
      KeyY: 'fire',
      KeyT: 'retreat',
      KeyU: 'unload',
      KeyM: 'attackmove',
      KeyQ: 'fpv',
      KeyL: 'defendline',
    }[e.code];
    if (command && armySelection.length && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      army.troopCommand(command);
    }
  };
  const bubble = (e) => {
    const { started, panel, lobbyOpen, paused, aiming } = getMode();

    if (!started || panel === 'settings' || lobbyOpen) return;
    if (
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.target.closest?.(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      ) ||
      e.repeat
    )
      return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (started) tools.pause(!paused);
    }
    if (aiming && e.code === 'Enter') {
      strike.finishRoute();
    }
    if (aiming && e.code === 'Backspace') {
      e.preventDefault();
      strike.undoWaypoint();
    }
    const quick = { KeyZ: 'drone', KeyX: 'heavy', KeyC: 'cruise', KeyV: 'ballistic' }[e.code];
    if (quick && started) strike.armStrike(quick);
    if (e.code === 'KeyB' && started) tools.openPanel('army');
    // E opens production and raids; F opens the army. N remains an arsenal alias.
    if (e.code === 'KeyE') tools.openPanel('attack');
    if (e.code === 'KeyF' && started) tools.openPanel('army');
    if (e.code === 'KeyN') tools.openPanel('attack');
    const key = {
      KeyG: 'road',
      Digit1: 'housing',
      Digit2: 'industry',
      Digit3: 'power',
      Digit4: 'gun',
      Digit5: 'launcher',
    }[e.code];
    if (key && started) tools.chooseBuild(key);
  };
  return { capture, bubble };
}

export function bindKeyboard(target, controller) {
  target.addEventListener('keydown', controller.capture, true);
  target.addEventListener('keydown', controller.bubble);
  return () => {
    target.removeEventListener('keydown', controller.capture, true);
    target.removeEventListener('keydown', controller.bubble);
  };
}
