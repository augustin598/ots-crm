<!-- src/lib/components/client-team/client-team-permissions-modal.svelte -->
<script lang="ts">
	import { focusTrap } from '$lib/actions/focus-trap';
	import XIcon from '@lucide/svelte/icons/x';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import {
		getClientSecondaryEmails,
		updateClientSecondaryEmailAccess
	} from '$lib/remotes/client-secondary-emails.remote';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import {
		ACCESS_CATEGORIES,
		ACCESS_CATEGORY_LABELS,
		CLIENT_ROLE_PRESETS,
		CLIENT_CUSTOM_PILL,
		detectClientRolePreset,
		getClientRolePreset,
		emptyAccessFlags,
		type AccessFlags,
		type ClientRolePresetId
	} from '$lib/config/team';

	type Props = {
		open: boolean;
		clientId: string;
		onClose: () => void;
	};

	let { open, clientId, onClose }: Props = $props();

	const membersQuery = $derived(getClientSecondaryEmails(clientId));
	const members = $derived(membersQuery?.current ?? []);

	let expandedId = $state<string | null>(null);
	let savingId = $state<string | null>(null);

	$effect(() => {
		if (open) {
			expandedId = null;
			// $effect: resetăm starea tranzientă a UI-ului la deschiderea modalului.
		}
	});

	function flagsOf(member: { accessFlagsResolved?: AccessFlags }): AccessFlags {
		return member.accessFlagsResolved ?? emptyAccessFlags();
	}

	function pillFor(flags: AccessFlags) {
		const id = detectClientRolePreset(flags);
		if (id === 'custom') return CLIENT_CUSTOM_PILL;
		return getClientRolePreset(id) ?? CLIENT_CUSTOM_PILL;
	}

	async function saveFlags(secondaryEmailId: string, flags: AccessFlags) {
		savingId = secondaryEmailId;
		try {
			await updateClientSecondaryEmailAccess({ secondaryEmailId, accessFlags: flags }).updates(
				membersQuery
			);
		} catch (e) {
			clientLogger.apiError('client_team_permissions_update', e);
			toast.error('Eroare la salvarea permisiunilor');
		} finally {
			savingId = null;
		}
	}

	function toggleCategory(
		member: { id: string; accessFlagsResolved?: AccessFlags },
		cat: (typeof ACCESS_CATEGORIES)[number]
	) {
		const next = { ...flagsOf(member), [cat]: !flagsOf(member)[cat] };
		void saveFlags(member.id, next);
	}

	function applyPreset(member: { id: string }, presetId: ClientRolePresetId) {
		const preset = getClientRolePreset(presetId);
		if (!preset) return;
		void saveFlags(member.id, { ...preset.flags });
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[200] flex items-center justify-center bg-[#0f172a]/55"
		onclick={onClose}
		onkeydown={() => {}}
		role="dialog"
		aria-modal="true"
		aria-labelledby="perm-title"
		tabindex={-1}
		use:focusTrap={{ active: open, onEscape: onClose }}
	>
		<div
			class="cteam-modal flex max-h-[85vh] w-[680px] max-w-[92vw] flex-col rounded-[16px] bg-white shadow-[0_30px_60px_rgba(15,23,42,0.3)]"
			onclick={(e) => e.stopPropagation()}
			role="none"
		>
			<div class="flex items-center justify-between border-b border-[#e5e9f0] p-5">
				<div class="flex items-center gap-2">
					<ShieldIcon class="h-4 w-4 text-[#1877F2]" />
					<h2 id="perm-title" class="text-[16px] font-bold text-[#0f172a]">Roluri & Permisiuni</h2>
				</div>
				<button
					type="button"
					class="grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
					onclick={onClose}
					aria-label="Închide"
				>
					<XIcon class="h-4 w-4" />
				</button>
			</div>

			<div class="flex-1 overflow-y-auto p-5">
				<p class="mb-4 text-[12.5px] text-[#64748b]">
					Contactul principal are automat acces complet. Mai jos controlezi ce vede fiecare coleg
					invitat — alege un rol predefinit sau bifează individual modulele.
				</p>

				{#if members.length === 0}
					<div
						class="rounded-[12px] border-2 border-dashed border-[#d5dbe5] p-6 text-center text-[13px] text-[#94a3b8]"
					>
						Niciun coleg invitat încă. Folosește „Invită coleg" pentru a adăuga primul membru.
					</div>
				{:else}
					<div class="flex flex-col gap-2.5">
						{#each members as m (m.id)}
							{@const flags = flagsOf(m)}
							{@const pill = pillFor(flags)}
							{@const isExpanded = expandedId === m.id}
							<div class="rounded-[12px] border border-[#e5e9f0] bg-white">
								<button
									type="button"
									class="flex w-full items-center gap-3 p-3.5 text-left"
									onclick={() => (expandedId = isExpanded ? null : m.id)}
									aria-expanded={isExpanded}
								>
									<div class="min-w-0 flex-1">
										<p class="truncate text-[13px] font-semibold text-[#0f172a]">{m.email}</p>
										{#if m.label}
											<p class="truncate text-[11.5px] text-[#94a3b8]">{m.label}</p>
										{/if}
									</div>
									<span
										class="rounded-full px-2.5 py-1 text-[11px] font-bold"
										style:color={pill.color}
										style:background-color={pill.bg}
									>
										{pill.label}
									</span>
									<ChevronDownIcon
										class={['h-4 w-4 text-[#94a3b8] transition-transform', isExpanded ? 'rotate-180' : ''].join(' ')}
									/>
								</button>

								{#if isExpanded}
									<div class="border-t border-[#eef1f6] p-3.5">
										<div class="mb-3 flex flex-wrap items-center gap-1.5">
											<span class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">
												Rol predefinit:
											</span>
											{#each CLIENT_ROLE_PRESETS as preset (preset.id)}
												<button
													type="button"
													class={[
														'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
														pill.id === preset.id
															? 'border-transparent text-white'
															: 'border-[#e5e9f0] text-[#475569] hover:border-[#1877F2]'
													].join(' ')}
													style:background-color={pill.id === preset.id ? preset.color : 'transparent'}
													disabled={savingId === m.id}
													onclick={() => applyPreset(m, preset.id)}
												>
													{preset.label}
												</button>
											{/each}
										</div>

										<div class="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
											{#each ACCESS_CATEGORIES as cat (cat)}
												<label
													class="flex cursor-pointer items-center gap-2 text-[12.5px] text-[#0f172a]"
												>
													<input
														type="checkbox"
														class="h-3.5 w-3.5 accent-[#1877F2]"
														checked={flags[cat]}
														disabled={savingId === m.id}
														onchange={() => toggleCategory(m, cat)}
													/>
													<span>{ACCESS_CATEGORY_LABELS[cat]}</span>
												</label>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex items-center justify-end gap-2 border-t border-[#e5e9f0] p-4">
				<button
					type="button"
					class="rounded-[7px] bg-[#1877F2] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#0d5cc7]"
					onclick={onClose}
				>
					Închide
				</button>
			</div>
		</div>
	</div>
{/if}
