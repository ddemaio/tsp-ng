/**
 * Wise API Integration Module
 *
 * This module handles:
 * 1. Generating Wise batch payment CSVs
 * 2. Creating individual transfers via Wise API
 * 3. Checking transfer status
 * 4. Webhook handling for payment confirmations
 *
 * In production, replace mock functions with real Wise API calls.
 * API docs: https://docs.wise.com/api/
 */

const WiseConfig = {
  apiToken: process.env.WISE_API_TOKEN || 'mock-token',
  baseUrl: 'https://api.wise.com/v1',
  profileId: process.env.WISE_PROFILE_ID || '0', // Your Wise business profile ID
  sourceCurrency: 'EUR',
};

// Mock transfer storage (in real app, this is the Wise API response)
const mockTransfers = new Map();

/**
 * Get available currencies from Wise
 */
async function getCurrencies() {
  // In production: GET /v1/currencies
  return [
    { code: 'EUR', name: 'Euro' },
    { code: 'USD', name: 'US Dollar' },
    { code: 'GBP', name: 'British Pound' },
    { code: 'BRL', name: 'Brazilian Real' },
    { code: 'CZK', name: 'Czech Koruna' },
    { code: 'PLN', name: 'Polish Zloty' },
    { code: 'AUD', name: 'Australian Dollar' },
    { code: 'INR', name: 'Indian Rupee' },
    { code: 'IDR', name: 'Indonesian Rupiah' },
    { code: 'JPY', name: 'Japanese Yen' },
  ];
}

/**
 * Create a batch payment CSV for Wise "Send by email" feature
 * This is the simplest integration - generate CSV, admin uploads to Wise.
 */
function generateBatchCSV(payments) {
  const headers = [
    'name',
    'recipientEmail',
    'paymentReference',
    'receiverType',
    'amountCurrency',
    'amount',
    'sourceCurrency',
    'targetCurrency',
    'type',
  ];

  const rows = payments.map((p) => [
    p.recipient_name,
    p.recipient_email,
    `TSP-${p.request_id}-${Date.now()}`,
    'PERSON',
    p.currency,
    p.amount.toFixed(2),
    WiseConfig.sourceCurrency,
    p.currency,
    'EMAIL',
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  return csv;
}

/**
 * Create a single transfer via Wise API
 * POST /v1/transfers
 */
async function createTransfer({ recipient_name, recipient_email, amount, currency, reference }) {
  // In production, this makes a real API call:
  //
  // const response = await fetch(`${WiseConfig.baseUrl}/transfers`, {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${WiseConfig.apiToken}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     targetAccount: recipient_account_id,
  //     sourceAccount: source_account_id,
  //     sourceCurrency: WiseConfig.sourceCurrency,
  //     targetCurrency: currency,
  //     sourceAmount: amount,
  //     description: reference,
  //   }),
  // });

  const transferId = `WISE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  mockTransfers.set(transferId, {
    id: transferId,
    status: 'processing',
    recipient_name,
    recipient_email,
    amount,
    currency,
    reference,
    created_at: new Date().toISOString(),
  });

  console.log(`[Wise Mock] Created transfer ${transferId}: ${amount} ${currency} to ${recipient_name}`);

  return {
    id: transferId,
    status: 'processing',
    required_action: 'NONE',
  };
}

/**
 * Check transfer status
 * GET /v1/transfers/:id
 */
async function getTransferStatus(transferId) {
  // In production: GET /v1/transfers/:id
  const transfer = mockTransfers.get(transferId);
  if (!transfer) return null;

  // Simulate status progression on each poll
  const statuses = ['processing', 'funds_decorrelated', 'success'];
  const current = transfer._statusIdx ?? 0;
  transfer._statusIdx = Math.min(current + 1, statuses.length - 1);
  transfer.status = statuses[transfer._statusIdx];

  return {
    id: transferId,
    status: transfer.status,
    source_value: transfer.amount,
    source_currency: WiseConfig.sourceCurrency,
    target_value: transfer.amount * 0.95, // Mock exchange rate
    target_currency: transfer.currency,
  };
}

/**
 * Generate Wise API compatible CSV for batch payments
 * This is the "Contactless" batch payment format
 */
function generateBatchPaymentFile(payments) {
  const headers = [
    'Currency',
    'Receiver name',
    'Receiver nickname',
    'Email',
    'Payment reference',
    'Amount',
  ];

  const rows = payments.map((p) => [
    p.currency,
    p.recipient_name,
    p.recipient_name.split(' ')[0].toLowerCase(),
    p.recipient_email,
    `TSP Reimbursement #${p.request_id}`,
    p.amount.toFixed(2),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

module.exports = {
  WiseConfig,
  getCurrencies,
  generateBatchCSV,
  createTransfer,
  getTransferStatus,
  generateBatchPaymentFile,
};
