export type SourceRange = [number, number, number, number];
export type SourceLocation = [...r: SourceRange, f?: string];

export const SourceRange = {
	getStartLine(range?: SourceLocation): number | undefined {
		return range?.[0];
	},
	fromNode(node?: unknown): SourceLocation | undefined {
		return node === undefined ? undefined : [1, 1, 1, 1];
	},
	ownFromNode(node?: unknown): SourceLocation | undefined {
		return node === undefined ? undefined : [1, 1, 1, 1];
	}
};

export const SourceLocation = {
	fromNode(node?: unknown): SourceLocation | undefined {
		return node === undefined ? undefined : [1, 1, 1, 1];
	},
	at(node?: unknown): { startLine: number } | undefined {
		return node === undefined ? undefined : { startLine: 1 };
	},
	getRange(loc?: SourceLocation): SourceRange | undefined {
		return loc && [loc[0], loc[1], loc[2], loc[3]];
	},
	getStartLine(loc?: SourceLocation): number | undefined {
		return loc?.[0];
	}
};
