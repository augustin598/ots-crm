/**
 * Google Ads campaign type specifications.
 * Shared between client components and server validation.
 */

export type GoogleAdsCampaignType = 'display' | 'pmax' | 'search' | 'demand-gen';

export const CAMPAIGN_TYPE_LABELS: Record<GoogleAdsCampaignType, string> = {
	display: 'Display (Responsive)',
	pmax: 'Performance Max',
	search: 'Search (Responsive)',
	'demand-gen': 'Demand Gen'
};

export interface TextFieldSpec {
	key: string;
	label: string;
	min: number;
	max: number;
	maxLength: number;
	required: boolean;
	hint?: string;
}

export interface ImageSlotSpec {
	key: string;
	label: string;
	aspectRatio: [number, number]; // [w, h] e.g. [1.91, 1]
	recommendedW: number;
	recommendedH: number;
	minW: number;
	minH: number;
	minCount: number;
	maxCount: number;
	maxFileSize: number; // bytes
	required: boolean;
}

export interface CampaignTypeSpec {
	label: string;
	description: string;
	textOnly: boolean;
	textFields: TextFieldSpec[];
	imageSlots: ImageSlotSpec[];
	maxVideos: number;
	minVideoSeconds?: number;
	maxVideoSeconds?: number;
}

export const GOOGLE_ADS_SPECS: Record<GoogleAdsCampaignType, CampaignTypeSpec> = {
	display: {
		label: 'Display (Responsive)',
		description: 'Anunțuri grafice adaptabile pentru Rețeaua de Display',
		textOnly: false,
		textFields: [
			{ key: 'headlines', label: 'Titluri', min: 1, max: 5, maxLength: 30, required: true, hint: 'Recomandat: 5 titluri unice' },
			{ key: 'longHeadline', label: 'Titlu lung', min: 1, max: 1, maxLength: 90, required: true },
			{ key: 'descriptions', label: 'Descrieri', min: 1, max: 5, maxLength: 90, required: true, hint: 'Recomandat: 5 descrieri' },
			{ key: 'businessName', label: 'Numele companiei', min: 1, max: 1, maxLength: 25, required: true }
		],
		imageSlots: [
			{ key: 'landscape_1_91', label: 'Landscape 1.91:1', aspectRatio: [1.91, 1], recommendedW: 1200, recommendedH: 628, minW: 600, minH: 314, minCount: 1, maxCount: 15, maxFileSize: 5 * 1024 * 1024, required: true },
			{ key: 'square_1_1', label: 'Pătrat 1:1', aspectRatio: [1, 1], recommendedW: 1200, recommendedH: 1200, minW: 300, minH: 300, minCount: 0, maxCount: 15, maxFileSize: 5 * 1024 * 1024, required: false },
			{ key: 'portrait_4_5', label: 'Portret 4:5', aspectRatio: [4, 5], recommendedW: 1200, recommendedH: 1500, minW: 320, minH: 400, minCount: 0, maxCount: 15, maxFileSize: 5 * 1024 * 1024, required: false },
			{ key: 'logo_1_1', label: 'Logo 1:1', aspectRatio: [1, 1], recommendedW: 1200, recommendedH: 1200, minW: 128, minH: 128, minCount: 0, maxCount: 5, maxFileSize: 5 * 1024 * 1024, required: false },
			{ key: 'logo_4_1', label: 'Logo 4:1', aspectRatio: [4, 1], recommendedW: 1200, recommendedH: 300, minW: 512, minH: 128, minCount: 0, maxCount: 5, maxFileSize: 5 * 1024 * 1024, required: false }
		],
		maxVideos: 5,
		maxVideoSeconds: 30
	},
	pmax: {
		label: 'Performance Max',
		description: 'Campanii cu performanță maximă pe toate rețelele Google',
		textOnly: false,
		textFields: [
			{ key: 'headlines', label: 'Titluri', min: 3, max: 15, maxLength: 30, required: true, hint: 'Recomandat: min. 1 titlu sub 15 caractere' },
			{ key: 'longHeadlines', label: 'Titluri lungi', min: 1, max: 5, maxLength: 90, required: true },
			{ key: 'descriptions', label: 'Descrieri', min: 2, max: 5, maxLength: 90, required: true, hint: 'Recomandat: min. 1 descriere sub 60 caractere' },
			{ key: 'businessName', label: 'Numele companiei', min: 1, max: 1, maxLength: 25, required: true }
		],
		imageSlots: [
			{ key: 'landscape_1_91', label: 'Landscape 1.91:1', aspectRatio: [1.91, 1], recommendedW: 1200, recommendedH: 628, minW: 600, minH: 314, minCount: 1, maxCount: 20, maxFileSize: 5 * 1024 * 1024, required: true },
			{ key: 'square_1_1', label: 'Pătrat 1:1', aspectRatio: [1, 1], recommendedW: 1200, recommendedH: 1200, minW: 300, minH: 300, minCount: 1, maxCount: 20, maxFileSize: 5 * 1024 * 1024, required: true },
			{ key: 'portrait_4_5', label: 'Portret 4:5', aspectRatio: [4, 5], recommendedW: 960, recommendedH: 1200, minW: 480, minH: 600, minCount: 0, maxCount: 20, maxFileSize: 5 * 1024 * 1024, required: false },
			{ key: 'logo_1_1', label: 'Logo 1:1', aspectRatio: [1, 1], recommendedW: 1200, recommendedH: 1200, minW: 128, minH: 128, minCount: 1, maxCount: 5, maxFileSize: 5 * 1024 * 1024, required: true },
			{ key: 'logo_4_1', label: 'Logo 4:1', aspectRatio: [4, 1], recommendedW: 1200, recommendedH: 300, minW: 512, minH: 128, minCount: 0, maxCount: 5, maxFileSize: 5 * 1024 * 1024, required: false }
		],
		maxVideos: 5,
		minVideoSeconds: 10
	},
	search: {
		label: 'Search (Responsive)',
		description: 'Anunțuri text responsive pentru Rețeaua de Căutare',
		textOnly: true,
		textFields: [
			{ key: 'headlines', label: 'Titluri', min: 3, max: 15, maxLength: 30, required: true, hint: 'Recomandat: 10-15 titluri unice' },
			{ key: 'descriptions', label: 'Descrieri', min: 2, max: 4, maxLength: 90, required: true },
			{ key: 'displayPath1', label: 'Cale afișare 1', min: 0, max: 1, maxLength: 15, required: false },
			{ key: 'displayPath2', label: 'Cale afișare 2', min: 0, max: 1, maxLength: 15, required: false }
		],
		imageSlots: [],
		maxVideos: 0
	},
	'demand-gen': {
		label: 'Demand Gen',
		description: 'Campanii de generare a cererii pe YouTube, Discover, Gmail',
		textOnly: false,
		textFields: [
			{ key: 'headlines', label: 'Titluri', min: 1, max: 5, maxLength: 40, required: true },
			{ key: 'longHeadline', label: 'Titlu lung', min: 0, max: 1, maxLength: 90, required: false },
			{ key: 'descriptions', label: 'Descrieri', min: 1, max: 5, maxLength: 90, required: true },
			{ key: 'businessName', label: 'Numele companiei', min: 1, max: 1, maxLength: 25, required: true }
		],
		imageSlots: [
			{ key: 'landscape_1_91', label: 'Landscape 1.91:1', aspectRatio: [1.91, 1], recommendedW: 1200, recommendedH: 628, minW: 600, minH: 314, minCount: 0, maxCount: 20, maxFileSize: 5 * 1024 * 1024, required: false },
			{ key: 'square_1_1', label: 'Pătrat 1:1', aspectRatio: [1, 1], recommendedW: 1200, recommendedH: 1200, minW: 300, minH: 300, minCount: 0, maxCount: 20, maxFileSize: 5 * 1024 * 1024, required: false },
			{ key: 'portrait_4_5', label: 'Portret 4:5', aspectRatio: [4, 5], recommendedW: 960, recommendedH: 1200, minW: 480, minH: 600, minCount: 0, maxCount: 20, maxFileSize: 5 * 1024 * 1024, required: false },
			{ key: 'vertical_9_16', label: 'Vertical 9:16 (Shorts)', aspectRatio: [9, 16], recommendedW: 1080, recommendedH: 1920, minW: 480, minH: 854, minCount: 0, maxCount: 20, maxFileSize: 5 * 1024 * 1024, required: false }
		],
		maxVideos: 5,
		maxVideoSeconds: 180
	}
};

