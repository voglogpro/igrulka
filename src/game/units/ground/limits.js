// Transport/command bounds are not population caps. Production remains paid and
// limited by each facility's queue, resources and build time, not army size.
export const GROUND_COMMAND_LIMIT = 1000;
// A user-entered goal is finite; zero disables that type's automatic replenishment.
// This validation bound never prevents additional ordinary paid recruitment.
export const ARMY_TARGET_MAX = 10000;
