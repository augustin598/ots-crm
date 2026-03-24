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
					const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
					return name.includes(q) || (u.email || '').toLowerCase().includes(q);
				})
				.slice(0, 5);
		},
		render: () => {
			let container: HTMLDivElement | null = null;
			let component: Record<string, any> | null = null;

			function cleanupComponent() {
				if (component) {
					try { unmount(component); } catch (e) {
						console.warn('MentionList unmount warning:', e);
					}
					component = null;
				}
			}

			function positionContainer(props: SuggestionProps) {
				if (!container) return;
				const { decorationNode } = props as any;
				if (!decorationNode) return;
				const rect = decorationNode.getBoundingClientRect();
				const editorRect = decorationNode.closest('.rich-editor')?.getBoundingClientRect();
				if (editorRect) {
					container.style.left = `${rect.left - editorRect.left}px`;
					container.style.top = `${rect.bottom - editorRect.top + 4}px`;
				}
			}

			function mountComponent(props: SuggestionProps) {
				if (!container) return;
				cleanupComponent();
				component = mount(MentionList, {
					target: container,
					props: {
						items: props.items,
						command: props.command,
					},
				});
			}

			return {
				onStart: (props: SuggestionProps) => {
					container = document.createElement('div');
					container.style.position = 'absolute';
					container.style.zIndex = '50';

					mountComponent(props);
					positionContainer(props);

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
					mountComponent(props);
					positionContainer(props);
				},
				onKeyDown: (props: { event: KeyboardEvent }) => {
					if (props.event.key === 'Escape') {
						return true;
					}
					return (component as any)?.onKeyDown?.(props.event) ?? false;
				},
				onExit: () => {
					cleanupComponent();
					container?.remove();
					container = null;
				},
			};
		},
	};
}
