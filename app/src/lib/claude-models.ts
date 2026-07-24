/**
 * Catalog de modele Claude oferite în dropdown-ul integrării.
 * Partajat între UI (client) și server — NU importa nimic din $lib/server aici.
 */
export const CLAUDE_MODELS = [
	{ id: 'claude-opus-4-8', label: 'Opus 4.8' },
	{ id: 'claude-sonnet-5', label: 'Sonnet 5' },
	{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
	{ id: 'claude-fable-5', label: 'Fable 5' }
] as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id'];

export const CLAUDE_MODEL_IDS: string[] = CLAUDE_MODELS.map((m) => m.id);

export const DEFAULT_CLAUDE_MODEL: ClaudeModelId = 'claude-sonnet-5';

export function isKnownClaudeModel(id: string): boolean {
	return CLAUDE_MODEL_IDS.includes(id);
}
