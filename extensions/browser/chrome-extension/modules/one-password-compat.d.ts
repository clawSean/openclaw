export function beginIgnoreScope(): (operation: string) => boolean;
type Send = (method: string, params: Record<string, unknown>) => Promise<unknown>;
export interface OnePasswordCompatibility {
  enabled(tabId: number): boolean;
  set(tabId: number, value: boolean): Promise<unknown>;
  disarm(tabId: number): void;
  disarmAll(): void;
  stopAll(): Promise<unknown>;
  stop(tabId: number, cleanupCommand?: Send): Promise<void>;
  run(
    tabId: number,
    sessionId: unknown,
    method: string,
    sendCommand: Send,
    action: () => Promise<unknown>,
    checkAccess?: () => Promise<unknown>,
  ): Promise<unknown>;
}
export function createOnePasswordCompatibility(isAllowed?: () => boolean): OnePasswordCompatibility;
