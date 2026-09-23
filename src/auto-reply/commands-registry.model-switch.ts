import type { CommandArgChoiceContext } from "./commands-registry.types.js";

export function listModelSwitchChoices(
  catalog?: CommandArgChoiceContext["catalog"],
): Array<{ value: string; label: string }> {
  if (!catalog?.length) {
    return [];
  }
  const choices = new Map<string, { value: string; label: string }>();
  for (const entry of catalog) {
    const provider = entry.provider.trim();
    const model = entry.id.trim();
    if (!provider || !model) {
      continue;
    }
    const value = `${provider}/${model}`;
    const displayName = entry.name?.trim();
    const label = displayName && displayName !== model ? `${provider}/${displayName}` : value;
    choices.set(value, { value, label });
  }
  return [...choices.values()].toSorted((left, right) => left.label.localeCompare(right.label));
}
