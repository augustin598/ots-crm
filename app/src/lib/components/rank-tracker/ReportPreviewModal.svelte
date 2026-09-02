<script lang="ts">
	// Previzualizarea raportului pe email — port 1:1 din `RTReportPreview` (rank-modals.jsx).
	import MailIcon from '@lucide/svelte/icons/mail';
	import XIcon from '@lucide/svelte/icons/x';
	import SendIcon from '@lucide/svelte/icons/send';
	import { psiDialog } from '../pagespeed/lib';
	import RtDist from './RtDist.svelte';
	import { isoWeekInterval, isoWeekKey, type RankBucket } from '$lib/logic/rank-tracker';

	interface Row {
		id: string;
		keyword: string;
		position: number | null;
		delta7: number | null;
	}

	let {
		title,
		hour,
		recipients,
		rows,
		vis,
		avg,
		buckets,
		total,
		lastDay,
		sending = false,
		onclose,
		onsend
	}: {
		title: string;
		hour: string;
		recipients: string[];
		rows: Row[];
		vis: number;
		avg: number | null;
		buckets: Record<RankBucket, number>;
		total: number;
		lastDay: string;
		sending?: boolean;
		onclose: () => void;
		onsend: () => void;
	} = $props();

	const week = $derived(isoWeekInterval(isoWeekKey(new Date())));
	const movers = $derived([...rows].sort((a, b) => (b.delta7 ?? 0) - (a.delta7 ?? 0)));
	const up = $derived(movers.filter((r) => (r.delta7 ?? 0) > 0).slice(0, 5));
	const down = $derived([...movers].reverse().filter((r) => (r.delta7 ?? 0) < 0).slice(0, 5));
</script>

<div class="psi-modal-back" onclick={onclose} role="presentation">
	<div
		class="psi-modal lg"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Escape') onclose();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		{@attach psiDialog}
		aria-label="Previzualizare raport poziții"
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><MailIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">{title}</div>
				<div class="psi-modal-sub">
					săptămâna {week} · {recipients.length}
					{recipients.length === 1 ? 'destinatar' : 'destinatari'}
				</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="psi-mail">
				<div class="psi-mail-head">
					<h4>Poziții Google organic · {title.replace('Raport poziții — ', '')}</h4>
					<p>{week} · {total} cuvinte cheie · verificare zilnică {hour}</p>
				</div>
				<div class="psi-mail-kpis">
					<div class="psi-mail-kpi"><span>Vizibilitate</span><b>{vis}%</b></div>
					<div class="psi-mail-kpi"><span>Poziție medie</span><b>{avg ?? '—'}</b></div>
					<div class="psi-mail-kpi"><span>În top 3</span><b>{buckets['1-3']}</b></div>
					<div class="psi-mail-kpi"><span>În top 10</span><b>{buckets['1-3'] + buckets['4-10']}</b></div>
				</div>
				<div class="psi-mail-body">
					<div style="margin-bottom: 16px"><RtDist {buckets} {total} /></div>
					<table class="psi-mail-table">
						<thead>
							<tr><th>Au urcat în ultimele 7 zile</th><th class="r">Acum</th><th class="r">Câștig</th></tr>
						</thead>
						<tbody>
							{#each up as r (r.id)}
								<tr>
									<td>{r.keyword}</td>
									<td class="r">{r.position == null ? '100+' : '#' + r.position}</td>
									<td class="r" style="color: var(--psi-good-text); font-weight: 700">+{r.delta7}</td>
								</tr>
							{:else}
								<tr><td colspan="3" style="color: var(--cl-text-3)">nicio urcare în această săptămână</td></tr>
							{/each}
						</tbody>
					</table>
					{#if down.length > 0}
						<div class="psi-mail-alert" style="margin-top: 18px">
							<b>Au scăzut ({down.length})</b>
							{#each down as r (r.id)}
								<div>{r.keyword} — {r.position == null ? 'ieșit din top 100' : 'poziția ' + r.position} ({r.delta7})</div>
							{/each}
						</div>
					{/if}
				</div>
				<div class="psi-mail-foot">
					Generat automat de OTS Rank Tracker · date SERP {lastDay || 'din ultima rulare'}, {hour}
				</div>
			</div>
		</div>
		<div class="psi-modal-foot">
			<button class="cl-btn-secondary" onclick={onclose}>Închide</button>
			<button class="cl-btn-primary" disabled={sending || recipients.length === 0} onclick={onsend}>
				<SendIcon size={13} />
				{sending ? 'Se trimite…' : 'Trimite raportul'}
			</button>
		</div>
	</div>
</div>
