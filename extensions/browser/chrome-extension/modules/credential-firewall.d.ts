export type AuthorizedCdpCommand = {
  method: string;
  params: Record<string, unknown>;
};

export function authorizeCdpCommand(
  method: string,
  params?: Record<string, unknown>,
): AuthorizedCdpCommand;

export function sanitizeCdpResult(method: string, result: unknown): unknown;

export function sanitizeCdpEvent(method: string, params: unknown): unknown;
