import type { DfEdge } from './edge';

export interface Graph {
	outgoingEdges(id: number): Map<number, DfEdge> | undefined;
}

export const NoEdges: ReadonlyMap<number, never> = new Map<number, never>();
