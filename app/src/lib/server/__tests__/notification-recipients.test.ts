/**
 * Cine primește emailurile unui client. Regula de facturi e separată de accesul
 * în portal: bifa „Facturi" arată pagina, „Primește facturile pe email" trimite
 * emailul. Incidentul de la care a pornit: un coleg cu acces la pagina Facturi
 * primea și fiecare factură emisă (OTS 561).
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('$lib/server/db', () => ({ db: {} }));

const { secondaryReceivesNotification } = await import('$lib/server/portal-access');

const flags = (over: Record<string, boolean>) => JSON.stringify({ invoices: false, tasks: false, contracts: false, ...over });

describe('secondaryReceivesNotification', () => {
	test('facturi: accesul în portal la Facturi NU aduce și emailul', () => {
		expect(
			secondaryReceivesNotification('invoices', {
				accessFlags: flags({ invoices: true }),
				notifyInvoices: true,
				receivesInvoiceEmails: false
			})
		).toBe(false);
	});

	test('facturi: contactul de contabilitate primește emailul fără acces în portal', () => {
		expect(
			secondaryReceivesNotification('invoices', {
				accessFlags: null,
				notifyInvoices: false,
				receivesInvoiceEmails: true
			})
		).toBe(true);
	});

	test('facturi: bifa veche notify_invoices singură nu mai contează', () => {
		expect(
			secondaryReceivesNotification('invoices', {
				accessFlags: null,
				notifyInvoices: true,
				receivesInvoiceEmails: false
			})
		).toBe(false);
	});

	test('taskuri și contracte rămân pe bifa de acces', () => {
		const se = { accessFlags: flags({ tasks: true }), receivesInvoiceEmails: true };
		expect(secondaryReceivesNotification('tasks', se)).toBe(true);
		expect(secondaryReceivesNotification('contracts', se)).toBe(false);
	});

	test('taskuri: rândurile vechi fără access_flags cad pe notify_tasks', () => {
		expect(
			secondaryReceivesNotification('tasks', {
				accessFlags: null,
				notifyTasks: true,
				receivesInvoiceEmails: false
			})
		).toBe(true);
	});
});
