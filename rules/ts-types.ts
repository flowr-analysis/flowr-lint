/**
 * The slice of the TypeScript compiler API the rules touch, spelled out structurally so that
 * `typescript` stays out of this package's dependencies.
 */

export interface TsSourceFile { fileName: string }

export interface TsDeclaration { getSourceFile(): TsSourceFile | undefined }

export interface TsJsDocTag { name: string, text?: readonly { text: string }[] }

export interface TsSymbol {
	flags:         number;
	declarations?: readonly TsDeclaration[];
	getName(): string;
	getJsDocTags(checker: TsTypeChecker): readonly TsJsDocTag[];
}

export interface TsType { getProperties(): readonly TsSymbol[] }

export interface TsTypeChecker {
	getSymbolAtLocation(node: unknown): TsSymbol | undefined;
	getAliasedSymbol(symbol: TsSymbol): TsSymbol;
	getTypeOfSymbolAtLocation(symbol: TsSymbol, location: TsDeclaration): TsType;
}

/** What typescript-eslint hands to a type-aware rule. */
export interface TypeServices {
	program:               { getTypeChecker(): TsTypeChecker };
	esTreeNodeToTSNodeMap: { get(node: unknown): unknown };
}
