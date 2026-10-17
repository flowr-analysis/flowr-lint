/** the items without duplicates, in first-seen order */
export function uniqueArray<T>(items: Iterable<T>): T[] {
	return Array.from(new Set(items));
}
