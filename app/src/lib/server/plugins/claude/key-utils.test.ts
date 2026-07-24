import { describe, expect, test } from 'bun:test';
import { detectKeyType, keyHint, isValidClaudeKey } from './key-utils';

describe('key-utils', () => {
	test('detectKeyType → oat pentru sk-ant-oat', () => {
		expect(detectKeyType('sk-ant-oat01-abcdefg')).toBe('oat');
	});

	test('detectKeyType → api pentru sk-ant-api (și orice non-oat)', () => {
		expect(detectKeyType('sk-ant-api03-abcdefg')).toBe('api');
		expect(detectKeyType('sk-ant-something-else')).toBe('api');
	});

	test('keyHint → ultimele 4 caractere', () => {
		expect(keyHint('sk-ant-api03-xyzTAIL')).toBe('TAIL');
	});

	test('isValidClaudeKey → true doar pentru prefix sk-ant- și lungime minimă', () => {
		expect(isValidClaudeKey('sk-ant-api03-0123456789012')).toBe(true);
		expect(isValidClaudeKey('  sk-ant-api03-0123456789012  ')).toBe(true); // tolerează whitespace
		expect(isValidClaudeKey('sk-proj-openai-123')).toBe(false);
		expect(isValidClaudeKey('sk-ant-')).toBe(false); // prea scurtă
		expect(isValidClaudeKey('')).toBe(false);
	});
});
