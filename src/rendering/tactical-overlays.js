import * as T from '../../vendor/three/three.module.js';
import * as E from '../game/index.js';
// One persistent route and two rings. Moving the cursor never allocates GPU objects.
export class TacticalView {
  constructor(world) {
    this.world = world;
    this.orders = new T.Group();
    this.orders.visible = false;
    world.scene.add(this.orders);
    this.positions = new Float32Array(65 * 3);
    this.distances = new Float32Array(65);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'lineDistance',
      new T.BufferAttribute(this.distances, 1).setUsage(T.DynamicDrawUsage),
    );
    this.route = new T.Line(
      geometry,
      new T.LineDashedMaterial({
        color: '#efbc96',
        dashSize: 6,
        gapSize: 4,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        toneMapped: false,
      }),
    );
    this.route.frustumCulled = false;
    this.orders.add(this.route);
    const ringGeo = new T.RingGeometry(0.974, 1, 96);
    const ring = (color) => {
      const m = new T.Mesh(
        ringGeo,
        new T.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          side: T.DoubleSide,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 25;
      this.orders.add(m);
      return m;
    };
    this.targetRing = ring('#efbc96');
    this.sourceRing = ring('#addfc0');
    this.sourceRing.scale.setScalar(15);
    this.fill = new T.Mesh(
      new T.CircleGeometry(1, 64),
      new T.MeshBasicMaterial({
        color: '#efbc96',
        transparent: true,
        opacity: 0.06,
        side: T.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.fill.rotation.x = -Math.PI / 2;
    this.fill.renderOrder = 24;
    this.orders.add(this.fill);
    this.markers = new T.InstancedMesh(
      new T.RingGeometry(2.5, 3.2, 20),
      new T.MeshBasicMaterial({
        color: '#e3c19b',
        side: T.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      }),
      10,
    );
    this.markers.frustumCulled = false;
    this.orders.add(this.markers);
    this.dummy = new T.Object3D();
    this.groundPositions = new Float32Array(256 * 3);
    const gg = new T.BufferGeometry();
    gg.setAttribute(
      'position',
      new T.BufferAttribute(this.groundPositions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.groundRoute = new T.Line(
      gg,
      new T.LineBasicMaterial({
        color: '#9fdbba',
        transparent: true,
        opacity: 0.55,
        depthTest: false,
      }),
    );
    this.groundRoute.frustumCulled = false;
    world.scene.add(this.groundRoute);
    this.defenseLine = new T.Group();
    this.defenseLine.visible = false;
    world.scene.add(this.defenseLine);
    const lineGeometry = new T.BufferGeometry();
    lineGeometry.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
    this.postLine = new T.Line(
      lineGeometry,
      new T.LineBasicMaterial({ color: '#b9e9bb', depthTest: false }),
    );
    this.postLine.frustumCulled = false;
    this.postMarkers = new T.InstancedMesh(
      new T.RingGeometry(2.2, 2.8, 20),
      new T.MeshBasicMaterial({ color: '#ffffff', side: T.DoubleSide, depthTest: false }),
      120,
    );
    this.postMarkers.frustumCulled = false;
    this.defenseLine.add(this.postLine, this.postMarkers);
  }
  previewDefenseLine(a, b, ids = []) {
    this.postsSignature = '';
    this.defenseLine.visible = !!a && !!b;
    if (!this.defenseLine.visible) return;
    this.postLine.visible = true;
    const units = this.world.state.groundUnits.filter(
      (u) => ids.includes(u.id) && u.hp > 0 && !u.carrierId,
    );
    const positions = this.postLine.geometry.attributes.position;
    positions.setXYZ(0, a.x, 2.8, a.z);
    positions.setXYZ(1, b.x, 2.8, b.z);
    positions.needsUpdate = true;
    this.postMarkers.count = Math.min(units.length, 120);
    for (let i = 0; i < this.postMarkers.count; i++) {
      const t = units.length === 1 ? 0.5 : i / (units.length - 1);
      const x = a.x + (b.x - a.x) * t,
        z = a.z + (b.z - a.z) * t;
      this.dummy.position.set(x, 2.8, z);
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.postMarkers.setMatrixAt(i, this.dummy.matrix);
      this.postMarkers.setColorAt(
        i,
        new T.Color(
          E.walkable(this.world.state, x, z, E.GROUND_UNITS[units[i].key].size * 0.42)
            ? '#b9e9bb'
            : '#e7997a',
        ),
      );
    }
    this.postMarkers.instanceMatrix.needsUpdate = true;
    if (this.postMarkers.instanceColor) this.postMarkers.instanceColor.needsUpdate = true;
  }
  showGuardPosts(units) {
    const posts = units.filter((u) => u.guard && !u.carrierId && u.hp > 0);
    const signature = posts.map((u) => `${u.id}:${u.guard.x}:${u.guard.z}`).join('/');
    this.defenseLine.visible = posts.length > 0;
    this.postLine.visible = false;
    if (signature === this.postsSignature) return;
    this.postsSignature = signature;
    this.postMarkers.count = Math.min(posts.length, 120);
    for (let i = 0; i < this.postMarkers.count; i++) {
      this.dummy.position.set(posts[i].guard.x, 2.8, posts[i].guard.z);
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.setScalar(0.75);
      this.dummy.updateMatrix();
      this.postMarkers.setMatrixAt(i, this.dummy.matrix);
      this.postMarkers.setColorAt(i, this.postLine.material.color);
    }
    this.postMarkers.instanceMatrix.needsUpdate = true;
    if (this.postMarkers.instanceColor) this.postMarkers.instanceColor.needsUpdate = true;
  }
  previewGround(u) {
    this.groundRoute.visible = !!u?.path?.length;
    if (!this.groundRoute.visible) return;
    const points = [u, ...u.path].slice(0, 256);
    for (let i = 0; i < points.length; i++)
      this.groundPositions.set([points[i].x, 2.8, points[i].z], i * 3);
    this.groundRoute.geometry.setDrawRange(0, points.length);
    this.groundRoute.geometry.attributes.position.needsUpdate = true;
  }
  previewTactical(unit, aim) {
    if (!unit || !aim) return;
    this.orders.visible = true;
    this.orderSignature = 'fpv';
    const total = Math.hypot(unit.x - aim.x, unit.z - aim.z),
      valid = total <= 320,
      color = valid ? '#b6dba2' : '#e69c7e';
    this.route.material.color.set(color);
    this.targetRing.material.color.set(color);
    this.fill.material.color.set(color);
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      this.positions.set(
        [
          unit.x + (aim.x - unit.x) * t,
          Math.min(18, 4 + total * t * 0.5, 4 + total * (1 - t) * 0.5),
          unit.z + (aim.z - unit.z) * t,
        ],
        i * 3,
      );
      this.distances[i] = total * t;
    }
    this.route.geometry.attributes.position.needsUpdate = true;
    this.route.geometry.attributes.lineDistance.needsUpdate = true;
    this.targetRing.position.set(aim.x, 1.5, aim.z);
    this.targetRing.scale.setScalar(10);
    this.fill.position.copy(this.targetRing.position);
    this.fill.scale.setScalar(10);
    this.sourceRing.position.set(unit.x, 1.5, unit.z);
    this.sourceRing.scale.setScalar(5);
    this.markers.count = 0;
  }
  preview(order) {
    const s = this.world.state,
      origin = order && E.selectedLaunchSite(s, 0, order.siteId),
      aim = order && E.resolveAim(s, 0, order.aim);
    const signature =
      origin && aim
        ? `${origin.id}/${order.key}/${aim.x.toFixed(1)}/${aim.z.toFixed(1)}/${JSON.stringify(aim.waypoints)}/${s.sides[0].inventory[order.key]}`
        : '';
    if (signature === this.orderSignature) return;
    this.orderSignature = signature;
    this.orders.visible = !!signature;
    if (!signature) return;
    const d = E.WEAPONS[order.key],
      color = E.launchStatus(s, 0, order.key, aim, order.siteId) ? '#d98b78' : '#efbc96';
    this.route.material.color.set(color);
    this.targetRing.material.color.set(color);
    this.fill.material.color.set(color);
    const route = E.flightRoute(origin, aim, order.key),
      total = route.at(-1).d;
    let previous = null;
    for (let i = 0; i <= 64; i++) {
      const p = E.routePoint(origin, aim, order.key, i / 64);
      if (aim.waypoints?.length) {
        const q = E.pointOnRoute(route, (total * i) / 64);
        p.x = q.x;
        p.z = q.z;
        if (order.key !== 'ballistic')
          p.y = Math.min(
            d.altitude,
            5 + ((total * i) / 64) * 0.48,
            5 + total * (1 - i / 64) * 0.48,
          );
      }
      this.positions.set([p.x, p.y + 2, p.z], i * 3);
      this.distances[i] = i
        ? this.distances[i - 1] + Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z)
        : 0;
      previous = p;
    }
    this.route.geometry.attributes.position.needsUpdate = true;
    this.route.geometry.attributes.lineDistance.needsUpdate = true;
    const markers = order.key === 'ballistic' ? [] : aim.waypoints || [];
    this.markers.count = markers.length;
    for (let i = 0; i < markers.length; i++) {
      this.dummy.position.set(markers[i].x, 1.7, markers[i].z);
      this.dummy.rotation.x = -Math.PI / 2;
      this.dummy.updateMatrix();
      this.markers.setMatrixAt(i, this.dummy.matrix);
    }
    this.markers.instanceMatrix.needsUpdate = true;
    this.targetRing.position.set(aim.x, 1.5, aim.z);
    this.targetRing.scale.setScalar(d.blast);
    this.fill.position.copy(this.targetRing.position);
    this.fill.scale.setScalar(d.blast);
    this.sourceRing.position.set(origin.x, 1.5, origin.z);
  }
}
