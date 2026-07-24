/**
 * Re-export din SmartBill (source-of-truth AES-256-GCM per-tenant), ca la Stripe.
 * Dacă SmartBill schimbă algoritmul, Claude rămâne aliniat automat.
 */
export { encrypt, decrypt, encryptVerified, DecryptionError } from '../smartbill/crypto';
