/**
 * inline-image-lightbox.ts
 *
 * Acțiune Svelte pentru conținut randat cu `{@html ...}` (comentarii TipTap,
 * descrieri rich-text). Imaginile din HTML-ul respectiv nu sunt elemente Svelte,
 * deci nu le putem pune `onclick` în template — acțiunea delegă click-ul pe
 * container și raportează galeria completă din acel container plus indexul
 * imaginii pe care s-a dat click.
 *
 * Imaginile primesc `role="button"` + `tabindex="0"` ca să fie accesibile de la
 * tastatură (Enter / Space), iar un MutationObserver le redecorează când
 * conținutul `{@html}` se schimbă (editare comentariu, refresh de query).
 */

import type { Action } from 'svelte/action';
import type { LightboxImage } from '$lib/components/image-lightbox.svelte';

export type InlineImageLightboxParam = (images: LightboxImage[], index: number) => void;

function collect(node: HTMLElement): HTMLImageElement[] {
	// Fără `src` = comentariu vechi din care sanitizer-ul a tăiat un data:URL —
	// nu are ce mări. Cele împachetate în link își păstrează comportamentul de link.
	return Array.from(node.querySelectorAll('img')).filter(
		(img) => !img.closest('a') && !!img.getAttribute('src')
	);
}

function decorate(node: HTMLElement) {
	for (const img of collect(node)) {
		if (img.dataset.lightbox === 'on') continue;
		img.dataset.lightbox = 'on';
		img.setAttribute('role', 'button');
		img.setAttribute('tabindex', '0');
		if (!img.getAttribute('title')) img.setAttribute('title', 'Click pentru mărire');
		img.style.cursor = 'zoom-in';
	}
}

export const inlineImageLightbox: Action<HTMLElement, InlineImageLightboxParam> = (
	node,
	onOpen
) => {
	let open = onOpen;

	function fire(target: HTMLImageElement) {
		const images = collect(node);
		const index = images.indexOf(target);
		if (index < 0) return;
		open(
			images.map((img) => ({ url: img.currentSrc || img.src, name: img.alt || undefined })),
			index
		);
	}

	function handleClick(e: MouseEvent) {
		const target = e.target;
		if (!(target instanceof HTMLImageElement) || target.dataset.lightbox !== 'on') return;
		e.preventDefault();
		fire(target);
	}

	function handleKeydown(e: KeyboardEvent) {
		const target = e.target;
		if (!(target instanceof HTMLImageElement) || target.dataset.lightbox !== 'on') return;
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		fire(target);
	}

	decorate(node);
	const observer = new MutationObserver(() => decorate(node));
	observer.observe(node, { childList: true, subtree: true });

	node.addEventListener('click', handleClick);
	node.addEventListener('keydown', handleKeydown);

	return {
		update(next: InlineImageLightboxParam) {
			open = next;
		},
		destroy() {
			observer.disconnect();
			node.removeEventListener('click', handleClick);
			node.removeEventListener('keydown', handleKeydown);
		}
	};
};
