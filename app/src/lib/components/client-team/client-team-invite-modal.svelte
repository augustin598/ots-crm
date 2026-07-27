<!-- src/lib/components/client-team/client-team-invite-modal.svelte -->
<script lang="ts">
	import { focusTrap } from '$lib/actions/focus-trap';
	import XIcon from '@lucide/svelte/icons/x';
	import MailIcon from '@lucide/svelte/icons/mail';
	import {
		createClientSecondaryEmail,
		getClientSecondaryEmails
	} from '$lib/remotes/client-secondary-emails.remote';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import {
		CLIENT_ROLE_PRESETS,
		getClientRolePreset,
		type ClientRolePresetId
	} from '$lib/config/team';

	type Props = {
		open: boolean;
		clientId: string;
		onClose: () => void;
	};

	let { open, clientId, onClose }: Props = $props();

	let email = $state('');
	let selectedRole = $state<ClientRolePresetId>('marketing');
	let saving = $state(false);

	$effect(() => {
		if (open) {
			email = '';
			selectedRole = 'marketing';
			// $effect is the correct place here: we reset transient UI state
			// in response to a prop change, not derive a computed value.
		}
	});

	async function handleInvite() {
		const trimmed = email.trim();
		const preset = getClientRolePreset(selectedRole);
		if (!trimmed || !preset) return;
		saving = true;
		try {
			const result = await createClientSecondaryEmail({
				clientId,
				email: trimmed,
				accessFlags: { ...preset.flags },
				sendInvite: true
			}).updates(getClientSecondaryEmails(clientId));

			if (result?.inviteSent) {
				toast.success(`Invitație trimisă la ${trimmed}`);
			} else {
				toast.warning(
					`${trimmed} a fost adăugat, dar emailul de invitație nu a putut fi trimis. Colegul se poate autentifica din pagina de login a portalului cu această adresă.`
				);
			}
			onClose();
		} catch (e) {
			clientLogger.apiError('client_secondary_invite', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la trimitere invitație');
		} finally {
			saving = false;
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[200] flex items-center justify-center bg-[#0f172a]/55"
		onclick={onClose}
		onkeydown={() => {}}
		role="dialog"
		aria-modal="true"
		aria-labelledby="invite-title"
		tabindex={-1}
		use:focusTrap={{ active: open, onEscape: onClose, initialFocus: '#invite-email' }}
	>
		<div
			class="cteam-modal w-[560px] max-w-[90vw] rounded-[16px] bg-white shadow-[0_30px_60px_rgba(15,23,42,0.3)]"
			onclick={(e) => e.stopPropagation()}
			role="none"
		>
			<div class="flex items-center justify-between border-b border-[#e5e9f0] p-5">
				<h2 id="invite-title" class="text-[16px] font-bold text-[#0f172a]">Invită coleg</h2>
				<button
					type="button"
					class="grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
					onclick={onClose}
					aria-label="Închide"
				>
					<XIcon class="h-4 w-4" />
				</button>
			</div>

			<div class="flex flex-col gap-4 p-5">
				<div class="cteam-fld flex flex-col gap-1.5">
					<label
						for="invite-email"
						class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]"
					>
						Email
					</label>
					<div class="relative">
						<MailIcon
							class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]"
						/>
						<input
							id="invite-email"
							type="email"
							bind:value={email}
							placeholder="coleg@firma.ro"
							class="w-full rounded-[7px] border border-[#d5dbe5] bg-white py-2 pl-9 pr-3 text-[13px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
						/>
					</div>
				</div>

				<div class="cteam-fld flex flex-col gap-1.5">
					<span
						id="invite-role-label"
						class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]"
					>
						Rol
					</span>
					<div
						class="cteam-role-grid grid grid-cols-2 gap-2"
						role="group"
						aria-labelledby="invite-role-label"
					>
						{#each CLIENT_ROLE_PRESETS as r (r.id)}
							<button
								type="button"
								class={[
									'flex flex-col items-start gap-1 rounded-[10px] border p-3 text-left transition-colors',
									selectedRole === r.id
										? 'border-[#1877F2] bg-[#f0f7ff]'
										: 'border-[#e5e9f0] bg-white hover:border-[#1877F2]'
								].join(' ')}
								onclick={() => (selectedRole = r.id)}
								aria-pressed={selectedRole === r.id}
							>
								<span class="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#0f172a]">
									<span class="h-1.5 w-1.5 rounded-full" style:background-color={r.color}></span>
									{r.label}
								</span>
								<span class="text-[11px] text-[#64748b]">{r.desc}</span>
							</button>
						{/each}
					</div>
				</div>
			</div>

			<div class="flex items-center justify-end gap-2 border-t border-[#e5e9f0] p-4">
				<button
					type="button"
					class="rounded-[7px] px-3 py-2 text-[12.5px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
					onclick={onClose}
				>
					Anulează
				</button>
				<button
					type="button"
					class="rounded-[7px] bg-[#1877F2] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#0d5cc7] disabled:opacity-50"
					onclick={handleInvite}
					disabled={saving || !email.trim()}
				>
					{saving ? 'Se trimite...' : 'Trimite invitație'}
				</button>
			</div>
		</div>
	</div>
{/if}
