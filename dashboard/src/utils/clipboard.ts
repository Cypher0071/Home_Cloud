/**
 * Copies text to the clipboard and reports whether it worked.
 *
 * `navigator.clipboard` only exists in secure contexts (HTTPS or localhost). Over the plain
 * HTTP LAN address (http://192.168.x.x:3000) it is undefined, so this falls back to a hidden
 * textarea and `document.execCommand('copy')`, which browsers still allow from a user gesture.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or document not focused: try the legacy path below.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '0';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  const previousFocus = document.activeElement as HTMLElement | null;
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  field.remove();
  previousFocus?.focus?.();
  return ok;
}
