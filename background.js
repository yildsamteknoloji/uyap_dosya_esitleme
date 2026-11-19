// background.js  (MV3 service worker)
// Sayfadan gelen istekleri yerel yardımcıya (native messaging host) iletir.
const HOST = 'com.yildsam.uyap_esitle';
const DEFAULT_DIR = '~/UYAP';

function native(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, msg, (resp) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message, notInstalled: true });
        else resolve(resp || { ok: false, error: 'boş cevap' });
      });
    } catch (e) { resolve({ ok: false, error: String(e), notInstalled: true }); }
  });
}

function getBaseDir() {
  return new Promise((resolve) => chrome.storage.local.get('baseDir', (r) => resolve((r.baseDir || DEFAULT_DIR).replace(/[\\/]+$/, ''))));
}

function sanitizeSegment(s) {
  return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ /g, '_').slice(0, 150) || 'Dosya';
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const p = msg.payload || {};
  (async () => {
    if (msg.type === 'ping') {
      const r = await native({ cmd: 'ping' });
      r.baseDir = await getBaseDir();
      return r;
    }
    if (msg.type === 'listDir') {
      const base = await getBaseDir();
      return await native({ cmd: 'list', dir: base + '/' + sanitizeSegment(p.klasor) });
    }
    if (msg.type === 'writeFile') {
      const base = await getBaseDir();
      return await native({ cmd: 'write', dir: base + '/' + sanitizeSegment(p.klasor), name: sanitizeSegment(p.name), ext: p.ext || 'bin', data: p.data || '' });
    }
    if (msg.type === 'openDir') {
      const base = await getBaseDir();
      return await native({ cmd: 'open', dir: p.klasor ? base + '/' + sanitizeSegment(p.klasor) : base });
    }
    if (msg.type === 'getBaseDir') return { baseDir: await getBaseDir() };
    return { ok: false, error: 'bilinmeyen mesaj: ' + msg.type };
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
