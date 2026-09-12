<script lang="ts">
	let {
		checked,
		onchange,
		label,
		disabled = false
	}: {
		checked: boolean;
		onchange: (next: boolean) => void;
		label: string;
		disabled?: boolean;
	} = $props();
</script>

<button
	type="button"
	class="hc-switch"
	class:on={checked}
	role="switch"
	aria-checked={checked}
	aria-label={label}
	{disabled}
	onclick={() => onchange(!checked)}
></button>
