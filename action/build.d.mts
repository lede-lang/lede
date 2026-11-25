export function resolveVersion(input: string | undefined, actionRef: string | undefined): string;
export function flag(value: string | undefined, fallback: boolean): boolean;
export function globRegExp(pattern: string): RegExp;
export function findFiles(root: string, patterns: string, outDir: string): string[];
export function outputFor(outDir: string, rel: string): string;
export function main(env: Record<string, string | undefined>, log?: (s: string) => void): { files: string[]; outDir: string };
