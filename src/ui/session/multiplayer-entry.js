import { multiplayerEntry } from '../../network/invite.js';

// Run once after the application and its callbacks are fully initialized. An
// invitation opens a prefilled form; it never joins, readies or starts a match.
export function openMultiplayerEntry({ pageURL, lobby, onError }) {
  try {
    const entry = multiplayerEntry(pageURL);
    if (entry?.kind === 'join') lobby.openInvite(entry.invite, { autoJoin: false });
    else if (entry?.kind === 'create') lobby.open({ address: entry.address });
    return entry;
  } catch (error) {
    onError(error.message);
    return null;
  }
}
