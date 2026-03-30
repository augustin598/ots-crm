import { detectStatus } from './parsers/index';

function test() {
    const cases = [
        { text: "Your payment is received", expected: "paid" },
        { text: "Invoice #123 is paid", expected: "paid" },
        { text: "Plata confirmata pentru factura ta", expected: "paid" },
        { text: "Your payment is due soon", expected: "unpaid" },
        { text: "Invoice is unpaid and overdue", expected: "unpaid" },
        { text: "Status factura: În așteptare", expected: "unpaid" },
        { text: "Factura neplatita", expected: "unpaid" },
        { text: "Billing Period Autopay", expected: "paid" },
        { text: "Suma de plata", expected: "pending" }
    ];

    console.log("--- Testing Status Detection ---");
    let passed = 0;
    for (const c of cases) {
        const result = detectStatus(c.text);
        const ok = result === c.expected;
        if (ok) passed++;
        console.log(`${ok ? '✅' : '❌'} [${c.text}] -> ${result} (expected ${c.expected})`);
    }
    console.log(`\nResult: ${passed}/${cases.length} passed`);
}

test();
