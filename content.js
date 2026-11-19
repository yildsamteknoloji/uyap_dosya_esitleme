// content.js  (ISOLATED world)
// Köprü görevi görür: sayfa dünyasındaki page.js <-> background.js
(function () {
  // Sayfadan gelen istekleri background'a ilet, cevabı sayfaya geri gönder
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__uyapEsitle !== true || d.dir !== 'toExt') return;
    try {
      chrome.runtime.sendMessage({ type: d.type, payload: d.payload }, function (resp) {
        if (chrome.runtime.lastError) {
          resp = { error: chrome.runtime.lastError.message };
        }
        window.postMessage({ __uyapEsitle: true, dir: 'toPage', id: d.id, payload: resp }, '*');
      });
    } catch (e) {
      window.postMessage({ __uyapEsitle: true, dir: 'toPage', id: d.id, payload: { error: String(e) } }, '*');
    }
  });

  // Background'dan gelen bildirimleri (indirme bitti / hata) sayfaya ilet
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'dlDone') {
      window.postMessage({ __uyapEsitle: true, dir: 'toPage', type: 'dlDone', payload: msg }, '*');
    }
  });
})();
