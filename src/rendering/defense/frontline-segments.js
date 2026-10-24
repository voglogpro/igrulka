// Shared by the world and minimap: never join two disconnected land corridors.
export function frontlineSegments(report) {
  const points = report?.polyline || [],
    sectors = report?.sectors || [];
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    if (b.breakBefore) continue;
    const first = sectors.find((s) => s.id === a.sectorId) || sectors[i];
    const second = sectors.find((s) => s.id === b.sectorId) || sectors[i + 1] || first;
    const sector = (first?.pressure || 0) > (second?.pressure || 0) ? first : second;
    segments.push({ a, b, sector: sector || { pressure: 0, knowledge: 'unknown' } });
  }
  return segments;
}
