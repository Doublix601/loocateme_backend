import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate, validators } from '../middlewares/validators.js';
import { UserController } from '../controllers/user.controller.js';
import { BleController } from '../controllers/ble.controller.js';
import { heartbeatLimiter, bleLimiter } from '../middlewares/rateLimit.js';

const router = Router();

router.get('/me', requireAuth, UserController.me);
router.post('/location', requireAuth, heartbeatLimiter, validate(validators.updateLocation), UserController.updateLocation);
router.post('/location/force', requireAuth, heartbeatLimiter, validate(validators.forceCheckIn), UserController.forceCheckIn);
router.post('/location/force-checkout', requireAuth, heartbeatLimiter, UserController.forceCheckOut);
router.post('/heartbeat', requireAuth, heartbeatLimiter, validate(validators.updateLocation), UserController.heartbeat);
// Proximité Bluetooth (opt-in, cf. privacyPreferences.bluetoothProximity) :
// jeton éphémère à diffuser en BLE advertising + report des pairs détectés.
router.post('/ble-token', requireAuth, bleLimiter, BleController.issueToken);
router.post('/ble-sightings', requireAuth, bleLimiter, validate(validators.bleSightings), BleController.reportSightings);
router.put('/ble-consent', requireAuth, validate(validators.bluetoothConsent), BleController.updateConsent);
router.post('/ble-checkin', requireAuth, heartbeatLimiter, BleController.checkInViaBle);
router.get('/nearby', requireAuth, validate(validators.nearby), UserController.nearby);
router.get('/popular', requireAuth, validate(validators.popular), UserController.popular);
router.get('/by-email', requireAuth, validate(validators.getUsersByEmail), UserController.getByEmail);
router.get('/search', requireAuth, validate(validators.searchUsers), UserController.search);
router.get('/:id', requireAuth, validate(validators.userById), UserController.getById);

export default router;
