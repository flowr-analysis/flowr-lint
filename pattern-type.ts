/** The shape of a `flowr/replacement-pattern` entry, see the README for what each field does. */
export interface ReplacementPattern {
	/** identifies the pattern in `@lintIgnore` and in the message */
	readonly id?:         string;
	/** esquery selector, the language `no-restricted-syntax` uses */
	readonly selector:    string;
	readonly message?:    string;
	/** capture name to a path relative to the match */
	readonly capture?:    Readonly<Record<string, string>>;
	/** replacement template, filled from the captures */
	readonly replace:     string;
	/** path to a substring of the file its symbol must be declared in */
	readonly declaredIn?: Readonly<Record<string, string>>;
	/** pairs of paths that have to spell the same code */
	readonly sameText?:   readonly (readonly string[])[];
	/** `true` forces the autofix, `false` forces a suggestion */
	readonly fix?:        boolean;
}
