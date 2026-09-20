// Small map dots need a forgiving click target; project cards take precedence.
export function researchHits(map, point) {
  if (!map?.getLayer('research-points')) return [];
  const box = [[point.x - 10, point.y - 10], [point.x + 10, point.y + 10]];
  const projects = map.queryRenderedFeatures(box, {layers: ['research-points']});
  if (projects.length) return projects;
  return map.getLayer('research-facilities')
    ? map.queryRenderedFeatures(point, {layers: ['research-facilities']}) : [];
}
