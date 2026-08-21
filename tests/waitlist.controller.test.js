import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SMTP_PASS = process.env.SMTP_PASS || 'test-pass';

// email.service.js reads SMTP_PASS into a module-scope constant at import
// time (unlike auth.js, which reads JWT_ACCESS_SECRET lazily per-request).
// Static `import` declarations are hoisted and evaluated before any of this
// file's own top-level statements, regardless of source order — so setting
// process.env.SMTP_PASS above a static `import ... from 'email.service.js'`
// would NOT run first and the module would capture an empty password.
// Dynamic `import()` is not hoisted, so it runs exactly here, after the env
// var is set.
const { WaitlistSignup } = await import('../src/models/WaitlistSignup.js');
const { mailer } = await import('../src/services/email.service.js');
const { WaitlistController } = await import('../src/controllers/waitlist.controller.js');

function makeReqRes(body) {
  const req = { body };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

// subscribe() envoie l'email de bienvenue en fire-and-forget (ne bloque pas
// la réponse HTTP dessus) — laisser la microtask queue se vider avant
// d'observer les effets de bord, même pattern que auth.middleware.test.js.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
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

test('subscribe creates a new signup, sends a welcome email, and returns the count', async () => {
  const model = stubWaitlistModel({ existing: null, count: 3 });
  const mail = stubMailer();
  try {
    const { req, res } = makeReqRes({ email: 'new@example.com' });
    await WaitlistController.subscribe(req, res, (err) => { throw err; });
    await flush();

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { ok: true, alreadySubscribed: false, count: 3 });
    assert.equal(model.calls.create.length, 1);
    assert.equal(model.calls.create[0].email, 'new@example.com');
    assert.equal(mail.calls.length, 1);
    assert.equal(mail.calls[0].to, 'new@example.com');
  } finally {
    model.restore();
    mail.restore();
  }
});

test('subscribe returns alreadySubscribed without creating a duplicate or sending an email', async () => {
  const model = stubWaitlistModel({ existing: { email: 'existing@example.com' } });
  const mail = stubMailer();
  try {
    const { req, res } = makeReqRes({ email: 'existing@example.com' });
    await WaitlistController.subscribe(req, res, (err) => { throw err; });
    await flush();

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, alreadySubscribed: true });
    assert.equal(model.calls.create.length, 0);
    assert.equal(mail.calls.length, 0);
  } finally {
    model.restore();
    mail.restore();
  }
});

test('subscribe treats a duplicate-key error from create() (TOCTOU race) as an existing subscription', async () => {
  // Simulates two near-simultaneous subscribe() calls for the same email:
  // findOne() finds nothing yet (neither insert has committed), but the
  // create() that loses the race hits the unique index and rejects with a
  // MongoDB duplicate-key error (code 11000).
  const model = stubWaitlistModel({ existing: null, count: 5 });
  const mail = stubMailer();
  WaitlistSignup.create = () => {
    const err = new Error('E11000 duplicate key error collection: waitlistsignups index: email_1');
    err.code = 11000;
    return Promise.reject(err);
  };
  try {
    const { req, res } = makeReqRes({ email: 'race@example.com' });
    await WaitlistController.subscribe(req, res, (err) => { throw err; });
    await flush();

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, alreadySubscribed: true });
    assert.equal(mail.calls.length, 0);
  } finally {
    model.restore();
    mail.restore();
  }
});

test('getCount returns the total number of signups', async () => {
  const model = stubWaitlistModel({ count: 42 });
  try {
    const { req, res } = makeReqRes({});
    await WaitlistController.getCount(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { count: 42 });
  } finally {
    model.restore();
  }
});
