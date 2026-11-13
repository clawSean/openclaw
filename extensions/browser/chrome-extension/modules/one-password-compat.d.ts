export function beginIgnoreScope(): () => boolean;
export interface OnePasswordCompatibility {
  enabled(tabId: number): boolean;
  set(tabId: number, value: boolean): unknown;
  run(
    tabId: number,
    sessionId: unknown,
    method: string,
    sendCommand: (method: string, params: Record<string, unknown>) => Promise<unknown>,
    action: () => Promise<unknown>,
  ): Promise<unknown>;
}
export function createOnePasswordCompatibility(isAllowed?: () => boolean): OnePasswordCompatibility;
