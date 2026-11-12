/** Width of All Activity when it sits in the right-hand column. */
export const ACTIVITY_COLUMN_WIDTH = 300

/** The side-by-side month box is 16:9. Extra height under that box is the
 * only reason to move the list underneath. */
const MONTH_ASPECT = 9 / 16

/** Leftover height (px) that is worth a list under the month. Below this the
 * right-hand column stays: a short band would shrink the grid to make room. */
const STACK_AT = 220

/** Return to the column slightly before STACK_AT so dragging the window
 * edge does not flicker between the two layouts. */
const UNSTACK_AT = 180

/** Cap on the list once it is under the month, so further height goes to the grid. */
const STACKED_LIST_MAX = 300

export interface ActivityPlacement {
  /** True when All Activity is under the month. False keeps the right column. */
  stacked: boolean
  /** Height of the list when stacked. Unused while it is the side column. */
  activityHeight: number
}

/** Decide side column vs. under the month from the calendar row's own box.
 *
 * The side-by-side month is 16:9 of (width − column). Whatever height is
 * left under that box is the empty band. The list moves under the month
 * only when that band is tall enough to hold it, which also lets the month
 * take the column's width and any height past the list cap. A shorter
 * window has no useful band, so the list stays on the right. */
export function activityPlacement(
  containerWidth: number,
  containerHeight: number,
  currentlyStacked: boolean,
): ActivityPlacement {
  const sideCalendarWidth = Math.max(0, containerWidth - ACTIVITY_COLUMN_WIDTH)
  const sideCalendarHeight = sideCalendarWidth * MONTH_ASPECT
  const leftover = containerHeight - sideCalendarHeight
  const threshold = currentlyStacked ? UNSTACK_AT : STACK_AT
  const stacked = leftover >= threshold
  return {
    stacked,
    activityHeight: stacked ? Math.round(Math.min(STACKED_LIST_MAX, leftover)) : 0,
  }
}
