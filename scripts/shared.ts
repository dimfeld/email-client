export function readFlag(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

export function requireFlag(name: string): string {
	const value = readFlag(name);
	if (!value) throw new Error(`Missing required ${name} value.`);
	return value;
}
