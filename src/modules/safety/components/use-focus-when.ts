import { useCallback } from "react";

/**
 * A ref callback that focuses its element when `shouldFocus` is, and
 * changes only with it: React calls it with the element when it changes,
 * so focus moves once — when the element becomes the one to land on — and
 * not on every render after. Review hands focus on with it after a
 * decision: to the next row, or to the next garment tile's Decide.
 */
export function useFocusWhen(
  shouldFocus: boolean,
): (node: HTMLElement | null) => void {
  return useCallback(
    (node: HTMLElement | null) => {
      if (shouldFocus && node !== null) node.focus();
    },
    [shouldFocus],
  );
}
