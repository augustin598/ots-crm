<script lang="ts">
	let {
		on,
		onchange,
		label
	}: { on: boolean; onchange: (value: boolean) => void; label?: string } = $props();
</script>

<label class="cl-switch">
	<input
		type="checkbox"
		checked={on}
		aria-label={label}
		onchange={(e) => onchange(e.currentTarget.checked)}
	/>
	<span class="cl-switch-slider"></span>
</label>
