export interface ValidationResult {
	valid: boolean;
	errorCode?: string;
	message?: string;
}

const OK: ValidationResult = { valid: true };

export function validateDateRange(
	start: Date | string | null | undefined,
	end: Date | string | null | undefined,
	options?: { maxDays?: number }
): ValidationResult {
	if (!start || !end) {
		return { valid: false, errorCode: 'VALIDATION_DATE_INVALID', message: 'Both start and end dates are required' };
	}

	const startDate = start instanceof Date ? start : new Date(start);
	const endDate = end instanceof Date ? end : new Date(end);

	if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
		return { valid: false, errorCode: 'VALIDATION_DATE_INVALID', message: 'Invalid date value' };
	}

	if (startDate > endDate) {
		return { valid: false, errorCode: 'VALIDATION_DATE_RANGE_INVALID', message: 'Start date is after end date' };
	}

	const maxDays = options?.maxDays ?? 90;
	const diffMs = endDate.getTime() - startDate.getTime();
	const diffDays = diffMs / (1000 * 60 * 60 * 24);
	if (diffDays > maxDays) {
		return { valid: false, errorCode: 'VALIDATION_DATE_RANGE_TOO_LONG', message: `Date range exceeds ${maxDays} days` };
	}

	// Allow 1 day tolerance for timezone
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(23, 59, 59, 999);
	if (endDate > tomorrow) {
		return { valid: false, errorCode: 'VALIDATION_DATE_FUTURE', message: 'End date is in the future' };
	}

	return OK;
}

export function validateAccountSelection(
	selectedIds: string[],
	options?: { min?: number; max?: number }
): ValidationResult {
	const min = options?.min ?? 1;
	const max = options?.max ?? 50;

	const cleaned = [...new Set(selectedIds.filter((id) => id.trim().length > 0))];

	if (cleaned.length < min) {
		return { valid: false, errorCode: 'VALIDATION_NO_ACCOUNT_SELECTED', message: 'No account selected' };
	}

	if (cleaned.length > max) {
		return { valid: false, errorCode: 'VALIDATION_TOO_MANY_ACCOUNTS', message: `Too many accounts (max ${max})` };
	}

	return OK;
}

export function validateFilterOptions(
	selected: string[],
	available: string[]
): ValidationResult {
	if (selected.length === 0) {
		return { valid: false, errorCode: 'VALIDATION_FILTER_EMPTY', message: 'No filter options selected' };
	}

	const availableLower = available.map((a) => a.toLowerCase());
	for (const s of selected) {
		if (!availableLower.includes(s.trim().toLowerCase())) {
			return { valid: false, errorCode: 'VALIDATION_FILTER_EMPTY', message: `Invalid filter option: ${s}` };
		}
	}

	return OK;
}

export function validateSearchInput(query: string): ValidationResult {
	const trimmed = query.trim();
	if (trimmed.length === 0) return OK; // search is optional

	if (trimmed.length < 2) {
		return { valid: false, errorCode: 'VALIDATION_SEARCH_TOO_SHORT', message: 'Search query too short' };
	}

	if (trimmed.length > 200) {
		return { valid: false, errorCode: 'VALIDATION_SEARCH_TOO_LONG', message: 'Search query too long' };
	}

	return OK;
}

export function validateExportRequest(
	data: unknown[],
	format: string
): ValidationResult {
	if (!data || data.length === 0) {
		return { valid: false, errorCode: 'VALIDATION_NO_DATA_TO_EXPORT', message: 'No data to export' };
	}

	const validFormats = ['csv', 'pdf', 'xlsx'];
	if (!validFormats.includes(format)) {
		return { valid: false, errorCode: 'VALIDATION_INVALID_EXPORT_FORMAT', message: `Invalid format: ${format}` };
	}

	return OK;
}

export function validateRequired(value: unknown, fieldName: string): ValidationResult {
	if (value === null || value === undefined || (typeof value === 'string' && value.trim().length === 0)) {
		return { valid: false, errorCode: 'VALIDATION_REQUIRED_FIELD', message: `${fieldName} is required` };
	}
	return OK;
}

export function validateEmail(email: string): ValidationResult {
	const trimmed = email.trim();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
		return { valid: false, errorCode: 'VALIDATION_INVALID_EMAIL', message: 'Invalid email format' };
	}
	return OK;
}
