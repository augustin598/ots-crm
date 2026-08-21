<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { focusTrap } from '$lib/actions/focus-trap';
	import { Check, Loader2, X } from '@lucide/svelte';

	interface Props {
		open: boolean;
		taskTitle: string;
		/** Termenul deja existent pe task, „YYYY-MM-DD", ca punct de plecare. */
		currentDueDate?: string | null;
		/** Grupul WhatsApp legat, dacă există: îi spunem omului cine află. */
		groupSubject?: string | null;
		loading?: boolean;
		onCancel: () => void;
		onConfirm: (dueDate: string | null) => void;
	}

	let {
		open = $bindable(),
		taskTitle,
		currentDueDate = null,
		groupSubject = null,
		loading = false,
		onCancel,
		onConfirm
	}: Props = $props();

	let dueDate = $derived(currentDueDate ?? '');

	function confirm() {
		onConfirm(dueDate ? dueDate : null);
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget && !loading) onCancel();
		}}
	>
		<div
			class="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
			role="dialog"
			aria-modal="true"
			aria-labelledby="approve-dialog-title"
			use:focusTrap={{ active: open, onEscape: onCancel, initialFocus: '#approve-due-date' }}
		>
			<h2 id="approve-dialog-title" class="text-base font-bold">Aprobi task-ul?</h2>
			<p class="mt-1 truncate text-sm text-muted-foreground">{taskTitle}</p>

			<div class="mt-4 space-y-2">
				<Label for="approve-due-date">Termen (opțional)</Label>
				<Input id="approve-due-date" type="date" bind:value={dueDate} />
				<p class="text-xs text-muted-foreground">
					{#if groupSubject}
						Grupul „{groupSubject}" află că ai acceptat{dueDate ? ', cu termenul de mai sus' : ''}.
					{:else}
						Fără termen, anunțul spune doar că ai acceptat.
					{/if}
				</p>
			</div>

			<div class="mt-5 flex justify-end gap-2">
				<Button variant="outline" onclick={onCancel} disabled={loading}>
					<X class="mr-2 h-4 w-4" />
					Anulează
				</Button>
				<Button onclick={confirm} disabled={loading}>
					{#if loading}
						<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					{:else}
						<Check class="mr-2 h-4 w-4" />
					{/if}
					Aprobă
				</Button>
			</div>
		</div>
	</div>
{/if}
