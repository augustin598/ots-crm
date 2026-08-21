import { describe, expect, it } from 'bun:test';
import {
	resolveWhatsappPromptState,
	WHATSAPP_PROMPT_MAX_DISMISSALS
} from './phone-prompt';

describe('resolveWhatsappPromptState', () => {
	it('nu întreabă pe cine are deja număr, oricâte amânări ar avea', () => {
		expect(resolveWhatsappPromptState({ linkedPhone: '+40752781620', dismissedCount: 0 })).toBe('none');
		expect(resolveWhatsappPromptState({ linkedPhone: '+40752781620', dismissedCount: 9 })).toBe('none');
	});

	it('arată modalul la primele amânări', () => {
		expect(resolveWhatsappPromptState({ linkedPhone: null, dismissedCount: 0 })).toBe('modal');
		expect(resolveWhatsappPromptState({ linkedPhone: null, dismissedCount: 1 })).toBe('modal');
		expect(resolveWhatsappPromptState({ linkedPhone: null, dismissedCount: 2 })).toBe('modal');
	});

	it('trece pe banner de la a treia amânare în sus', () => {
		expect(
			resolveWhatsappPromptState({ linkedPhone: null, dismissedCount: WHATSAPP_PROMPT_MAX_DISMISSALS })
		).toBe('banner');
		expect(resolveWhatsappPromptState({ linkedPhone: null, dismissedCount: 12 })).toBe('banner');
	});

	it('tratează un contor negativ sau lipsă ca pe zero amânări', () => {
		expect(resolveWhatsappPromptState({ linkedPhone: null, dismissedCount: -1 })).toBe('modal');
	});
});
