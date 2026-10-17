export enum EdgeType { Reads = 1 << 0, Calls = 1 << 1 }

export interface DfEdge { types: number }

export const DfEdge = {
	includesType({ types }: DfEdge, type: EdgeType): boolean {
		return (types & type) !== 0;
	}
};
