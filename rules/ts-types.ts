/**
 * The slice of the TypeScript compiler API the rules touch, spelled out structurally so that
 * `typescript` stays out of this package's dependencies.
 */

export interface TsSourceFile { fileName: string }

export interface TsDeclaration {
	getSourceFile(): TsSourceFile | undefined;
	/** what a property or variable is set to, `frames: framesOf` binds `framesOf` */
	initializer?: unknown;
}

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
	/** what a module exports, its symbol taken from the source file */
	getExportsOfModule(module: TsSymbol): readonly TsSymbol[];
	/** the variable a shorthand property `{ framesOf }` stands for */
	getShorthandAssignmentValueSymbol(declaration: TsDeclaration): TsSymbol | undefined;
}

/** What typescript-eslint hands to a type-aware rule. */
export interface TypeServices {
	program:               { getTypeChecker(): TsTypeChecker, getSourceFiles(): readonly TsSourceFile[] };
	esTreeNodeToTSNodeMap: { get(node: unknown): unknown };
}
