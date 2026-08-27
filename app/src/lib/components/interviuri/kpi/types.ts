import type { FixedCostRow, PlatformId } from '$lib/logic/interviuri-kpi';

/** Platformă de ads așa cum e afișată în pagină: meta + cont + suma din perioadă. */
export interface SourcePlatform {
	id: PlatformId;
	label: string;
	color: string;
	soft: string;
	/** „Nume cont · id" sau null dacă clienții interviurilor n-au cont pe platformă */
	account: string | null;
	syncedAt: string | null;
	/** lei în perioada selectată */
	amount: number;
}

/** Modificare parțială pe un rând de cheltuială fixă (editorul inline). */
export type FixedPatch = Partial<Omit<FixedCostRow, 'id'>>;
