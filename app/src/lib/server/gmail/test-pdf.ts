import { readFileSync } from 'fs';
import { extractInvoiceDataFromPdf } from './pdf-parser';
import path from 'path';

async function test() {
    const pdfPath = '/Users/augustin598/Projects/CRM/app/uploads/supplier-invoices/k2yzj5bxxppatc57vxpoxfvn/2026-03/hetzner_088000799003_2026-03-13.pdf';
    console.log(`Testing PDF parsing for: ${pdfPath}`);

    try {
        const buffer = readFileSync(pdfPath);
        const data = await extractInvoiceDataFromPdf(buffer);
        
        console.log('\n--- Extracted Data ---');
        console.log(JSON.stringify(data, (key, value) => {
            if (value instanceof Date) return value.toISOString();
            return value;
        }, 2));
        console.log('----------------------\n');
    } catch (error) {
        console.error('Error during PDF parsing:', error);
    }
}

test();
