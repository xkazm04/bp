// Shared by the source-guard checks: read a file with its comments removed, so a rule described in a comment
// cannot stand in for the rule. Plain node (type stripping); import with the .ts extension.
import fs from 'node:fs';

/** Block comments, and line comments not preceded by `:` (URLs), a quote or a backslash. */
export const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** Block comments only (CSS has no line comments). */
export const stripBlock = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
export const readStripped = (file: string): string => stripComments(fs.readFileSync(file, 'utf8'));
