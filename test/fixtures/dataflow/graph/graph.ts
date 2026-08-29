import type { DfEdge } from './edge';

export interface Graph {
	outgoingEdges(id: number): Map<number, DfEdge> | undefined;
	ingoingEdges(id: number): ReadonlyMap<number, DfEdge> | undefined;
	edgesFrom(id: number): ReadonlyMap<number, DfEdge>;
	edgesTo(id: number): ReadonlyMap<number, DfEdge>;
}

export const NoEdges: ReadonlyMap<number, never> = new Map<number, never>();
