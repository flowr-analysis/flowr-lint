export enum VertexType { Use = 'use', FunctionCall = 'fcall' }

export interface Vertex { tag: VertexType, origin: string[] }

export const Vertex = {
	isUse(vertex?: Vertex): vertex is Vertex {
		return vertex?.tag === VertexType.Use;
	},
	isFunctionCall(vertex?: Vertex): vertex is Vertex {
		return vertex?.tag === VertexType.FunctionCall;
	},
	hasOrigin(vertex: Vertex | undefined, origin: string): boolean {
		return Vertex.isFunctionCall(vertex) && vertex.origin.includes(origin);
	}
};
