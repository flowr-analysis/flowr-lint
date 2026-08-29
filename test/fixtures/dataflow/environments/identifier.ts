export type Identifier = string | [name: string, namespace: string];

export const Identifier = {
	toString(id?: Identifier): string | undefined {
		return Array.isArray(id) ? `${id[1]}::${id[0]}` : id;
	}
};
