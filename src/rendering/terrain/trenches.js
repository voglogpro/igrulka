// Compatibility entry for the world sync; each defensive overlay has its own owner.
import { syncContacts } from '../defense/contacts.js';
export function syncTrenches() {
  if (this.fortifications.sync(this.state)) this.renderer.shadowMap.needsUpdate = true;
  syncContacts.call(this);
}
