import { RType } from '../type';

export interface RExpressionList { type: RType.ExpressionList, grouping?: [string, string] }

export const RExpressionList = {
	is(node?: { type: RType }): node is RExpressionList {
		return node?.type === RType.ExpressionList;
	},
	isImplicit(node?: { type: RType }): node is RExpressionList {
		return RExpressionList.is(node) && node.grouping === undefined;
	}
};
