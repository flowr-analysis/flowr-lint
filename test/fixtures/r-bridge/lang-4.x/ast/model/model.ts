import type { SourceRange } from '../../../../util/range';

export interface Source { fullRange?: SourceRange, fullLexeme?: string }

export interface Base { info: Source & { id: number }, lexeme?: string, location?: SourceRange }
