export enum VertexType { Use = 'use', FunctionCall = 'fcall' }

export interface Vertex { tag: VertexType, origin: string[] }

export const FunctionCallVertex = {
	is(vertex?: Vertex): vertex is Vertex {
		return vertex?.tag === VertexType.FunctionCall;
	},
	hasOrigin(vertex: Vertex | undefined, origin: string): boolean {
		return FunctionCallVertex.is(vertex) && vertex.origin.includes(origin);
	}
};
