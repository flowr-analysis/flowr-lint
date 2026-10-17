/** compares by UTF-16 code unit, independent of the locale */
export function compareByCodeUnit(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
