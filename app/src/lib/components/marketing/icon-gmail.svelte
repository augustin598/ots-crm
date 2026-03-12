<script lang="ts">
	let { class: className = 'h-4 w-4' }: { class?: string } = $props();
</script>

<svg viewBox="0 0 24 24" class={className} xmlns="http://www.w3.org/2000/svg">
	<path fill="#4285F4" d="M22 6V18C22 19.1 21.1 20 20 20H18V9.24L12 13.24L6 9.24V20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4H4.51L12 9.5L19.49 4H20C21.1 4 22 4.9 22 6Z"/>
	<path fill="#EA4335" d="M6 20V9.24L12 13.24L18 9.24V20H6Z" opacity="0.3"/>
</svg>
