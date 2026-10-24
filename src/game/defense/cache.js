const revisions = new WeakMap();
export const frontlineRevision = (s) => revisions.get(s) || 0;
export function invalidateFrontline(s) {
  revisions.set(s, frontlineRevision(s) + 1);
}
