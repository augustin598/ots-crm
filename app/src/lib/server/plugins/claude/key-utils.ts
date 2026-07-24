export type ClaudeKeyType = 'api' | 'oat';

/** Anthropic OAuth tokens (Claude Code) încep cu `sk-ant-oat`; restul → API key. */
export function detectKeyType(key: string): ClaudeKeyType {
	return key.trim().startsWith('sk-ant-oat') ? 'oat' : 'api';
}

/** Ultimele 4 caractere, pentru afișare în UI (nesensibil). */
export function keyHint(key: string): string {
	return key.trim().slice(-4);
}

/** Validare de prefix + lungime minimă. Nu verifică validitatea la Anthropic. */
export function isValidClaudeKey(key: string): boolean {
	const k = key.trim();
	return /^sk-ant-/.test(k) && k.length >= 20;
}
