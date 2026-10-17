import type { DfEdge } from './edge';
import type { Vertex } from './vertex';
import type { Base } from '../../r-bridge/lang-4.x/ast/model/model';

export interface Graph {
	idMap?: Map<number, Base>;
	vertices(includeDefinedFunctions: boolean): [number, Vertex][];
	outgoingEdges(id: number): Map<number, DfEdge> | undefined;
	ingoingEdges(id: number): ReadonlyMap<number, DfEdge> | undefined;
	edgesFrom(id: number): ReadonlyMap<number, DfEdge>;
	edgesTo(id: number): ReadonlyMap<number, DfEdge>;
}

export const NoEdges: ReadonlyMap<number, never> = new Map<number, never>();
