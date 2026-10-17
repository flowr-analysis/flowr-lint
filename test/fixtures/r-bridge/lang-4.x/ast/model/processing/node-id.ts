export type NodeId = string | number;

export const NodeId = {
	isBuiltIn(id: NodeId): boolean {
		return typeof id === 'string';
	}
};
