export function syncContacts() {
  const contacts = this.state.contacts?.[0] || [];
  this.contactRings.count = Math.min(300, contacts.length);
  for (let i = 0; i < this.contactRings.count; i++) {
    const c = contacts[i];
    this.contactDummy.position.set(c.x, 1.5, c.z);
    this.contactDummy.rotation.set(-Math.PI / 2, 0, 0);
    this.contactDummy.scale.setScalar(c.radius);
    this.contactDummy.updateMatrix();
    this.contactRings.setMatrixAt(i, this.contactDummy.matrix);
  }
  this.contactRings.instanceMatrix.needsUpdate = true;
}
