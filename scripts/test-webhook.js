import http from 'http';

const TEST_USER_ID = '693b4037443a8638d49db46d'; // À adapter si nécessaire
const SECRET = 'change-me-secret';

const simulateWebhook = async (type) => {
  const payload = JSON.stringify({
    event: {
      type,
      app_user_id: TEST_USER_ID,
      expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }
  });

  const options = {
    hostname: 'localhost',
    port: 4000,
    path: '/api/payment/revenuecat-webhook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SECRET}`,
      'Content-Length': payload.length
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`[Test] Webhook ${type} sent. Status: ${res.statusCode}. Response: ${data}`);
    });
  });

  req.on('error', (e) => {
    console.error(`[Test] Failed to send webhook ${type}:`, e.message);
  });

  req.write(payload);
  req.end();
};

simulateWebhook('INITIAL_PURCHASE');
