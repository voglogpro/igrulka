// Models point along local +Z. A zero velocity component is still a valid heading.
export function aircraftAttitude(u) {
  let vx = Number.isFinite(u.vx) ? u.vx : 0;
  let vz = Number.isFinite(u.vz) ? u.vz : 0;
  if (Math.hypot(vx, vz) < 0.0001) {
    const route = u.route || [];
    const distance = u.travelled || 0;
    const end = route.findIndex((p, i) => i > 0 && p.d > distance + 0.001);
    if (end > 0) {
      vx = route[end].x - route[end - 1].x;
      vz = route[end].z - route[end - 1].z;
    } else {
      vx = (u.tx ?? u.x) - u.x;
      vz = (u.tz ?? u.z) - u.z;
    }
  }
  return {
    yaw: Math.atan2(vx, vz),
    pitch: -Math.atan2(u.vy || 0, Math.hypot(u.vx || 0, u.vz || 0) || Math.hypot(vx, vz) || 1),
  };
}
