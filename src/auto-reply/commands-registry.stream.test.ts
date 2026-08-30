import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import { createChannelTestPluginBase, createTestRegistry } from "../test-utils/channel-plugins.js";
import {
  findCommandByNativeName,
  listChatCommands,
  listNativeCommandSpecsForConfig,
} from "./commands-registry.js";

beforeEach(() => {
  vi.doUnmock("../channels/plugins/index.js");
  resetPluginRuntimeStateForTest();
  setActivePluginRegistry(createTestRegistry([]));
});

afterEach(() => {
  resetPluginRuntimeStateForTest();
  setActivePluginRegistry(createTestRegistry([]));
});

function requireStreamCommand() {
  const command = listChatCommands().find((candidate) => candidate.key === "stream");
  if (!command) {
    throw new Error("missing stream command");
  }
  return command;
}

describe("stream command registry", () => {
  it("registers stream mode as a first-class options command", () => {
    const stream = requireStreamCommand();
    expect(stream.nativeName).toBe("stream");
    expect(stream.nativeAliases).toEqual(["streaming"]);
    expect(stream.nativeChannelCapability).toBe("sessionStreaming");
    expect(stream.textAliases).toEqual(["/stream", "/streaming"]);
    expect(stream.category).toBe("options");
    expect(stream.args?.[0]?.choices).toEqual([
      "status",
      "off",
      "partial",
      "block",
      "progress",
      "default",
    ]);
  });

  it("publishes stream natively only for channels with session streaming support", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "discord",
          plugin: {
            ...createChannelTestPluginBase({
              id: "discord",
              capabilities: { nativeCommands: true, chatTypes: ["direct"] },
            }),
            streaming: {
              sessionModeDefault: "off",
              resolveSessionMode: () => ({ mode: "off", source: "channel default" }),
            },
          },
          source: "test",
        },
        {
          pluginId: "clickclack",
          plugin: createChannelTestPluginBase({
            id: "clickclack",
            capabilities: { nativeCommands: true, chatTypes: ["direct"] },
          }),
          source: "test",
        },
      ]),
    );

    const discordNames = new Set(
      listNativeCommandSpecsForConfig({ commands: { native: true } }, { provider: "discord" }).map(
        (command) => command.name,
      ),
    );
    const clickclackNames = new Set(
      listNativeCommandSpecsForConfig(
        { commands: { native: true } },
        { provider: "clickclack" },
      ).map((command) => command.name),
    );
    expect(discordNames.has("stream")).toBe(true);
    expect(clickclackNames.has("stream")).toBe(false);
    expect(findCommandByNativeName("stream", "discord")?.key).toBe("stream");
    expect(findCommandByNativeName("streaming", "discord")?.key).toBe("stream");
    expect(findCommandByNativeName("stream", "clickclack")).toBeUndefined();
    expect(findCommandByNativeName("streaming", "clickclack")).toBeUndefined();
  });
});
