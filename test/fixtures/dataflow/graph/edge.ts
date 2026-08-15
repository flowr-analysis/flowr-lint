export enum EdgeType { Reads = 1 << 0, Calls = 1 << 1 }

export interface DfEdge { types: number }
