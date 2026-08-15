export enum EdgeType { Reads = 1, Calls = 2 }

export interface Edge { types: number }

/** the replacement */
export const Helper = { modern: legacy };

/**
 * the old entry point
 * @useInstead {@link Helper.modern}
 */
export function legacy(x: number): number {
	return x;
}

/** a helper object with a member that points elsewhere */
export const Legacy = {
	/**
	 * the old member
	 * @useInstead {@link Helper.modern}
	 */
	old(x: number): number {
		return x;
	}
};
