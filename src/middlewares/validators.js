import { body, query, param, validationResult } from 'express-validator';

export const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map((v) => v.run(req)));
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Validation error', details: errors.array() });
  };
};

export const validators = {
  signup: [
    body('email')
      .isEmail()
      .normalizeEmail({
        gmail_remove_dots: false,
        gmail_remove_subaddress: false,
        outlookdotcom_remove_subaddress: false,
        yahoo_remove_subaddress: false,
        icloud_remove_subaddress: false,
      }),
    body('password').isLength({ min: 6 }),
    body('name').optional().isString().isLength({ max: 80 }),
  ],
  login: [body('email').isEmail(), body('password').isString()],
  forgot: [body('email').isEmail()],
  updateLocation: [body('lat').isFloat({ min: -90, max: 90 }), body('lon').isFloat({ min: -180, max: 180 })],
  nearby: [
    query('lat').isFloat({ min: -90, max: 90 }),
    query('lon').isFloat({ min: -180, max: 180 }),
    query('radius').optional().isInt({ min: 1, max: 1000 }),
  ],
  getUsersByEmail: [
    // Accept: ?email=a@x.com or ?email=a@x.com,b@y.com or repeated ?email=a@x.com&email=b@y.com
    query('email')
      .exists()
      .bail()
      .customSanitizer((value) => {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
          return value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
        return [];
      }),
    query('email.*')
      .isEmail()
      .withMessage('All email values must be valid emails')
      .normalizeEmail({
        gmail_remove_dots: false,
        gmail_remove_subaddress: false,
        outlookdotcom_remove_subaddress: false,
        yahoo_remove_subaddress: false,
        icloud_remove_subaddress: false,
      }),
  ],
  profileUpdate: [
    body('name').optional().isString().isLength({ max: 80 }),
    body('bio').optional().isString().isLength({ max: 500 }),
  ],
  socialUpsert: [
    body('type').isIn(['instagram', 'facebook', 'x', 'snapchat', 'tiktok', 'linkedin']),
    body('handle')
      .isString()
      .bail()
      .customSanitizer((value, { req }) => {
        let v = String(value || '').trim();
        // If type is instagram, extract username from full URL if pasted
        const type = String(req.body?.type || '').toLowerCase();
        if (type === 'instagram') {
          try {
            if (/^https?:\/\//i.test(v)) {
              const u = new URL(v);
              const path = (u.pathname || '').replace(/^\/+|\/+$/g, '');
              v = (path.split('/')[0] || '').trim();
            }
          } catch (_e) { /* ignore */ }
          if (v.startsWith('@')) v = v.slice(1);
        }
        return v;
      })
      .isLength({ min: 1, max: 100 })
      .bail()
      .custom((value, { req }) => {
        const type = String(req.body?.type || '').toLowerCase();
        if (type === 'instagram') {
          const re = /^(?!.*\.\.)(?!.*\.$)[A-Za-z0-9](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9])?$/;
          if (!re.test(value)) {
            throw new Error('Invalid Instagram username');
          }
        }
        return true;
      }),
  ],
  socialRemove: [param('type').isIn(['instagram', 'facebook', 'x', 'snapchat', 'tiktok', 'linkedin'])],
  visibility: [body('isVisible').isBoolean()],
};
