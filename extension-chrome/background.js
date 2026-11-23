// Relays messages from the page to the local bridge. Done here (not in the
// content script) so the page's own security rules can't block the request.
const BRIDGE = 'http://127.0.0.1:8765';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'answers' && msg?.type !== 'learn') return;
  const { type, ...body } = msg;
  fetch(`${BRIDGE}/${type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      sendResponse(r.ok ? data : { error: data.error || `Bridge error ${r.status}` });
    })
    .catch(() => sendResponse({ error: 'Bridge not running. Start it: node server/server.js' }));
  return true; // async response
});
