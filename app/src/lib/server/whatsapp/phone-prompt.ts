/**
 * Ce arătăm unui utilizator de portal care n-are număr de WhatsApp legat.
 *
 * Regula stă separat de încărcarea datelor ca s-o putem testa fără bază de date
 * și fără SvelteKit. Layoutul portalului o cheamă cu ce a citit din DB.
 */

/** De la a câta amânare modalul nu mai apare și rămâne doar bannerul. */
export const WHATSAPP_PROMPT_MAX_DISMISSALS = 3;

export type WhatsappPromptState = 'none' | 'modal' | 'banner';

export interface WhatsappPromptInput {
	/** Numărul deja legat în user_whatsapp_link, dacă există. */
	linkedPhone: string | null;
	/** De câte ori a apăsat „Nu acum". */
	dismissedCount: number;
}

/**
 * Cine are deja număr nu mai e întrebat niciodată. Cine a amânat de destule ori
 * primește bannerul discret în locul modalului care sare în față.
 */
export function resolveWhatsappPromptState(input: WhatsappPromptInput): WhatsappPromptState {
	if (input.linkedPhone) return 'none';
	if (input.dismissedCount >= WHATSAPP_PROMPT_MAX_DISMISSALS) return 'banner';
	return 'modal';
}
