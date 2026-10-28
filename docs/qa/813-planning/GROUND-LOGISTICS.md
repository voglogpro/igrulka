# 8.13 ground army and weapon logistics checks

Workspace: `igrulka-813`, branch `codex/army-logistics-813`, state schema 21.
These are functional simulation checks. They do not establish browser frame rate
or eliminate hardware-dependent stalls. No 8.12.1 source or release was changed.

## Focused checks

107 targeted Node tests passed with the worker process set to BelowNormal:

- 84 production, city, retirement, launch, warehouse, assault and transport tests;
- 23 field-supply, rear support and army UI scan-bound tests.

Logs: `artifacts/qa/813-production-targeted.log` and
`artifacts/qa/813-supply-targeted.log` (ignored local artifacts).
Touched implementation and test files passed ESLint and Prettier.

The assault regression starts an exhausted ordinary Leopard on dry ground. Its
only replacement rounds are a finite 24-shell crate 100 metres away. Without
moving the unit externally after admission, the simulation takes it to the
crate, returns it, destroys one ordinary 260-HP launcher, moves it toward another
ordinary 260-HP launcher and destroys that target too. The test loads a save made
during the ammunition trip; recall cancels that trip and schedules physical
return without changing the unit's position. No target or unit HP is increased.

Other assertions cover the following:

- Bot assaults use the player 30% operation controller, retain the other
  defenders, and do not create another wave over active or returning survivors.
- Manual point orders, guards, appended routes and boarding detach mission
  membership. Active/returning operations and supply trips survive save/load.
- Medics keep treatment through 95% HP; two support fronts stay separate.
  A supply truck boards a real medic passenger, travels, survives save/load and
  dismounts the medic through the existing connected-ground unloading contract.
- Single and multiple MGs damage ordinary light/heavy drones while consuming
  finite magazines/reserves. Six MGs intercept the light approach over four
  independent seeds. Attack-moving MOGs acquire before setup, stop and deploy.
- Manufacturing completes into the producing factory. A full warehouse retains
  the paid completed job until space exists. Factory levels retain production
  and storage benefits; factory launch attempts are rejected for all four types.
- Two-missile loads withdraw mixed legacy and local stock exactly. Matching
  deliveries complete physically without duplicate loads or indefinite pickup
  loops. Returned weapons enter a local factory warehouse.
- Destroying a factory loses its stored weapons but preserves already loaded
  cargo elsewhere. Version-20 partial racks migrate missing zero slots, preserve
  overflow and remain idempotent. Corrupt string/null/negative stock is rejected.
- Four-city migration preserves ownership and keeps the old HQ stock when no
  factory exists. Typed delivery status is read-only, excludes foreign cargo,
  other weapon types, returns and collections from incoming counts, and returns
  no ETA for a blocked or unknown route.

## Extended paid campaigns

The results recorded in this section precede the final minimum-capture-budget
correction. They are retained as attribution for that earlier snapshot. The
fresh post-correction endurance results at the end of this document supersede
them for the final controller.

The final 12 × 20-minute legacy campaign run passed all seeds 1–12 using
`node tests/soak/campaign.mjs --report-prefix=soak813-final` at BelowNormal,
after the 8.13 cost/economy/AI logic was frozen. No assertions were relaxed.
The harness raises only the passive headquarters' HP so every campaign lasts
the full duration. AI buildings, troops, aircraft, ammunition and vehicles use
ordinary starting resources and actual payments.

Every seed observed all four completed weapon types, two captured districts and
six surviving logistics vehicles. Per-campaign results were 39–46 impacts,
24–26 ground units, 17–19 ground units across the centre line, 5–6 cargo-carrying
vehicles observed and 476–500 credits actually spent on ammunition production.
Bounded stocks, finite magazines/reserves, physical vehicle travel, equipment
levels 0–2 and save/load conservation assertions all passed.

Reports: `artifacts/qa/soak813-final.json` and `.log` (ignored local artifacts).

The final cooperative run also passed: three seeds (81, 810, 8100), 20 minutes
each, four cities and two independently funded bots, using
`node tests/soak/coop.mjs` at BelowNormal. Each campaign loaded two mid-run saves
and retained exact faction and building state. Both bots built their paid city
and army, connected settlements, flew actual aircraft and paid for ammunition.
The bots observed 46–56 flights each and spent 566–632 credits on ammunition
production. Final campaigns contained 98–100 buildings and 66–68 ground units.
Resource nonnegativity, valid ownership and the bounded per-owner logistics
fleet passed throughout. This harness likewise raises only passive human HQ HP.

Reports: `artifacts/qa/813-coop-final.log` and
`artifacts/qa/coop813-final.json` (copied from the unchanged harness's historical
`coop810.json` output name). Both final soak processes have exited successfully.

## Network fixture and real WebSocket checks

The shared network/performance fixture now uses an actual completed launcher
as each staged airborne drone's source, initializes finite factory/rack stock,
and supplies components for its funded city setup. Its historical 120 ground
units per city remain unchanged. Already airborne stress units retain ordinary
drone HP and are not also counted as ready rack stock. Six projection fixture
tests passed, including legal launch-source and finite-stock assertions.

`node tests/soak/network-load.mjs` passed all four real loopback WebSocket cases
at BelowNormal: 480 ground units with 10, 20, 100 and 400 aircraft, respectively.
The 20-aircraft case is an exact 500-entity network sample. Each case observed
actual ground/AA projectiles, two authoritative owners (0 and 2), four HQs,
decoded delta snapshots and accepted commands. No disconnect or pause occurred;
each writer retained at most one pending snapshot. Application ACK delays were
500 ms in the first two cases and 1200 ms in the latter two.

