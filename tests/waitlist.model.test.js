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
