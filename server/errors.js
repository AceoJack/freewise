// Thrown for anything the client did wrong; the app turns it into a JSON error.
export class ClientError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export const invalid = (field, message) => new ClientError(400, 'invalid', message, field);
export const notFound = (message = 'Not found.') => new ClientError(404, 'not_found', message);
export const conflict = (code, message) => new ClientError(409, code, message);
