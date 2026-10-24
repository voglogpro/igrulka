import { INFANTRY_TYPES } from '../infantry/types.js';
import { VEHICLE_TYPES } from '../vehicles/types.js';
export const GROUND_UNITS = {
  infantry: INFANTRY_TYPES.infantry,
  shilka: VEHICLE_TYPES.shilka,
  gepard: VEHICLE_TYPES.gepard,
  leopard: VEHICLE_TYPES.leopard,
  machinegunner: INFANTRY_TYPES.machinegunner,
  sniper: INFANTRY_TYPES.sniper,
  assault: INFANTRY_TYPES.assault,
  engineer: INFANTRY_TYPES.engineer,
  operator: INFANTRY_TYPES.operator,
  apc: VEHICLE_TYPES.apc,
  mog: INFANTRY_TYPES.mog,
  atgm: INFANTRY_TYPES.atgm,
  tankdestroyer: VEHICLE_TYPES.tankdestroyer,
  howitzer: VEHICLE_TYPES.howitzer,
};
export const isInfantry = (key) => !!GROUND_UNITS[key]?.infantry;
