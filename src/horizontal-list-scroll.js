export function horizontalWheelDelta(eventLike) {
  const deltaX = Number(eventLike?.deltaX || 0);
  const deltaY = Number(eventLike?.deltaY || 0);
  return Math.abs(deltaY) > Math.abs(deltaX) ? deltaY : deltaX;
}
export function horizontalRailState(rail, tolerance = 2) {
  const scrollLeft = Math.max(0, Number(rail?.scrollLeft || 0));
  const clientWidth = Math.max(0, Number(rail?.clientWidth || 0));
  const scrollWidth = Math.max(0, Number(rail?.scrollWidth || 0));
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  return {
    canScrollLeft: scrollLeft > tolerance,
    canScrollRight: scrollLeft < maxScroll - tolerance,
    hasOverflow: maxScroll > tolerance,
    maxScroll
  };
}
