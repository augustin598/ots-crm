/**
 * Derulare orizontală prin „tragere" cu mouse-ul pentru benzile cu overflow-x
 * (filtre, tabele late, strip-uri de carduri). Pe touch nu intervine — acolo
 * scroll-ul nativ e deja cel așteptat.
 *
 * Portat din `dragScroll` (resort-casaelena.ro, motion.ts), ca attachment Svelte 5:
 *   <div {@attach dragScroll}>…</div>
 *
 * În plus față de original: un click care a fost de fapt o tragere e înghițit
 * (altfel, eliberarea mouse-ului pe o pastilă de filtru ar selecta-o).
 */

import type { Attachment } from 'svelte/attachments';

export const dragScroll: Attachment<HTMLElement> = (node) => {
	let down = false;
	let moved = false;
	let startX = 0;
	let startLeft = 0;

	const canScroll = () => node.scrollWidth > node.clientWidth + 1;

	const syncCursor = () => {
		node.style.cursor = canScroll() ? 'grab' : '';
	};

	const onDown = (e: PointerEvent) => {
		if (e.pointerType === 'touch' || e.button !== 0 || !canScroll()) return;
		down = true;
		moved = false;
		startX = e.clientX;
		startLeft = node.scrollLeft;
		node.style.cursor = 'grabbing';
		node.style.userSelect = 'none';
	};
	const onMove = (e: PointerEvent) => {
		if (!down) return;
		const dx = e.clientX - startX;
		if (!moved && Math.abs(dx) > 4) {
			moved = true;
			node.setPointerCapture?.(e.pointerId);
		}
		if (moved) node.scrollLeft = startLeft - dx;
	};
	const onUp = (e: PointerEvent) => {
		down = false;
		node.style.userSelect = '';
		syncCursor();
		try {
			node.releasePointerCapture?.(e.pointerId);
		} catch {
			/* capturarea putea să nu fie activă */
		}
	};
	// După o tragere, click-ul rezultat nu trebuie să ajungă la butonul de sub cursor.
	const onClick = (e: MouseEvent) => {
		if (!moved) return;
		moved = false;
		e.stopPropagation();
		e.preventDefault();
	};

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onUp);
	node.addEventListener('click', onClick, true);

	const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncCursor) : null;
	ro?.observe(node);
	syncCursor();

	return () => {
		node.removeEventListener('pointerdown', onDown);
		node.removeEventListener('pointermove', onMove);
		node.removeEventListener('pointerup', onUp);
		node.removeEventListener('pointercancel', onUp);
		node.removeEventListener('click', onClick, true);
		ro?.disconnect();
		node.style.cursor = '';
		node.style.userSelect = '';
	};
};
