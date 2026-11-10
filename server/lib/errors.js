'use strict';
class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const badRequest = (msg, details) => new AppError(400, msg, details);
const notFound = (msg = 'No encontrado') => new AppError(404, msg);
const conflict = (msg, details) => new AppError(409, msg, details);

module.exports = { AppError, badRequest, notFound, conflict };
