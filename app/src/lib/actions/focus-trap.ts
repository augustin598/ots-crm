/**
 * focus-trap.ts
 *
 * Reusable Svelte 5 action for WCAG 2.1 AA-compliant modal focus management.
 *
 * Handles:
 * 1. Moving focus into the modal on open (first focusable or custom selector)
 * 2. Trapping Tab / Shift+Tab cycling within the modal
 * 3. Closing on Escape (via onEscape callback)
 * 4. Restoring focus to the previously-focused element on close
 */

import type { Action } from 'svelte/action';

export type FocusTrapOptions = {
	/**
	 * Whether the trap is active (modal is open).
	 * When false, the action is a no-op.
	 * @default true
	 */
	active?: boolean;
	/**
	 * CSS selector for the element that should receive initial focus.
	 * Defaults to the first focusable element inside the node.
	 */
	initialFocus?: string;
	/**
	 * Callback fired when the Escape key is pressed.
	 * Modal close handler goes here.
	 */
	onEscape?: () => void;
	/**
	 * When true, returns focus to the previously-focused element when the
	 * trap deactivates (modal closes). Default true.
	 * @default true
	 */
	restoreFocus?: boolean;
};

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const focusTrap: Action<HTMLElement, FocusTrapOptions> = (node, options = {}) => {
	let previousActiveElement: HTMLElement | null = null;
	let isActive = options.active ?? true;

	function getFocusable(): HTMLElement[] {
		return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
			(el) => !el.hasAttribute('inert') && el.offsetParent !== null
		);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!isActive) return;

		if (e.key === 'Escape' && options.onEscape) {
			e.preventDefault();
			options.onEscape();
			return;
		}

		if (e.key !== 'Tab') return;

		const focusable = getFocusable();
		if (focusable.length === 0) {
			e.preventDefault();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement as HTMLElement | null;

		if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}

	function activate() {
		previousActiveElement = document.activeElement as HTMLElement | null;
		const initial = options.initialFocus
			? node.querySelector<HTMLElement>(options.initialFocus)
			: getFocusable()[0];
		// Microtask ensures element is in the DOM and laid out before focus
		queueMicrotask(() => initial?.focus());
	}

	function deactivate() {
		if (options.restoreFocus !== false && previousActiveElement) {
			previousActiveElement.focus();
		}
	}

	if (isActive) activate();
	node.addEventListener('keydown', handleKeydown);

	return {
		update(newOptions: FocusTrapOptions = {}) {
			const wasActive = isActive;
			isActive = newOptions.active ?? true;
			options = newOptions;

			if (!wasActive && isActive) {
				activate();
			} else if (wasActive && !isActive) {
				deactivate();
			}
		},
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
			if (isActive) deactivate();
		}
	};
};
