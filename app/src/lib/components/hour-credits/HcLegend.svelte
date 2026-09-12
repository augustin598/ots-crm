<script lang="ts">
	let { spentLabel = 'consumat 30 z' }: { spentLabel?: string } = $props();
</script>

<div class="hc-legend">
	<span><i class="hc-dot" style="background:var(--cl-accent)"></i> disponibil</span>
	<span><i class="hc-dot" style="background:var(--hc-hatch-res)"></i> rezervat de taskuri</span>
	<span><i class="hc-dot" style="background:var(--hc-spent)"></i> {spentLabel}</span>
	<span><i class="hc-dot" style="background:var(--hc-hatch-neg)"></i> depășire</span>
</div>
