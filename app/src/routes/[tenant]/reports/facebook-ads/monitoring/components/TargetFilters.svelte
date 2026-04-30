<script lang="ts">
	interface Client { id: string; name: string }
	interface Props {
		clients: Client[];
		clientId: string;
		status: 'all' | 'active' | 'muted' | 'inactive';
		deviation: 'all' | 'over' | 'under' | 'ok';
		search: string;
		onChange: (next: { clientId: string; status: string; deviation: string; search: string }) => void;
	}
	let { clients, clientId = $bindable(), status = $bindable(), deviation = $bindable(), search = $bindable(), onChange }: Props = $props();

	function emit() {
		onChange({ clientId, status, deviation, search });
	}
</script>

<div class="flex flex-wrap gap-3 items-center">
	<select bind:value={clientId} onchange={emit} class="h-9 rounded-md border px-3 bg-background">
		<option value="">Toți clienții</option>
		{#each clients as c}
			<option value={c.id}>{c.name}</option>
		{/each}
	</select>
	<select bind:value={status} onchange={emit} class="h-9 rounded-md border px-3 bg-background">
		<option value="all">Toate</option>
		<option value="active">Active</option>
		<option value="muted">Muted</option>
		<option value="inactive">Inactive</option>
	</select>
	<select bind:value={deviation} onchange={emit} class="h-9 rounded-md border px-3 bg-background">
		<option value="all">Orice deviație</option>
		<option value="over">Peste target</option>
		<option value="under">Sub target</option>
		<option value="ok">În target</option>
	</select>
	<input
		type="search"
		placeholder="Caută campanie / client…"
		bind:value={search}
		oninput={emit}
		class="h-9 rounded-md border px-3 bg-background flex-1 min-w-[200px]"
	/>
</div>