Report: `artifacts/qa/network-load813-final.json` (copied from the unchanged
harness's historical `network-load811.json` output name), with console logs in
`artifacts/qa/813-network-load-final.log`. Timing counters in that functional run
are not isolated hardware performance measurements. No browser or
`performance.mjs` measurement was run as part of this fixture audit.

## Seed-6 capture deadline diagnosis and correction

The full suite exposed a real 900-second capture deadline regression. A fresh
seed-6 simulation captured the south depot at 696 seconds and the north depot at
935 seconds. Its first city assault began at 994 seconds. A test-only Node
module loader disabling that assault helper produced identical capture times,
positions and resources at 900 seconds, proving that the assault did not pull
the capturing detail away.

The minimum paid infantry detail was instead waiting for entire future city
building quotes. At the 230-second army decision, credits were 310 while a
planned housing quote reserved 545, blocking a normal 28-credit soldier despite
the available 250-credit protected reserve. Similar decisions reserved 545 at
247 seconds and 520 at 264 seconds for a planned vehicle base.

The narrow correction in `ai/army-ai.js` uses the ordinary 250-credit reserve
only until the existing minimum three paid capture infantry are present or
queued. Later mixed reinforcements still protect the complete infrastructure
quote. A test-only loader candidate captured the south and north depots at 372
and 403 seconds, respectively, without resource grants or changes to physical
travel, capture rules, prices or existing deadline assertions.

All 31 focused capture, depot-doctrine, city-planning and assault tests passed at
BelowNormal after implementation. The unchanged 900/960-second regression
passed. A new regression checks a real 278-credit balance paying for infantry
and retaining exactly 250, counting all three paid queued recruits, then
refusing a mixed reinforcement that would consume its pending building budget.
ESLint and Prettier passed. Attribution reports are ignored artifacts under
`artifacts/qa/813-planning/seed6-assault-{current,disabled,reserve-fix}.json`;
targeted results are in `artifacts/qa/813-capture-fix-targeted.log`.

## Final endurance after the capture-budget correction

The frozen corrected controller passed a fresh unchanged 12 × 20-minute paid
campaign run and, sequentially afterwards, all three unchanged cooperative
20-minute campaigns. Both Node worker processes ran at BelowNormal and have
exited. No assertion, resource grant, price, travel rule or deadline was changed.
Only the harness's existing passive-HQ survival exception remained.

`node tests/soak/campaign.mjs --report-prefix=soak813-capture-final` passed seeds
1–12. Every seed captured two districts, observed all four completed weapon
types, kept six surviving logistics vehicles and passed finite-stock,
physical-travel, resource, equipment and save/load checks. Final per-campaign
ranges were 38–41 ground units, 26–29 across the centre line, 45–57 impacts,
6–7 observed cargo vehicles and 608–644 credits paid for ammunition production.

`node tests/soak/coop.mjs` then passed seeds 81, 810 and 8100, each with four
cities, both paid bots and two mid-run save/load cycles. Final campaigns had
99–100 buildings and 68–74 ground units. Each bot observed 44–60 flights and
paid 566–618 credits for ammunition production. Ownership, nonnegative resources,
bounded per-owner fleets and exact reload state passed throughout.

Final reports are `artifacts/qa/soak813-capture-final.json` / `.log`,
`artifacts/qa/coop813-capture-final.json` (copied from the unchanged harness's
historical output name), `artifacts/qa/813-capture-campaign-final.log` and
`artifacts/qa/813-capture-coop-final.log`. Older report prefixes remain intact.
These functional simulations establish no browser/GPU timing claim.

## Nonsemantic simulation allocation changes

A subsequent Node-only CPU/allocation audit of the exact 500-unit close-battle
fixture identified repeated trench geometry lookup and an unnecessary complete
AA statistics object in every ground tick. The HP10000 version is explicitly
endurance stress, not balance testing. Ordinary-HP control retained 474 units
after the five-second warmup and 420 after the 30-second observation window.

The two bounded changes cache only sorted nearby trench references and replace
the ground tick's AA statistics object with the exact magazine/reload/heat scalar
formulas. The public `defenseStats` API and mutable AA cadence state remain
unchanged. Trench ownership, contested occupancy and work/progress are still
read live. Derived geometry invalidation covers canonical automatic/manual
creation and legacy in-place map relocation; explicit geometry edits also have
an invalidator that handles replacement/reordering at unchanged array length.

65 focused fortification, ammunition, engagement, equipment and migration tests
passed at BelowNormal. They include every ground role, tiers 0–2, all four
veteran ranks, zero/missing configuration fallbacks and actual finite shared or
separate reload cycles. A frozen pre-change module loader and the candidate
produced identical complete serialized-state SHA256 hashes at all 240 five-second
checkpoints in a 20-minute seed-6 campaign, including resources, RNG, events,
paths and units. Final hash:
`e63af588d4c38199a2116266f0056cf8cfb4e930ca0a8abff2e4cb755e313102`.

Independent allocation samples for the identical immortal battle estimated
cumulative allocation falling from 2.062 GB to 1.771 GB (about 14.1%). This is
sampled allocation including collected objects, not retained heap or a browser
frame-rate claim. Both runs ended with the same 500 units, 67 live projectiles
and 34718 remaining rounds. Full audit and CPU/heap profiles are ignored local
artifacts under `artifacts/qa/813-planning/`; focused logs are
`813-simulation-cache-targeted.log` and `813-simulation-cache-migration.log`.
