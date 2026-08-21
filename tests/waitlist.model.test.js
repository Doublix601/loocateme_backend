import test from 'node:test';
import assert from 'node:assert/strict';
import { WaitlistSignup } from '../src/models/WaitlistSignup.js';

test('WaitlistSignup requires an email', () => {
  const doc = new WaitlistSignup({});
  const err = doc.validateSync();
  assert.ok(err);
  assert.ok(err.errors.email);
});

test('WaitlistSignup accepts and lowercases a valid email', () => {
  const doc = new WaitlistSignup({ email: 'Test@Example.com' });
  const err = doc.validateSync();
  assert.equal(err, undefined);
  assert.equal(doc.email, 'test@example.com');
});

test('WaitlistSignup stores ip/userAgent as an optional consent trail, without requiring them', () => {
  const withoutMetadata = new WaitlistSignup({ email: 'a@example.com' });
  assert.equal(withoutMetadata.validateSync(), undefined);

  const withMetadata = new WaitlistSignup({
    email: 'b@example.com',
    ip: '203.0.113.5',
    userAgent: 'test-agent/1.0',
  });
  assert.equal(withMetadata.validateSync(), undefined);
  assert.equal(withMetadata.ip, '203.0.113.5');
  assert.equal(withMetadata.userAgent, 'test-agent/1.0');
});
