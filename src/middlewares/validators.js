import { body, query, param, validationResult } from 'express-validator';

export const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map((v) => v.run(req)));
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return res.status(400).json({ message: 'Validation error', details: errors.array() });
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
  getUserByEmail: [
    query('email')
      .isEmail()
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
    body('handle').isString().isLength({ min: 1, max: 100 }),
  ],
  socialRemove: [param('type').isIn(['instagram', 'facebook', 'x', 'snapchat', 'tiktok', 'linkedin'])],
  visibility: [body('isVisible').isBoolean()],
};
