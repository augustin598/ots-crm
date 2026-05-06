<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import UsersIcon from '@lucide/svelte/icons/users';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import { CLIENT_ROLE_PRESETS, CLIENT_PERMISSION_MATRIX } from '$lib/config/team';
	import ClientTeamEditor from '$lib/components/team/ClientTeamEditor.svelte';
	import TeamPermissionsMatrix from '$lib/components/team/TeamPermissionsMatrix.svelte';
	import TeamKpiStrip from '$lib/components/team/TeamKpiStrip.svelte';
	import { getClientSecondaryEmails } from '$lib/remotes/client-secondary-emails.remote';
	import { detectClientRolePreset } from '$lib/config/team';

	let { data }: { data: PageData } = $props();
	let permsOpen = $state(false);

	const secondariesQuery = $derived(getClientSecondaryEmails(data.clientId));
	const secondaries = $derived(secondariesQuery?.current ?? []);

	const totalMembers = $derived(secondaries.length + 1); // +1 for primary (you)
	const customRoleCount = $derived(
		secondaries.filter((s) => detectClientRolePreset(
			(s.accessFlagsResolved as never) ?? {
				invoices: false, contracts: false, tasks: false, marketing: false,
				reports: false, leads: false, accessData: false, backlinks: false, budgets: false
			}
		) === 'custom').length
	);
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-end justify-between gap-4 flex-wrap">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Echipa {data.clientName}</h1>
			<p class="text-sm text-muted-foreground mt-1">
				{totalMembers} membri activi · gestionează cine are acces la portalul firmei tale
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" onclick={() => (permsOpen = true)}>
				<LayersIcon class="mr-2 size-4" />
				Permisiuni
			</Button>
		</div>
	</div>

	<!-- Hero -->
	<div class="hero">
		<div class="hero-icon"><UsersIcon class="size-6" /></div>
		<div class="hero-text">
			<h3>Lucrează în echipă pe portalul tău</h3>
			<p>
				Adaugă colegii tăi pentru a colabora la campanii, a aproba creative-uri sau pentru a vedea
				rapoartele. Fiecare membru primește rolul lui — tu controlezi ce poate vedea și face.
			</p>
		</div>
	</div>

	<!-- KPI -->
	<TeamKpiStrip
		items={[
			{ label: 'Membri activi', value: totalMembers, foot: 'inclusiv contul principal' },
			{
				label: 'Roluri custom',
				value: customRoleCount,
				foot:
					customRoleCount > 0
						? 'permisiuni personalizate'
						: 'toți pe roluri standard',
				tone: customRoleCount > 0 ? 'warning' : 'success'
			}
		]}
	/>

	<!-- Editor: refolosit la `clients/[id]/edit` -->
	<ClientTeamEditor clientId={data.clientId} mode="client" />
</div>

<!-- Permissions modal -->
<Dialog.Root bind:open={permsOpen}>
	<Dialog.Content class="sm:max-w-[720px]">
		<Dialog.Header>
			<Dialog.Title>Roluri & ce poate face fiecare</Dialog.Title>
			<Dialog.Description>
				Permisiunile se acumulează — Proprietar are tot, Vizitator doar read-only.
			</Dialog.Description>
		</Dialog.Header>
		<TeamPermissionsMatrix roles={CLIENT_ROLE_PRESETS} permissions={CLIENT_PERMISSION_MATRIX} />
		<Dialog.Footer>
			<Button onclick={() => (permsOpen = false)}>Închide</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.hero {
		display: flex;
		gap: 14px;
		padding: 18px 20px;
		background: linear-gradient(
			135deg,
			color-mix(in oklch, var(--primary) 8%, var(--card)),
			var(--card)
		);
		border: 1px solid var(--border);
		border-radius: 14px;
		align-items: center;
	}
	.hero-icon {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		background: color-mix(in oklch, var(--primary) 15%, var(--card));
		color: var(--primary);
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.hero-text h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		color: var(--foreground);
	}
	.hero-text p {
		margin: 4px 0 0;
		font-size: 13px;
		color: var(--muted-foreground);
		line-height: 1.45;
	}
</style>
