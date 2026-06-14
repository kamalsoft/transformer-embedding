export class AppError extends Error {
  constructor(public message: string, public statusCode: number = 500, public isOperational: boolean = true) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class StorageError extends AppError {
  constructor(message: string) {
    super(message, 500);
  }
}

export class EmbeddingError extends AppError {
  constructor(message: string, public isRetryable: boolean = true) {
    super(message, 503);
  }
}