export const GOOGLE_ADS_CAMPAIGN_TYPES = Object.keys(GOOGLE_ADS_SPECS) as GoogleAdsCampaignType[];

/** Validate image dimensions against a slot spec. 5% aspect ratio tolerance. */
export function validateImageDimensions(
	w: number,
	h: number,
	slot: ImageSlotSpec
): { valid: boolean; error?: string } {
	if (w < slot.minW || h < slot.minH) {
		return { valid: false, error: `Dimensiune minimă: ${slot.minW}x${slot.minH}px (ai ${w}x${h}px)` };
	}
	const tolerance = 0.05;
	const expectedRatio = slot.aspectRatio[0] / slot.aspectRatio[1];
	const actualRatio = w / h;
	if (Math.abs(actualRatio - expectedRatio) > tolerance * expectedRatio) {
		return {
			valid: false,
			error: `Raport aspect necesar ${slot.aspectRatio[0]}:${slot.aspectRatio[1]} (ai ${(actualRatio).toFixed(2)}:1)`
		};
	}
	return { valid: true };
}

/** Check how many required fields/slots are met. */
export function getRequirementsCompletion(
	spec: CampaignTypeSpec,
	textData: Record<string, string[]>,
	imageCounts: Record<string, number>
): { met: number; total: number; missing: string[] } {
	const missing: string[] = [];
	let total = 0;
	let met = 0;

	for (const field of spec.textFields) {
		if (field.required) {
			total++;
			const vals = (textData[field.key] || []).filter((v) => v.trim().length > 0);
			if (vals.length >= field.min) {
				met++;
			} else {
				missing.push(`${field.label} (min ${field.min})`);
			}
		}
	}

	for (const slot of spec.imageSlots) {
		if (slot.required) {
			total++;
			const count = imageCounts[slot.key] || 0;
			if (count >= slot.minCount) {
				met++;
			} else {
				missing.push(`${slot.label} (min ${slot.minCount})`);
			}
		}
	}

	return { met, total, missing };
}

/** Validate all text fields against spec. Returns errors by field key. */
export function validateTextFields(
	spec: CampaignTypeSpec,
	textData: Record<string, string[]>
): Record<string, string> {
	const errors: Record<string, string> = {};

	for (const field of spec.textFields) {
		const vals = (textData[field.key] || []).filter((v) => v.trim().length > 0);

		if (field.required && vals.length < field.min) {
			errors[field.key] = `Minim ${field.min} ${field.label.toLowerCase()}`;
			continue;
		}

		for (const val of vals) {
			if (val.length > field.maxLength) {
				errors[field.key] = `Maxim ${field.maxLength} caractere per ${field.label.toLowerCase()}`;
				break;
			}
		}
	}

	return errors;
}
