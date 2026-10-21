export { ROAD_REQUIRED } from './city/rules.js';
export { COMBAT } from './combat/config.js';
export { random } from './shared/random.js';
export { createGame } from './state.js';
export { supplyFactor, economy, buildingOutput } from './city/economy.js';
export { placementPlan, canPlace, build, demolish, repair } from './city/construction.js';
export { roadPreview, buildRoad } from './city/roads.js';
export { targetById, targetName } from './targets.js';
export { research } from './research/research.js';
export { produce } from './units/aviation/production.js';
export { upgradeDefense } from './combat/upgrades.js';
export {
  resolveAim,
  launchSites,
  queuedLaunches,
  selectedLaunchSite,
  launchStatus,
  launch,
} from './units/aviation/launch.js';
export { damageRoad, damageBuilding, applyBlast } from './combat/damage.js';
export { damageAircraft, routePoint } from './units/aviation/flight.js';
export { interceptPoint, defenseCycle } from './combat/air-defense.js';
export { step, advance } from './simulation.js';
export { save, load } from './persistence/saves.js';
export { formatRate } from './shared/format.js';
export {
  network,
  nearestRoad,
  buildingConnected,
  passable,
  segmentDistance,
  snapRoadPoint,
  overlappingRoad,
  normalizeRoadOverlaps,
} from './city/road-network.js';
export { flightRoute, pointOnRoute } from './units/aviation/routes.js';
export {
  recruit,
  orderGround,
  groundPath,
  walkable,
  BRIDGES,
  GROUND_LIMIT,
  makeGround,
  commandUnits,
  boardGround,
  unloadGround,
  launchFPV,
  saveGroup,
  getGroup,
  setRally,
  redeployMOG,
  coverInfo,
  groundVisible,
  lineOfSight,
  COVER_PATCHES,
} from './units/ground/index.js';
