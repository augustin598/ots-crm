<script lang="ts">
	import {
		getClientSecondaryEmails,
		createClientSecondaryEmail,
		deleteClientSecondaryEmail,
		updateClientSecondaryEmailAccess
	} from '$lib/remotes/client-secondary-emails.remote';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import {
		CLIENT_ROLE_PRESETS,
		getClientRolePreset,
		type ClientRolePresetId
	} from '$lib/config/team';
	import TeamInviteModal from './TeamInviteModal.svelte';

	let { clientId }: { clientId: string } = $props();

	const secondaryEmailsQuery = $derived(getClientSecondaryEmails(clientId));
	const secondaryEmails = $derived(secondaryEmailsQuery?.current ?? []);

	let inviteOpen = $state(false);

	async function submitInvite({ email, role }: { email: string; role: ClientRolePresetId }) {
		const preset = getClientRolePreset(role);
		if (!preset) throw new Error('Rol invalid');
		const created = await createClientSecondaryEmail({
			clientId,
			email
		}).updates(secondaryEmailsQuery);
		if (created?.id) {
			await updateClientSecondaryEmailAccess({
				secondaryEmailId: created.id,
				accessFlags: preset.flags
			}).updates(secondaryEmailsQuery);
		}
		toast.success(`${email} adăugat cu rolul ${preset.label}.`);
	}

	async function handleDelete(secondaryEmailId: string, email: string) {
		if (!confirm(`Sigur scoți ${email} din echipă?`)) return;
		try {
			await deleteClientSecondaryEmail({ secondaryEmailId }).updates(secondaryEmailsQuery);
			toast.success('Membru scos din echipă.');
		} catch (e) {
			clientLogger.apiError('client_team_delete', e);
			toast.error('Eroare la ștergere.');
		}
	}
</script>

<div class="space-y-2">
	<div class="flex items-center justify-between">
		<Label>Emailuri Secundare (acces portal)</Label>
		<Button type="button" variant="outline" size="sm" onclick={() => (inviteOpen = true)}>
			<PlusIcon class="h-3.5 w-3.5 mr-1" />
			Adaugă
		</Button>
	</div>
	{#if secondaryEmails.length > 0}
		<div class="space-y-2">
			{#each secondaryEmails as se (se.id)}
				<div class="rounded-lg border bg-card px-3 py-2.5 group hover:bg-muted/30 transition-colors">
					<div class="flex items-center gap-2">
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium">{se.email}</p>
							{#if se.label}
								<p class="text-xs text-muted-foreground">{se.label}</p>
							{/if}
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="h-7 w-7 p-0 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
							onclick={() => handleDelete(se.id, se.email)}
						>
							<TrashIcon class="h-3.5 w-3.5" />
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
	<p class="text-xs text-muted-foreground">
		Contactul principal are acces complet automat. Permisiunile contactelor secundare se gestionează
		din pagina Team (Roluri & Permisiuni).
	</p>
</div>

<TeamInviteModal
	bind:open={inviteOpen}
	title="Invită contact secundar"
	description="Adaugă un email secundar pentru acest client. Setezi rolul în pasul următor."
	roles={CLIENT_ROLE_PRESETS}
	defaultRole={'marketing' as ClientRolePresetId}
	submit={submitInvite}
/>
