/** Browser reload is reserved to avoid discarding the in-memory annotation session. */
export function isReloadShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  return (
    event.key === "F5" || (!!(event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")
  );
}
export function isReservedReloadBinding(binding: string): boolean {
  const parts = binding.toLowerCase().split("+");
  return parts.includes("f5") || (parts.includes("ctrl") && parts[parts.length - 1] === "r");
}
