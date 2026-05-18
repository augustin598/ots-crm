<!-- src/lib/components/client-task/client-task-meet-modal.svelte -->
<script lang="ts">
	import { scheduleMeet, getTask } from '$lib/remotes/tasks.remote';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import { SvelteSet } from 'svelte/reactivity';

	type Person = {
		id: string;
		firstName?: string | null;
		lastName?: string | null;
		email?: string | null;
	};

	type Props = {
		open: boolean;
		taskId: string;
		taskTitle: string;
		availableInvitees: Person[];
		defaultInviteeIds?: string[];
		onClose: () => void;
	};

	let {
		open,
		taskId,
		taskTitle,
		availableInvitees,
		defaultInviteeIds = [],
		onClose
	}: Props = $props();

	let meetTitle = $state('');
	let meetDate = $state('');
	let meetTime = $state('10:00');
	let meetDuration = $state(30);
	let selectedIds = new SvelteSet<string>();
	let addToCalendar = $state(true);
	let sendEmail = $state(true);
	let saving = $state(false);

	$effect(() => {
		if (open) {
			meetTitle = `Meeting · ${taskTitle}`;
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			meetDate = tomorrow.toISOString().slice(0, 10);
			// Mutate the existing SvelteSet (reactive by itself, no $state reassignment needed)
			selectedIds.clear();
			for (const id of defaultInviteeIds) selectedIds.add(id);
		}
	});

	function displayName(p: Person): string {
		const full = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
		return full || p.email || p.id;
	}

	function toggleInvitee(id: string) {
		if (selectedIds.has(id)) selectedIds.delete(id);
		else selectedIds.add(id);
	}

	async function handleSave() {
		if (!meetDate || !meetTime || !meetTitle.trim()) return;
		saving = true;
		try {
			// Backend currently only stores meetTime + meetDurationMinutes.
			// title/invitees/addToCalendar/sendEmail are UI-only (future backend extension).
			await scheduleMeet({
				taskId,
				meetTime: `${meetDate}T${meetTime}`,
				meetDurationMinutes: meetDuration
			}).updates(getTask(taskId));
			toast.success('Meeting programat');
			onClose();
		} catch (e) {
			clientLogger.apiError('schedule_meet', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la programare');
		} finally {
			saving = false;
		}
	}

	const summary = $derived(
		meetDate && meetTime
			? `${meetDate} · ${meetTime} · ${meetDuration} min`
			: 'Completează data și ora'
	);
</script>

{#if open}
	<div
		class="ct-meet-overlay fixed inset-0 z-[200] flex items-center justify-center bg-[#0f172a]/55"
		role="dialog"
		aria-modal="true"
		aria-labelledby="meet-modal-title"
		tabindex={0}
		onkeydown={(e) => {
			if (e.key === 'Escape') onClose();
		}}
	>
		<!-- Backdrop click target -->
		<button
			type="button"
			class="absolute inset-0 cursor-default"
			aria-label="Închide dialog"
			tabindex={-1}
			onclick={onClose}
		></button>
		<div
			class="ct-meet-modal relative z-10 w-[560px] max-w-[90vw] rounded-[14px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.25)]"
			role="document"
		>
			<div class="ct-meet-head flex items-start justify-between border-b border-[#e5e9f0] p-5">
				<div class="flex items-start gap-3">
					<span
						class="grid h-10 w-10 place-items-center rounded-[9px] bg-[#10b981]/10 text-[#10b981]"
					>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
							<path d="M16 8.5V12.5L20 16V5L16 8.5Z" fill="#10b981" />
							<path
								d="M3 6V18C3 18.5523 3.44772 19 4 19H14C14.5523 19 15 18.5523 15 18V14L11 14V6H3Z"
								fill="#a7f3d0"
							/>
						</svg>
					</span>
					<div>
						<h2 id="meet-modal-title" class="text-[16px] font-bold text-[#0f172a]">
							Programează Google Meet
						</h2>
						<p class="mt-0.5 text-[12px] text-[#94a3b8]">
							Linkul Meet va fi generat și trimis participanților
						</p>
					</div>
				</div>
				<button
					type="button"
					class="ct-meet-close grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
					onclick={onClose}
					aria-label="Închide"
				>
					<XIcon class="h-4 w-4" />
				</button>
			</div>

			<div class="ct-meet-body flex flex-col gap-4 p-5">
				<div class="ct-meet-field flex flex-col gap-1.5">
					<label
						for="meet-title"
						class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]"
					>
						Titlu meeting
					</label>
					<input
						id="meet-title"
						type="text"
						bind:value={meetTitle}
						class="rounded-[7px] border border-[#d5dbe5] px-2.5 py-2 text-[13px] text-[#0f172a] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
					/>
				</div>

				<div class="ct-meet-grid grid grid-cols-3 gap-2.5">
					<div class="ct-meet-field flex flex-col gap-1.5">
						<label
							for="meet-date"
							class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]"
							>Dată</label
						>
						<input
							id="meet-date"
							type="date"
							bind:value={meetDate}
							class="rounded-[7px] border border-[#d5dbe5] px-2.5 py-2 text-[13px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
						/>
					</div>
					<div class="ct-meet-field flex flex-col gap-1.5">
						<label
							for="meet-time"
							class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]"
							>Oră</label
						>
						<input
							id="meet-time"
							type="time"
							bind:value={meetTime}
							class="rounded-[7px] border border-[#d5dbe5] px-2.5 py-2 text-[13px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
						/>
					</div>
					<div class="ct-meet-field flex flex-col gap-1.5">
						<label
							for="meet-duration"
							class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]"
							>Durată</label
						>
						<select
							id="meet-duration"
							bind:value={meetDuration}
							class="rounded-[7px] border border-[#d5dbe5] px-2.5 py-2 text-[13px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
						>
							<option value={15}>15 min</option>
							<option value={30}>30 min</option>
							<option value={45}>45 min</option>
							<option value={60}>1 oră</option>
							<option value={90}>1h 30 min</option>
						</select>
					</div>
				</div>

				<div class="ct-meet-field flex flex-col gap-1.5">
					<span
						id="meet-invitees-label"
						class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]"
					>
						Participanți ({selectedIds.size})
					</span>
					<div
						class="ct-meet-invitees flex flex-wrap gap-1.5"
						aria-labelledby="meet-invitees-label"
					>
						{#each availableInvitees as p (p.id)}
							{@const sel = selectedIds.has(p.id)}
							<button
								type="button"
								class={[
									'ct-meet-invitee inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
									sel
										? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
										: 'border-[#e5e9f0] bg-white text-[#475569] hover:border-[#1877F2]'
								].join(' ')}
								onclick={() => toggleInvitee(p.id)}
							>
								<span
									class="grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold text-white"
									style:background-color={avatarColor(p.email ?? p.id)}
								>
									{avatarInitials(p.firstName ?? null, p.lastName ?? null, p.email ?? null)}
								</span>
								<span>{displayName(p)}</span>
								{#if sel}
									<CheckIcon class="h-3 w-3" />
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<label class="ct-meet-check flex items-center gap-2 text-[12.5px] text-[#0f172a]">
					<input type="checkbox" bind:checked={addToCalendar} class="h-4 w-4 accent-[#1877F2]" />
					Adaugă în Google Calendar
				</label>
				<label class="ct-meet-check flex items-center gap-2 text-[12.5px] text-[#0f172a]">
					<input type="checkbox" bind:checked={sendEmail} class="h-4 w-4 accent-[#1877F2]" />
					Trimite invitație pe email + notificare în CRM
				</label>
			</div>

			<div class="ct-meet-foot flex items-center justify-between border-t border-[#e5e9f0] p-4">
				<div class="ct-meet-summary inline-flex items-center gap-1.5 text-[12px] text-[#475569]">
					<CalendarIcon class="h-3.5 w-3.5" />
					{summary}
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="ct-meet-cancel rounded-[7px] px-3 py-2 text-[12.5px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
						onclick={onClose}
					>
						Anulează
					</button>
					<button
						type="button"
						class="ct-meet-save inline-flex items-center gap-1.5 rounded-[7px] bg-[#1877F2] px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#0d5cc7] disabled:opacity-50"
						onclick={handleSave}
						disabled={saving || !meetDate || !meetTime || !meetTitle.trim()}
					>
						<CheckIcon class="h-3.5 w-3.5" />
						{saving ? 'Se programează...' : 'Programează & generează link'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
