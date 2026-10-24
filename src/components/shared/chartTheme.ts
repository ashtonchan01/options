/**
 * One label size for Overview and Income charts. Labels are HTML, not SVG
 * text, so this size stays the same when a plot is stretched to fit its card.
 */
export const CHART_THEME = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 12.5,
  /** Income plot box. Shorter than Overview's 220px chart-panel floor. */
  plotHeight: 160,
} as const
