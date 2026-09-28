// Thin wrappers over the local server's JSON API.

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(method, url, body, init = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError("Ory's server is not responding. Check that python3 -m ory is running.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || `Request failed (${response.status}).`, response.status, data);
  return data;
}

const q = (params) => new URLSearchParams(params).toString();

export const api = {
  index: () => request("GET", "/api/index"),
  version: () => request("GET", "/api/version"),
  note: (path) => request("GET", `/api/note?${q({ path })}`),
  save: (path, text, rev, init) => request("PUT", "/api/note", { path, text, rev }, init),
  create: (path, text = "") => request("POST", "/api/notes", { path, text }),
  createFolder: (path) => request("POST", "/api/folders", { path }),
  move: (from, to) => request("POST", "/api/move", { from, to }),
  trash: (path) => request("POST", "/api/trash", { path }),
  daily: (date) => request("POST", "/api/daily", { date }),
  backlinks: (path) => request("GET", `/api/backlinks?${q({ path })}`),
  search: (query) => request("GET", `/api/search?${q({ q: query })}`),
  /** Several notes' text at once: {notes: [{path, text, rev, mtime}]}. */
  readNotes: (paths) => request("POST", "/api/read", { paths }),
  suggestions: () => request("GET", "/api/suggestions"),
  saveSuggestions: (data, rev) => request("PUT", "/api/suggestions", { data, rev }),
  /** Upload a file; `note` places it by the attachments setting, `folder` overrides. */
  upload: async (file, { name, note, folder } = {}) => {
    const params = { name: name ?? file.name ?? "file" };
    if (note) params.note = note;
    if (folder != null) params.folder = folder;
    return request("POST", `/api/files?${q(params)}`, null, {
      body: file,
      headers: { "Content-Type": "application/octet-stream", "X-Ory-Upload": "1" },
    });
  },
};
