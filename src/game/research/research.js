// Compatibility exports for old callers. Research is retired; legacy paid projects are
// refunded once by persistence/retired-research.js, never advanced by the simulation.
export function researchProjects() {
  return [];
}
export function researchStatus() {
  return { slots: 0, projects: [], activeCount: 0 };
}
export function updateResearch() {}
export function research() {
  return 'Исследования упразднены: вооружение доступно за обычную цену';
}
