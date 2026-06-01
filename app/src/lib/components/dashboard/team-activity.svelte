<script lang="ts">
	import type { TeamMember } from './types';

	let { team }: { team: TeamMember[] } = $props();

	const online = $derived(team.filter((t) => t.status === 'online').length);
	const totalActions = $derived(team.reduce((s, t) => s + t.actions, 0));
	const GRADS = [
		['var(--chart-1)', 'var(--chart-2)'],
		['var(--chart-2)', 'var(--chart-3)'],
		['var(--chart-3)', 'var(--chart-4)'],
		['var(--chart-4)', 'var(--chart-5)'],
		['var(--chart-5)', 'var(--chart-1)']
	];
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Echipa azi</div>
			<div class="dash-card-sub">{online} online · {totalActions} acțiuni azi</div>
		</div>
	</div>
	{#if team.length}
		<div class="dash-team-list">
			{#each team as t, i (t.name)}
				{@const g = GRADS[i % GRADS.length]}
				<div class="dash-team-row">
					<div class="dash-team-avatar" style="background:linear-gradient(135deg, {g[0]}, {g[1]})">
						{t.avatar}
						<span class="dash-team-status {t.status}"></span>
					</div>
					<div class="dash-team-info">
						<div class="dash-team-name">{t.name}</div>
						<div class="dash-team-role">{t.role}</div>
					</div>
					<div class="dash-team-actions">{t.actions} acț.</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="dash-empty">Niciun membru în echipă.</div>
	{/if}
</div>
