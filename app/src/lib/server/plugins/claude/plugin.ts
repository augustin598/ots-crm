import type { Plugin, PluginConfig, HooksManager } from '../types';
import { logInfo } from '$lib/server/logger';

/**
 * Claude plugin manifest.
 *
 * Configurarea (cheia API) e per-tenant prin `claude_integration` table
 * (vezi `plugins/claude/index.ts` → getClaudeClient). Plugin-ul aici e doar
 * declaration pentru registry + lifecycle hooks.
 */
export class ClaudePlugin implements Plugin {
	id = 'claude';
	name = 'claude';
	version = '1.0.0';
	displayName = 'Claude';
	description =
		'Cheie Claude (Anthropic) per-tenant — API key (sk-ant-api…) sau Claude Code OAuth token (sk-ant-oat…), criptată. Folosită de funcțiile AI din CRM.';

	async initialize(_config: PluginConfig): Promise<void> {
		// No-op. Configurarea e per-tenant (vezi /[tenant]/settings/claude).
	}

	registerHooks(_hooks: HooksManager): void {
		// Fără hooks în acest pas (doar credențiale).
	}

	async onEnable(tenantId: string): Promise<void> {
		logInfo('plugin', 'Claude plugin enabled for tenant', { tenantId });
	}

	async onDisable(tenantId: string): Promise<void> {
		// Nu ștergem credențialele la disable — la re-enable rămân unde erau.
		logInfo('plugin', 'Claude plugin disabled for tenant', { tenantId });
	}
}

export const claudePlugin = new ClaudePlugin();
