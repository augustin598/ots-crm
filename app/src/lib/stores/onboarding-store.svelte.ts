import { browser } from '$app/environment';

const STORAGE_KEY = 'client-onboarding-tour';

interface StoredState {
	active: boolean;
	step: number;
}

function loadFromStorage(): StoredState | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function saveToStorage(state: StoredState) {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clearStorage() {
	if (!browser) return;
	localStorage.removeItem(STORAGE_KEY);
}

// Svelte 5 reactive state object (not class — avoids proxy issues)
export const tourState = $state({
	active: false,
	step: 0,
	completed: false,
	enabled: true,
	initialized: false
});

export const tourActions = {
	init(prefs: { onboardingTourCompleted: boolean; onboardingTourEnabled: boolean }) {
		if (tourState.initialized) return;
		tourState.completed = prefs.onboardingTourCompleted;
		tourState.enabled = prefs.onboardingTourEnabled;
		tourState.initialized = true;

		const stored = loadFromStorage();
		if (stored?.active && !tourState.completed && tourState.enabled) {
			tourState.active = true;
			tourState.step = stored.step;
		}
	},

	start() {
		tourState.active = true;
		tourState.step = 0;
		tourState.completed = false;
		saveToStorage({ active: true, step: 0 });
	},

	next(totalSteps: number) {
		if (tourState.step >= totalSteps - 1) {
			tourActions.complete();
			return;
		}
		tourState.step++;
		saveToStorage({ active: true, step: tourState.step });
	},

	prev() {
		if (tourState.step > 0) {
			tourState.step--;
			saveToStorage({ active: true, step: tourState.step });
		}
	},

	skip() {
		tourState.active = false;
		tourState.completed = true;
		clearStorage();
	},

	complete() {
		tourState.active = false;
		tourState.completed = true;
		clearStorage();
	},

	reset() {
		tourState.completed = false;
		tourState.enabled = true;
		clearStorage();
		tourActions.start();
	}
};
