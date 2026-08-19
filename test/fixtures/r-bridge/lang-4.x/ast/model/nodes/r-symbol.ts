import { RType } from '../type';

export type Identifier = string | [name: string, namespace: string];

export interface RSymbol { type: RType.Symbol, content: Identifier }

export const RSymbol = {
	is(node?: { type: RType }): node is RSymbol {
		return node?.type === RType.Symbol;
	}
};
