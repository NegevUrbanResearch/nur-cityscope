export async function copyUrl(text, { navigator = globalThis.navigator, document = globalThis.document } = {}) {
  if (typeof text !== "string" || !text) return false;
  try {
    if (navigator?.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the HTTP-compatible legacy copy path.
  }
  if (!document) return false;
  if (typeof document.createElement !== "function" || typeof document.execCommand !== "function") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute?.("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body?.appendChild?.(textarea);
  textarea.select?.();
  let copied = false;
  try {
    copied = document.execCommand("copy") === true;
  } catch {
    copied = false;
  }
  document.body?.removeChild?.(textarea);
  return copied;
}
