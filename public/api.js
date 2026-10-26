export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

// JSON fetch against /api. A 401 means the session ended, so tell the app to
// show the login screen.
export async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401) window.dispatchEvent(new Event('freewise:signed-out'));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
