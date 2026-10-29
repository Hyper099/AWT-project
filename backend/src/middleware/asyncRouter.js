import { Router } from 'express';

/**
 * Express 4 does not catch promise rejections from async handlers, and Node
 * exits on an unhandled rejection — so one thrown error would stop the API
 * for everyone. This Router forwards those errors to the error middleware.
 */
const METHODS = ['all', 'get', 'post', 'put', 'patch', 'delete', 'use'];

function forwardErrors(fn) {
  // Leave non-functions (paths) and error handlers (arity 4) untouched.
  if (typeof fn !== 'function' || fn.length === 4) return fn;
  return function handler(req, res, next) {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

export function asyncRouter() {
  const router = Router();
  for (const method of METHODS) {
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map(forwardErrors));
  }
  return router;
}

/** Reads a required string field; throws a 400 if it is missing or not a string. */
export function requireString(body, field) {
  const value = body?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    const err = new Error(`${field} must be a non-empty string`);
    err.status = 400;
    throw err;
  }
  return value.trim();
}

/** Like requireString, but returns null when the field is absent. */
export function optionalString(body, field) {
  const value = body?.[field];
  if (value === undefined || value === null || value === '') return null;
  return requireString(body, field);
}
