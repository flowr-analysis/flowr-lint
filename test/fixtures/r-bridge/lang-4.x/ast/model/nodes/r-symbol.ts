import { RType } from '../type';
import type { Base } from '../model';

export type Identifier = string | [name: string, namespace: string];

export interface RSymbol extends Base { type: RType.Symbol, content: Identifier }

export const RSymbol = {
	is(node?: { type: RType }): node is RSymbol {
		return node?.type === RType.Symbol;
	}
};
