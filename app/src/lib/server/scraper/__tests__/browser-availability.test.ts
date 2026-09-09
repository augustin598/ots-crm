import { describe, test, expect } from 'bun:test';
import { isInteractiveBrowserAvailable, BROWSER_SCAN_UNAVAILABLE_MESSAGE } from '../browser-availability';

describe('isInteractiveBrowserAvailable', () => {
	test('macOS always has a display', () => {
		expect(isInteractiveBrowserAvailable({ platform: 'darwin' })).toBe(true);
	});

	test('linux without DISPLAY (k8s pod) cannot show a browser to the user', () => {
		expect(isInteractiveBrowserAvailable({ platform: 'linux' })).toBe(false);
		expect(isInteractiveBrowserAvailable({ platform: 'linux', display: '' })).toBe(false);
	});

	test('linux with DISPLAY set → true', () => {
		expect(isInteractiveBrowserAvailable({ platform: 'linux', display: ':0' })).toBe(true);
	});

	test('message points the user to the Tampermonkey script', () => {
		expect(BROWSER_SCAN_UNAVAILABLE_MESSAGE).toContain('Tampermonkey');
	});
});
