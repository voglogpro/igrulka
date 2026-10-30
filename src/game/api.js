export { ROAD_REQUIRED } from './city/rules.js';
export { ELECTRONICS, electronicsFactoryStatus } from './city/electronics.js';
export { radarFireSupport, radarAirWarning } from './combat/radar-support.js';
export { weaponStoreStock, factoryWarehouseStatus } from './units/aviation/weapon-stores.js';
export { weaponDeliveryStatus } from './city/weapon-delivery-status.js';
export { FIELD_SUPPLY, fieldCrateStatus, damageAmmoCrates } from './city/field-ammo.js';
export { updateFieldSupply } from './units/ground/field-supply.js';
export {
  AMMUNITION,
  ammunitionStatus,
  ammunitionProfile,
  createAmmoStock,
} from './units/ground/ammunition.js';
export {
  ammoFactoryStatus,
  setAmmoFactoryEnabled,
  updateAmmoProduction,
} from './city/ammo-production.js';
export {
  ammoLogisticsStatus,
  requestWeaponDelivery,
  updateAmmoLogistics,
} from './city/ammo-logistics.js';
export { setSupportAutomatic, setRearAutomatic } from './units/ground/rear.js';
export { COMBAT } from './combat/config.js';
export { random } from './shared/random.js';
export {
  DISTRICTS,
  DISTRICT_TYPES,
  DISTRICT_BY_ID,
  DISTRICT_RULES,
  districtStatus,
  districtIncome,
  captureDistrict,
  setDistrictRepair,
  damageDistricts,
} from './territory/districts.js';
export { createGame } from './state.js';
export { WEATHER, forecast, weatherSpread } from './weather.js';
export { TRADE, tradeReport } from './units/ground/trade.js';
export { COMMUTE_INCOME } from './city/economy.js';
export { setServiceEnabled, serviceStatus } from './city/service.js';
export { OIL, oilStorage, oilProduction, oilBurn, oilCost, hasOil } from './city/oil.js';
export { berthOf, quayOf } from './city/ports.js';
export { oilFieldAt } from './city/construction.js';
export { setAutoDefense } from './defense/volunteers.js';
export {
  defenseAttackStatus,
  launchDefenseAttack,
  recallDefenseAttack,
  DEFENSE_ATTACK_PERCENT,
} from './units/ground/defense-attack.js';
export { frontlineReport } from './defense/frontline.js';
export { fortificationStatus, FORTIFICATION_TOP } from './defense/fortifications.js';
export { FRONTLINE, FRONT_SECTORS, FORTIFICATION } from './defense/config.js';
export { visionOf, fogVisible, GRID as VISION_GRID } from './vision-grid.js';
export { DIFFICULTY, DEFAULT_DIFFICULTY, difficultyOf } from './ai/difficulty.config.js';
export { supplyFactor, economy, buildingOutput } from './city/economy.js';
export { placementPlan, canPlace, build, demolish, repair } from './city/construction.js';
export { roadPreview, buildRoad } from './city/roads.js';
export {
  HEADQUARTERS_INCOME,
  roadRecoveryStatus,
  startRoadRecovery,
  setRoadRecoveryEnabled,
  cancelRoadRecovery,
} from './city/road-recovery.js';
export { targetById, targetName } from './targets.js';
export { research, researchProjects, researchStatus } from './research/research.js';
export { purchaseQuote } from './city/pricing.js';
export { recruitmentFacility } from './units/ground/recruitment.js';
export { setArmyTarget, armyCompositionStatus } from './units/ground/composition.js';
export { produce } from './units/aviation/production.js';
export {
  queueFactoryOrder,
  cancelFactoryOrders,
  factoryOrderStatus,
  restoreFactoryOrders,
} from './units/aviation/factory-orders.js';
export {
  setFactoryPlan,
  factoryPlanStatus,
  updateFactoryPlans,
  isFactoryPlan,
} from './units/aviation/factory-plans.js';
export { deliverGround, transportDeliveryStatus } from './units/vehicles/transport-orders.js';
export { deploymentPlan, deployGround } from './units/ground/deployment.js';
export { squadRoster, retargetSquadReserves } from './units/ground/squads.js';
export {
  appendGroundOrder,
  groundRouteStatus,
  GROUND_ROUTE_LIMIT,
} from './units/ground/route-queue.js';
export { upgradeDefense, upgradeStatus } from './combat/upgrades.js';
export { equipmentModifiers, UPGRADE_TIERS } from './combat/upgrade-tiers.js';
export {
  initLaunchStore,
  availableLaunchStock,
  launchStoreCapacity,
  launchStoreTotal,
  launchSiteAllows,
  acceptLaunchDelivery,
  weaponStock,
  movableWeaponStock,
  launchSupplyRequests,
  updateLaunchSupply,
  restoreLaunchSupply,
} from './units/aviation/launch-supply.js';
export { launchTempo } from './units/aviation/launch.js';
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
  ROAD_GRID,
  overlappingRoad,
  normalizeRoadOverlaps,
} from './city/road-network.js';
export { flightRoute, pointOnRoute } from './units/aviation/routes.js';
export {
  recruit,
  orderGround,
  groundPath,
  navigationWarmup,
  walkable,
  BRIDGES,
  GROUND_LIMIT,
  GROUND_COMMAND_LIMIT,
  ARMY_TARGET_MAX,
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
  guardGround,
  defendLineGround,
  applyStance,
  validStance,
  stanceLabel,
  bridgePoint,
  chooseBridge,
  STANCE_MODES,
  DEFEND_POSTS,
  POST_NAMES,
  setRecruitRepeat,
  recruitRepeatStatus,
  veteranRank,
  gainGroundExperience,
  VETERAN_XP_CAP,
  VETERAN_THRESHOLDS,
  setRallyMode,
  RALLY_MODES,
  defaultRallyMode,
} from './units/ground/index.js';
