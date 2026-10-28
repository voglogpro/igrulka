import { FIELD } from '../game/map.js';
import * as E from '../game/index.js';

// Equipment quotes and the army-wave command must match the client's rules.
export const PROTOCOL_VERSION = 14;
const own = (s, side, id) => E.targetById(s, id)?.side === side;
const validId = (id) => Number.isSafeInteger(id) && id > 0;
const point = (p) =>
  object(p) &&
  Object.hasOwn(p, 'x') &&
  Object.hasOwn(p, 'z') &&
  [p.x, p.z].every(Number.isFinite) &&
  Math.abs(p.x) <= FIELD.x &&
  Math.abs(p.z) <= FIELD.z;
const ids = (list) =>
  Array.isArray(list) &&
  list.length > 0 &&
  list.length <= E.GROUND_COMMAND_LIMIT &&
  list.every(validId) &&
  new Set(list).size === list.length;
const unitsOwned = (s, side, list) => {
  if (!ids(list)) return false;
  const owned = new Set();
  for (const unit of s.groundUnits) if (unit.side === side && unit.hp > 0) owned.add(unit.id);
  return list.every((id) => owned.has(id));
};
const object = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const invalid = 'Некорректная команда';
const configured = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);

// One allowlist for local play and the authoritative server. Clients cannot set state or choose a side.
export function executeCommand(s, side, type, a = {}) {
  if (!E.validSide(s, side) || !object(a) || typeof type !== 'string') return invalid;
  if (s.result) return 'Матч завершён';
  switch (type) {
    case 'build':
      if (!configured(E.BUILDINGS, a.key) || !point(a) || !Number.isFinite(a.rotation ?? 0))
        return invalid;
      return E.build(s, side, a.key, a.x, a.z, a.rotation ?? 0);
    case 'road':
      if (!point(a.a) || !point(a.b)) return invalid;
      return E.buildRoad(s, side, a.a.x, a.a.z, a.b.x, a.b.z);
    case 'repair':
    case 'demolish':
    case 'upgrade':
    case 'redeploy':
      if (!validId(a.id) || !own(s, side, a.id)) return 'Объект вам не принадлежит';
      if (type === 'repair') return E.repair(s, a.id, side);
      if (type === 'demolish') return E.demolish(s, a.id, side);
      if (type === 'upgrade') return E.upgradeDefense(s, side, a.id);
      return E.redeployMOG(s, side, a.id);
    case 'produce':
      return configured(E.WEAPONS, a.key) ? E.produce(s, side, a.key) : invalid;
    case 'factory-plan':
      return validId(a.id) && own(s, side, a.id) && object(a.plan)
        ? E.setFactoryPlan(s, side, a.id, a.plan)
        : invalid;
    case 'research':
      return configured(E.TECH, a.key) ? E.research(s, side, a.key) : invalid;
    case 'launch': {
      if (
        !configured(E.WEAPONS, a.key) ||
        !point(a.aim) ||
        !Number.isInteger(a.count) ||
        a.count < 1 ||
        a.count > 6
      )
        return invalid;
      if (a.siteId != null && (!validId(a.siteId) || !own(s, side, a.siteId)))
        return 'Пусковая вам не принадлежит';
      if (
        a.aim.waypoints != null &&
        (!Array.isArray(a.aim.waypoints) ||
          a.aim.waypoints.length > 10 ||
          !a.aim.waypoints.every(point))
      )
        return invalid;
      return E.launch(s, side, a.key, a.aim, a.count, a.siteId ?? null);
    }
    case 'launch-supply':
      return validId(a.id) &&
        own(s, side, a.id) &&
        configured(E.WEAPONS, a.key) &&
        Number.isInteger(a.count) &&
        a.count >= 1 &&
        a.count <= 6
        ? E.requestWeaponDelivery(s, side, a.id, a.key, a.count)
        : invalid;
    case 'army-target':
      return configured(E.GROUND_UNITS, a.key) &&
        Number.isInteger(a.count) &&
        a.count >= 0 &&
        a.count <= E.ARMY_TARGET_MAX
        ? E.setArmyTarget(s, side, a.key, a.count)
        : invalid;
    case 'ammo-factory':
      return validId(a.id) && own(s, side, a.id) && typeof a.enabled === 'boolean'
        ? E.setAmmoFactoryEnabled(s, side, a.id, a.enabled)
        : invalid;
    case 'recruit':
      if (
        !configured(E.GROUND_UNITS, a.key) ||
        !Number.isInteger(a.count) ||
        a.count < 1 ||
        a.count > 5
      )
        return invalid;
      if (a.siteId != null && (!validId(a.siteId) || !own(s, side, a.siteId)))
        return 'Казармы вам не принадлежат';
      if (a.stance != null && !E.validStance(a.stance)) return invalid;
      return E.recruit(s, side, a.key, a.siteId ?? null, a.count, a.stance ?? null);
    case 'service-enabled':
      if (!validId(a.id) || typeof a.enabled !== 'boolean') return invalid;
      if (!s.buildings.some((b) => b.id === a.id && b.side === side && b.key === 'service'))
        return 'Ремонтная служба вам не принадлежит';
      return E.setServiceEnabled(s, side, a.id, a.enabled);
    case 'rear-auto':
      if (typeof a.enabled !== 'boolean') return invalid;
      return E.setRearAutomatic(s, side, a.enabled);
    case 'support-auto':
      return unitsOwned(s, side, a.ids) && typeof a.enabled === 'boolean'
        ? E.setSupportAutomatic(s, side, a.ids, a.enabled)
        : invalid;
    case 'set-stance':
      return unitsOwned(s, side, a.ids) && a.stance && E.validStance(a.stance)
        ? E.applyStance(s, side, a.ids, a.stance)
        : invalid;
    case 'auto-defense':
      return unitsOwned(s, side, a.ids) && typeof a.enabled === 'boolean'
        ? E.setAutoDefense(s, side, a.ids, a.enabled)
        : invalid;
    case 'attack-recall':
      if (Object.keys(a).length) return invalid;
      return E.recallDefenseAttack(s, side);
    case 'defense-attack':
      if (Object.keys(a).length) return invalid;
      return E.launchDefenseAttack(s, side);
    case 'deploy': {
      if (
        !configured(E.GROUND_UNITS, a.key) ||
        !point(a.point) ||
        !Number.isInteger(a.count) ||
        a.count < 1 ||
        a.count > 5
      )
        return invalid;
      if (a.siteId != null && (!validId(a.siteId) || !own(s, side, a.siteId)))
        return 'Казармы вам не принадлежат';
      const plan = E.deploymentPlan(s, side, a.key, a.point, a.count, a.siteId ?? null);
      return plan.ok
        ? E.deployGround(s, side, a.key, plan.point, a.count, plan.siteId)
        : plan.reason;
    }
    case 'order':
      if (
        !unitsOwned(s, side, a.ids) ||
        !point(a.aim) ||
        !['move', 'attack', 'attackmove'].includes(a.aim.mode)
      )
        return invalid;
      if (
        a.aim.targetId != null &&
        (!validId(a.aim.targetId) ||
          !E.hostile(s, side, E.observedTarget(s, side, a.aim.targetId)?.side))
      )
        return 'Недоступная цель';
      {
        const result = E.orderGround(s, side, a.ids, a.aim);
        if (typeof result === 'number' && result === a.ids.length)
          E.retargetSquadReserves(s, side, a.ids, {
            ...a.aim,
            mode: a.aim.mode === 'move' ? 'move' : 'attackmove',
          });
        return result;
      }
    case 'stance':
      if (
        !unitsOwned(s, side, a.ids) ||
        !['stop', 'dig', 'camo', 'fire', 'retreat', 'unload'].includes(a.command)
      )
        return invalid;
      {
        const result = E.commandUnits(s, side, a.ids, a.command);
        if (a.command === 'stop' && typeof result === 'number')
          E.retargetSquadReserves(s, side, a.ids, null);
        return result;
      }
    case 'guard':
      if (!unitsOwned(s, side, a.ids)) return invalid;
      if (a.here === true) {
        let changed = 0;
        for (const id of a.ids) {
          const u = s.groundUnits.find((u) => u.id === id);
          if (typeof E.guardGround(s, side, [id], u) === 'number') changed++;
        }
        return changed || 'Нет доступных бойцов';
      }
      return point(a.point) ? E.guardGround(s, side, a.ids, a.point) : invalid;
    case 'defend-line':
      return unitsOwned(s, side, a.ids) && point(a.a) && point(a.b)
        ? E.defendLineGround(s, side, a.ids, a.a, a.b)
        : invalid;
    case 'board':
      return unitsOwned(s, side, a.ids) && validId(a.id) && own(s, side, a.id)
        ? E.boardGround(s, side, a.ids, a.id)
        : invalid;
    case 'deliver':
      return validId(a.id) && own(s, side, a.id) && point(a.point)
        ? E.deliverGround(s, side, a.id, a.point)
        : invalid;
    case 'route-add':
      return unitsOwned(s, side, a.ids) &&
        point(a.aim) &&
        ['move', 'attackmove'].includes(a.aim.mode)
        ? E.appendGroundOrder(s, side, a.ids, a.aim)
        : invalid;
    case 'district':
      if (!unitsOwned(s, side, a.ids) || !configured(E.DISTRICT_BY_ID, a.id)) return invalid;
      {
        const result = E.captureDistrict(s, side, a.ids, a.id);
        if (typeof result === 'number' && result === a.ids.length)
          E.retargetSquadReserves(s, side, a.ids, {
            ...E.DISTRICT_BY_ID[a.id],
            mode: 'attackmove',
          });
        return result;
      }
    case 'district-repair':
      return configured(E.DISTRICT_BY_ID, a.id) && typeof a.enabled === 'boolean'
        ? E.setDistrictRepair(s, side, a.id, a.enabled)
        : invalid;
    case 'fpv': {
      if (!unitsOwned(s, side, a.ids) || !point(a.point)) return invalid;
      const id = a.point.targetId;
      if (id != null && !validId(id)) return invalid;
      const target = id == null ? null : s.groundUnits.find((u) => u.id === id);
      if (id != null && !E.observedTarget(s, side, id)) return 'Недоступная цель FPV';
      if (target && !E.hostile(s, side, E.observedTarget(s, side, id)?.side))
        return 'Недоступная цель FPV';
      return E.launchFPV(s, side, a.ids, a.point, target?.id ?? null);
    }
    case 'rally':
    case 'rally-mode':
    case 'repeat':
      if (!validId(a.id) || !own(s, side, a.id)) return 'Казармы вам не принадлежат';
      if (type === 'rally') return point(a.point) ? E.setRally(s, side, a.id, a.point) : invalid;
      if (type === 'rally-mode')
        return ['guard', 'wait', 'attackmove'].includes(a.mode)
          ? E.setRallyMode(s, side, a.id, a.mode)
          : invalid;
      return typeof a.enabled === 'boolean' &&
        configured(E.GROUND_UNITS, a.key) &&
        (a.target == null ||
          (Number.isInteger(a.target) && a.target >= 1 && a.target <= E.ARMY_TARGET_MAX))
        ? E.setRecruitRepeat(
            s,
            side,
            a.id,
            a.key,
            a.enabled,
            a.target == null ? undefined : { target: a.target },
          )
        : invalid;
    case 'formation':
      if (!['line', 'column', 'spread'].includes(a.value)) return invalid;
      s.formations[side] = a.value;
      return true;
    case 'group':
      return Number.isInteger(a.index) &&
        a.index >= 1 &&
        a.index <= 9 &&
        Array.isArray(a.ids) &&
        (a.ids.length === 0 || unitsOwned(s, side, a.ids))
        ? E.saveGroup(s, side, a.index, a.ids)
        : invalid;
    default:
      return invalid;
  }
}
