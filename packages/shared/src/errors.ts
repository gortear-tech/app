import { Static, Type } from "@sinclair/typebox";

export const ErrorAction = Type.Union([
  Type.Literal("retry"),
  Type.Literal("reconnect"),
  Type.Literal("contact_support"),
  Type.Literal("refresh"),
  Type.Literal("none")
]);

export const AppErrorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  userMessage: Type.String(),
  retryable: Type.Boolean(),
  action: ErrorAction,
  requestId: Type.String(),
  details: Type.Optional(Type.Unknown())
});

export type AppErrorResponse = Static<typeof AppErrorResponseSchema>;

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly userMessage: string;
  public readonly retryable: boolean;
  public readonly action: Static<typeof ErrorAction>;
  public readonly details?: unknown;

  constructor(input: {
    code: string;
    statusCode: number;
    message: string;
    userMessage: string;
    retryable?: boolean;
    action?: Static<typeof ErrorAction>;
    details?: unknown;
  }) {
    super(input.message);
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.userMessage = input.userMessage;
    this.retryable = input.retryable ?? false;
    this.action = input.action ?? "none";
    this.details = input.details;
  }
}

export const unauthorizedError = () =>
  new AppError({
    code: "unauthorized",
    statusCode: 401,
    message: "Missing or invalid session",
    userMessage: "Inicia sesion para continuar.",
    retryable: false,
    action: "none"
  });

export const forbiddenError = () =>
  new AppError({
    code: "forbidden",
    statusCode: 403,
    message: "Actor cannot access this workspace",
    userMessage: "No tienes permiso para hacer esto.",
    retryable: false,
    action: "none"
  });
