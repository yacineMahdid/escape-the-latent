// Thin fetch wrappers around the server routes in docs/ARCHITECTURE.md.
async function json(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const post = (url, data) => json(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

const regionCache = new Map();

export const api = {
  status: () => json('/api/status'),
  book: ({ regionId, question, selection, history, learned }) => post('/api/book', { regionId, question, selection, history, learned }),
  avatar: (dataUrl) => post('/api/avatar', { image: dataUrl }),
  grade: ({ regionId, challengeId, answer }) => post('/api/grade', { regionId, challengeId, answer }),
  paperPdfUrl: (arxivId) => `/api/paper/${encodeURIComponent(arxivId)}/pdf`,
  paperText: (arxivId) => json(`/api/paper/${encodeURIComponent(arxivId)}/text`),
  paperMeta: (arxivId) => json(`/api/paper/${encodeURIComponent(arxivId)}/meta`),
  region: async (id) => {
    if (!regionCache.has(id)) regionCache.set(id, json(`/content/regions/${encodeURIComponent(id)}.json`));
    return regionCache.get(id);
  },
};

export default api;
