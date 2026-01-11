/**
 * Bank connection manager
 * Factory pattern for creating bank clients
 */

import type { BankName, BankClient } from './types';
import { RevolutClient } from '../revolut/client';
import { TransilvaniaClient } from '../transilvania/client';
import { BCRClient } from '../bcr/client';

export class BankManager {
	private static clients: Map<BankName, BankClient> = new Map();

	/**
	 * Get a bank client instance
	 */
	static getClient(bankName: BankName): BankClient {
		if (this.clients.has(bankName)) {
			return this.clients.get(bankName)!;
		}

		let client: BankClient;

		switch (bankName) {
			case 'revolut':
				client = new RevolutClient();
				break;
			case 'transilvania':
				client = new TransilvaniaClient();
				break;
			case 'bcr':
				client = new BCRClient();
				break;
			default:
				throw new Error(`Unsupported bank: ${bankName}`);
		}

		this.clients.set(bankName, client);
		return client;
	}

	/**
	 * Check if a bank is supported
	 */
	static isSupported(bankName: string): bankName is BankName {
		return bankName === 'revolut' || bankName === 'transilvania' || bankName === 'bcr';
	}
}
