export class AppError extends Error {
  code: string;
  statusCode: number;
  userMessage: string;
  details?: unknown;

  constructor(params: {
    code: string;
    statusCode: number;
    message: string;
    userMessage: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.userMessage = params.userMessage;
    this.details = params.details;
  }
}
