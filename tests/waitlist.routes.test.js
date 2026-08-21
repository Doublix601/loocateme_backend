import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SMTP_PASS = process.env.SMTP_PASS || 'test-pass';

// Same ES-module-hoisting reason documented at the top of
// tests/waitlist.controller.test.js: email.service.js reads SMTP_PASS into a
// module-scope constant at import time, so process.env.SMTP_PASS must be set
// before that module (transitively pulled in by waitlist.routes.js ->
// waitlist.controller.js -> email.service.js) is first evaluated. Static
// `import` declarations are hoisted above this file's own top-level
// statements regardless of source order, so we use dynamic `import()` here,
// which runs exactly where it's written.
const { default: express } = await import('express');
const { WaitlistSignup } = await import('../src/models/WaitlistSignup.js');
const { mailer } = await import('../src/services/email.service.js');
const { default: waitlistRoutes } = await import('../src/routes/waitlist.routes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/waitlist', waitlistRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
  });
  return app;
}

function stubWaitlistModel({ existing = null, count = 1 } = {}) {
  const originalFindOne = WaitlistSignup.findOne;
  const originalCreate = WaitlistSignup.create;
  const originalCount = WaitlistSignup.countDocuments;
  const calls = { findOne: [], create: [], countDocuments: 0 };
  WaitlistSignup.findOne = (filter) => { calls.findOne.push(filter); return Promise.resolve(existing); };
  WaitlistSignup.create = (doc) => { calls.create.push(doc); return Promise.resolve({ ...doc, _id: 'fake-id' }); };
  WaitlistSignup.countDocuments = () => { calls.countDocuments += 1; return Promise.resolve(count); };
  return {
    calls,
    restore: () => {
      WaitlistSignup.findOne = originalFindOne;
      WaitlistSignup.create = originalCreate;
      WaitlistSignup.countDocuments = originalCount;
    },
  };
}

function stubMailer() {
  const original = mailer.sendMail;
  const calls = [];
  mailer.sendMail = (msg) => { calls.push(msg); return Promise.resolve({ accepted: [msg.to] }); };
  return { calls, restore: () => { mailer.sendMail = original; } };
}

// subscribe() sends the welcome email fire-and-forget (doesn't block the HTTP
// response on it) — let the microtask queue drain before asserting on the
// mailer stub, same pattern as waitlist.controller.test.js.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// One shared server across all tests in this file: keeps every request on
// the same in-process client (consistent req.ip) and keeps the total request
// count well under the rate limiters' thresholds (10/hour POST, 30/min GET),
// since we never come close to either across the 5 tests below.
let server;
let baseUrl;

test.before(async () => {
  const app = makeApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('POST /api/waitlist with a valid new email returns 201', async () => {
  const model = stubWaitlistModel({ existing: null, count: 3 });
  const mail = stubMailer();
  try {
    const res = await fetch(`${baseUrl}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com' }),
    });
    const body = await res.json();
    await flush();

    assert.equal(res.status, 201);
    assert.deepEqual(body, { ok: true, alreadySubscribed: false, count: 3 });
    assert.equal(model.calls.create.length, 1);
    // Consent-trail metadata (IP/user-agent) is captured on real requests
    // through the actual Express req object, not the hand-rolled mocks used
    // in waitlist.controller.test.js.
    assert.ok(model.calls.create[0].ip, 'expected req.ip to be forwarded to create()');
    assert.equal(typeof model.calls.create[0].userAgent, 'string');
  } finally {
    model.restore();
    mail.restore();
  }
});

test('POST /api/waitlist with a duplicate email returns 200 alreadySubscribed', async () => {
  const model = stubWaitlistModel({ existing: { email: 'existing@example.com' } });
  const mail = stubMailer();
  try {
    const res = await fetch(`${baseUrl}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'existing@example.com' }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true, alreadySubscribed: true });
    assert.equal(model.calls.create.length, 0);
    assert.equal(mail.calls.length, 0);
  } finally {
    model.restore();
    mail.restore();
  }
});

test('POST /api/waitlist with an invalid email returns 400 VALIDATION_ERROR', async () => {
  const model = stubWaitlistModel();
  try {
    const res = await fetch(`${baseUrl}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.equal(model.calls.create.length, 0);
  } finally {
    model.restore();
  }
});

test('POST /api/waitlist with an array email returns 400, not a 500 (regression for array-bypass)', async () => {
  const model = stubWaitlistModel();
  try {
    const res = await fetch(`${baseUrl}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ['a@b.com', 'c@d.com'] }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.equal(model.calls.create.length, 0);
  } finally {
    model.restore();
  }
});

test('GET /api/waitlist/count returns 200 with the count', async () => {
  const model = stubWaitlistModel({ count: 42 });
  try {
    const res = await fetch(`${baseUrl}/api/waitlist/count`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { count: 42 });
  } finally {
    model.restore();
  }
});
