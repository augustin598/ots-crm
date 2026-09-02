<script lang="ts">
	// Drawer per cuvânt cheie: istoric poziții 30 zile, share of voice pe competitori,
	// canibalizare (URL-uri multiple), URL țintă vs URL care rankează.
	import XIcon from '@lucide/svelte/icons/x';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { fmtPosition } from '$lib/logic/rank-tracker';
	import type { RankKeywordDetail } from '$lib/server/rank-tracker/projects-data';

	let {
		keyword,
		domain,
		days,
		shareOfVoice,
		onclose,
		ondelete
	}: {
		keyword: RankKeywordDetail;
		domain: string;
		days: string[];
		shareOfVoice: Record<string, number>;
		onclose: () => void;
		ondelete: (id: string) => void;
	} = $props();

	// Sparkline de poziții (inversat: poziția 1 sus). Golurile rămân întreruperi.
	const W = 520;
	const H = 120;
	const PAD = 16;
	const MAXPOS = 100;
	const points = $derived(
		keyword.spark30.map((p, i) => {
			if (p == null) return null;
			const x = PAD + (i / Math.max(1, keyword.spark30.length - 1)) * (W - 2 * PAD);
			const y = PAD + (Math.min(p, MAXPOS) - 1) / (MAXPOS - 1) * (H - 2 * PAD);
			return { x, y, p, i };
		})
	);
	const segments = $derived.by(() => {
		const segs: string[] = [];
		let cur: string[] = [];
		for (const pt of points) {
			if (pt == null) {
				if (cur.length) segs.push(cur.join(' '));
				cur = [];
			} else cur.push(`${pt.x},${pt.y}`);
		}
		if (cur.length) segs.push(cur.join(' '));
		return segs;
	});
	const dots = $derived(points.filter((p): p is NonNullable<typeof p> => p != null));

	const sovEntries = $derived(
		[{ dom: domain, vis: 0 }, ...Object.entries(shareOfVoice).map(([dom, vis]) => ({ dom, vis }))]
			.filter((e, i) => i === 0 || e.dom !== domain)
			.sort((a, b) => b.vis - a.vis)
			.slice(0, 8)
	);
	const maxSov = $derived(Math.max(1, ...Object.values(shareOfVoice), keyword.competitors ? 0 : 0));
</script>

<div class="psi-modal-back" onclick={onclose} role="presentation">
	<div
		class="psi-drawer"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onclose(); }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-label="Detalii cuvânt cheie"
	>
		<div class="psi-drawer-head">
			<div>
				<div class="rk-drawer-kw">{keyword.keyword}</div>
				<div class="psi-modal-sub">{keyword.device === 'mobile' ? 'mobil' : 'desktop'}{keyword.location ? ` · ${keyword.location}` : ''}{keyword.tag ? ` · ${keyword.tag}` : ''}</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>

		<div class="psi-drawer-body">
			<div class="cl-kpis" style="margin-bottom:12px">
				<div class="cl-kpi"><div class="cl-kpi-val">{fmtPosition(keyword.position)}</div><div class="cl-kpi-lbl">Poziție</div></div>
				<div class="cl-kpi"><div class="cl-kpi-val">{keyword.page ?? '—'}</div><div class="cl-kpi-lbl">Pagina</div></div>
				<div class="cl-kpi"><div class="cl-kpi-val">{fmtPosition(keyword.best)}</div><div class="cl-kpi-lbl">Best</div></div>
				<div class="cl-kpi"><div class="cl-kpi-val">{keyword.volume != null ? keyword.volume.toLocaleString('ro-RO') : '—'}</div><div class="cl-kpi-lbl">Volum</div></div>
			</div>

			<h3 class="cl-section-title" style="font-size:13px">Istoric poziție (30 zile)</h3>
			<svg viewBox="0 0 {W} {H}" style="width:100%;height:120px" role="img" aria-label="Istoric poziție">
				{#each segments as seg, i (i)}
					<polyline points={seg} class="rk-chart-line" />
				{/each}
				{#each dots as d (d.i)}
					<circle cx={d.x} cy={d.y} r="2.5" class="rk-chart-dot"><title>{days[d.i]?.slice(5)}: poziția {d.p}</title></circle>
				{/each}
			</svg>

			{#if keyword.aiOverview !== 'absent'}
				<p class="cl-muted" style="margin-top:8px">AI Overview: <strong>{keyword.aiOverview === 'cited' ? 'domeniul e citat ca sursă' : 'apare, fără citare'}</strong></p>
			{/if}

			{#if keyword.cannibalization.flagged}
				<div class="cl-callout danger" style="margin-top:12px">
					<TriangleAlertIcon size={15} />
					<div>
						<strong>Canibalizare:</strong> mai multe URL-uri au rankat pentru acest cuvânt cheie în ultimele 30 de zile.
						<ul style="margin:6px 0 0;padding-left:18px">
							{#each keyword.cannibalization.urls as u (u)}<li><a href={u} target="_blank" rel="noopener">{u}</a></li>{/each}
						</ul>
					</div>
				</div>
			{/if}

			<h3 class="cl-section-title" style="font-size:13px;margin-top:16px">URL</h3>
			<p class="cl-muted">
				Rankează: {#if keyword.rankingUrl}<a href={keyword.rankingUrl} target="_blank" rel="noopener">{keyword.rankingUrl} <ExternalLinkIcon size={11} /></a>{:else}—{/if}
			</p>
			{#if keyword.targetUrl && keyword.rankingUrl && keyword.targetUrl !== keyword.rankingUrl}
				<p class="cl-form-error">URL-ul care rankează diferă de URL-ul țintă ({keyword.targetUrl}).</p>
			{/if}

			{#if sovEntries.length}
				<h3 class="cl-section-title" style="font-size:13px;margin-top:16px">Share of voice (competitori)</h3>
				{#each sovEntries as e (e.dom)}
					<div class="rk-sov-row">
						<span style="width:130px;font-size:12px" class="cl-truncate">{e.dom}</span>
						<div class="rk-sov-bar"><div class="rk-sov-fill" style:width="{Math.min(100, (e.vis / maxSov) * 100)}%"></div></div>
						<span style="font-size:12px;width:44px;text-align:right">{e.vis.toFixed(0)}%</span>
					</div>
				{/each}
			{/if}
		</div>

		<div class="psi-drawer-foot">
			<button class="cl-btn-secondary cl-btn-danger" onclick={() => ondelete(keyword.id)}><Trash2Icon size={14} /> Șterge cuvântul cheie</button>
		</div>
	</div>
</div>
