// Eklenti simgesine basınca açılan küçük pencere (ayarlar)
const DEFAULT_DIR = '~/UYAP';
const inp = document.getElementById('baseDir'), msg = document.getElementById('msg'), durum = document.getElementById('durum');
const say = (cls, text) => { msg.className = cls; msg.textContent = text; };

document.getElementById('surum').textContent = 'sürüm ' + chrome.runtime.getManifest().version;
chrome.storage.local.get('baseDir', (r) => { inp.value = r.baseDir || DEFAULT_DIR; });

// Açılır açılmaz yerel yardımcıyı dene
chrome.runtime.sendMessage({ type: 'ping' }, (r) => {
  if (chrome.runtime.lastError || !r || !r.ok) {
    durum.className = 'err';
    durum.textContent = 'Yerel yardımcıya ulaşılamadı. Aşağıdaki kurulumu yapıp tarayıcıyı tamamen kapatıp açın.';
    document.getElementById('kurulum').open = true;
    return;
  }
  durum.className = 'ok';
  durum.textContent = 'Yerel yardımcı çalışıyor (sürüm ' + r.version + ').';
});

document.getElementById('save').onclick = () => {
  const v = inp.value.trim() || DEFAULT_DIR;
  inp.value = v;
  chrome.storage.local.set({ baseDir: v }, () => say('ok', 'Kaydedildi: ' + v));
};
document.getElementById('open').onclick = () => {
  // Kutudaki klasörü kaydetmeden açma: önce kaydet, sonra aç
  const v = inp.value.trim() || DEFAULT_DIR;
  chrome.storage.local.set({ baseDir: v }, () => {
    chrome.runtime.sendMessage({ type: 'openDir', payload: {} }, (r) => {
      if (r && r.ok) say('ok', 'Açıldı: ' + r.dir);
      else say('err', 'Klasör açılamadı: ' + (r && r.error || '?'));
    });
  });
};
