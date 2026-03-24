import { mount, unmount } from 'svelte';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import MentionList from './MentionList.svelte';

export type MentionUser = {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
};

export function createMentionSuggestion(users: MentionUser[]): Omit<SuggestionOptions, 'editor'> {
	return {
		items: ({ query }: { query: string }) => {
			const q = query.toLowerCase();
			return users
				.filter((u) => {
					const name = `${u.firstName} ${u.lastName}`.toLowerCase();
					return name.includes(q) || u.email.toLowerCase().includes(q);
				})
				.slice(0, 5);
		},
		render: () => {
			let container: HTMLDivElement;
			let component: Record<string, any>;
			let mentionListRef: any;

			return {
				onStart: (props: SuggestionProps) => {
					container = document.createElement('div');
					container.style.position = 'absolute';
					container.style.zIndex = '50';

					mentionListRef = {};
					component = mount(MentionList, {
						target: container,
						props: {
							items: props.items,
							command: props.command,
						},
					});
					// Store ref for onKeyDown
					mentionListRef = component;

					const { decorationNode } = props as any;
					if (decorationNode) {
						const rect = decorationNode.getBoundingClientRect();
						const editorRect = decorationNode.closest('.rich-editor')?.getBoundingClientRect();
						if (editorRect) {
							container.style.left = `${rect.left - editorRect.left}px`;
							container.style.top = `${rect.bottom - editorRect.top + 4}px`;
						}
					}

					const editorEl = (props as any).decorationNode?.closest('.rich-editor');
					if (editorEl) {
						editorEl.style.position = 'relative';
						editorEl.appendChild(container);
					} else {
						document.body.appendChild(container);
					}
				},
				onUpdate: (props: SuggestionProps) => {
					if (!container) return;
					// Recreate with new props
					try { unmount(component); } catch {}
					component = mount(MentionList, {
						target: container,
						props: {
							items: props.items,
							command: props.command,
						},
					});
					mentionListRef = component;

					const { decorationNode } = props as any;
					if (decorationNode) {
						const rect = decorationNode.getBoundingClientRect();
						const editorRect = decorationNode.closest('.rich-editor')?.getBoundingClientRect();
						if (editorRect) {
							container.style.left = `${rect.left - editorRect.left}px`;
							container.style.top = `${rect.bottom - editorRect.top + 4}px`;
						}
					}
				},
				onKeyDown: (props: { event: KeyboardEvent }) => {
					if (props.event.key === 'Escape') {
						return true;
					}
					return mentionListRef?.onKeyDown?.(props.event) ?? false;
				},
				onExit: () => {
					if (component) {
						try { unmount(component); } catch {}
					}
					container?.remove();
				},
			};
		},
	};
}
