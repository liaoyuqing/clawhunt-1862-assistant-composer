/**
 * Base URL for the assistant API.
 *
 * Empty by default: the app then calls same-origin /api/*, which the Vite dev
 * server proxies to the mock service. Set VITE_API_BASE to talk to the mock
 * service directly, which is what you want when demoing a mid-stream drop: the
 * dev proxy keeps the upstream socket open after an abort, so a drop only shows
 * up in the browser when the request goes straight to the service.
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
