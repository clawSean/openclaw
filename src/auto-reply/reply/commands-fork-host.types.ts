export type NativeConversationForkHost = {
  version: 1;
  prepare: (params?: { title?: string }) => Promise<
    | {
        status: "ready";
        ticket: string;
        child: boolean;
        current: boolean;
        shared: boolean;
        source: "tip" | "reply";
      }
    | { status: "blocked"; reason: string }
    | { status: "pending" }
  >;
  execute: (params: {
    ticket: string;
    placement: "child" | "current";
  }) => Promise<Readonly<Record<string, unknown>> & { status: string }>;
  back: () => Promise<Readonly<Record<string, unknown>> & { status: string }>;
  status: () => Promise<Readonly<Record<string, unknown>> & { status: string }>;
};
