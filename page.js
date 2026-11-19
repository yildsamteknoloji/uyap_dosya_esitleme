// page.js  (MAIN world: sayfanın oturumuyla evrak çeker, yerel yardımcıya yazdırır)
(function () {
  if (window.__uyapEsitleLoaded) return;
  window.__uyapEsitleLoaded = true;

  var TREE_URL = '/main/jsp/vatandas/dosya_evrak_bilgileri_brd.ajx';
  var DL_URL = '/main/jsp/vatandas/download_document_brd.uyap';
  var DELAY_MS = 800;           // iki evrak arası bekleme (UYAP'ı yormamak için)
  var log = function () { try { console.log.apply(console, ['[UYAP Eşitle]'].concat([].slice.call(arguments))); } catch (e) {} };

  // ---------- content.js köprüsü ----------
  var seq = 0, pending = {};
  function ask(type, payload, timeoutMs) {
    return new Promise(function (res) {
      var id = ++seq;
      pending[id] = res;
      window.postMessage({ __uyapEsitle: true, dir: 'toExt', id: id, type: type, payload: payload || {} }, '*');
      setTimeout(function () { if (pending[id]) { pending[id]({ ok: false, error: 'eklenti cevap vermedi' }); delete pending[id]; } }, timeoutMs || 30000);
    });
  }
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__uyapEsitle !== true || d.dir !== 'toPage') return;
    if (d.id && pending[d.id]) { pending[d.id](d.payload); delete pending[d.id]; }
  });
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------- yardımcılar ----------
  function sanitize(s) {
    return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ /g, '_').slice(0, 120);
  }
  function trDate(s) { // dd/mm/yyyy -> yyyy-mm-dd
    var m = String(s || '').match(/(\d{2})[./](\d{2})[./](\d{4})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '0000-00-00';
  }
  function isEnc(s) { return typeof s === 'string' && /^"?[A-Za-z0-9+\/@=]{40,200}"?$/.test(s.trim()); }
  function findEnc(obj, depth) {
    depth = depth || 0;
    if (obj == null || depth > 4) return null;
    if (typeof obj === 'string') {
      if (isEnc(obj)) return obj.trim();
      var m = obj.match(/["'=\s>]([A-Za-z0-9+\/@=]{44,200})["'&<\s]/);
      return m ? m[1] : null;
    }
    if (typeof obj === 'object') {
      var k, r;
      for (k in obj) if (/dosya.?id/i.test(k) && typeof obj[k] === 'string' && obj[k].length > 20) return obj[k].trim();
      for (k in obj) { r = findEnc(obj[k], depth + 1); if (r) return r; }
    }
    return null;
  }
  function rowInfo(tr) {
    var cells = [].map.call(tr.children, function (td) { return (td.textContent || '').replace(/\s+/g, ' ').trim(); });
    var esas = null, daire = null, i;
    for (i = 0; i < cells.length; i++) if (/^\d{4}\/\d+$/.test(cells[i])) { esas = cells[i]; break; }
    if (!esas) return null;
    for (i = 0; i < cells.length; i++) if (/(Dairesi|Mahkemesi|Savcılığı|Başsavcılığı|Müdürlüğü|Komisyonu|Hakimliği|Hâkimliği)/i.test(cells[i])) { daire = cells[i]; break; }
    if (!daire) daire = cells[1] || 'Dosya';
    var dosyaId = null, $ = window.jQuery;
    try {
      var table = tr.closest('table');
      if ($ && $.fn && $.fn.dataTable && table && $.fn.dataTable.isDataTable(table)) {
        dosyaId = findEnc($(table).DataTable().row(tr).data());
      }
    } catch (e) { log('DataTable okunamadı', e); }
    if (!dosyaId) { try { dosyaId = findEnc($ ? $(tr).data() : null); } catch (e) {} }
    if (!dosyaId) { try { dosyaId = findEnc(tr.outerHTML); } catch (e) {} }
    return { esas: esas, daire: daire, dosyaId: dosyaId };
  }
  function klasorAdi(daire, esas) { return sanitize(daire) + '_' + sanitize(esas).replace(/\//g, '-'); }

  // ---------- panel ----------
  var panel, stopFlag = false, hideTimer = null, tick = null, tStart = 0, prog = { n: 0, total: 0 };
  var STATE_LABEL = { run: 'Eşitleniyor', ok: 'Tamamlandı', warn: 'Dikkat', err: 'Hata' };
  function q(sel) { return panel.querySelector(sel); }
  function fmt(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'uyap-esitle-panel';
    panel.innerHTML =
      '<div class="ue-head"><span class="ue-dot"></span><span class="ue-state"></span><span class="ue-x" title="Kapat">×</span></div>' +
      '<div class="ue-body">' +
        '<div class="ue-title"></div><div class="ue-stage"></div>' +
        '<div class="ue-prog"><div class="ue-bar"><div></div></div><div class="ue-meta"><span class="ue-count"></span><span class="ue-time"></span></div><div class="ue-file"></div></div>' +
        '<div class="ue-chips"><span class="ue-chip new">Yeni <b>0</b></span><span class="ue-chip have">Zaten vardı <b>0</b></span><span class="ue-chip bad">Hata <b>0</b></span></div>' +
        '<div class="ue-msg"></div><div class="ue-dir"></div>' +
        '<div class="ue-actions"><button type="button" class="ue-open">Klasörü aç</button><button type="button" class="ue-stop">Durdur</button><button type="button" class="ue-close">Kapat</button></div>' +
      '</div>';
    document.body.appendChild(panel);
    q('.ue-stop').onclick = function () { stopFlag = true; q('.ue-stop').disabled = true; setStage('Durduruluyor: sürmekte olan evrak bitince duracak'); };
    q('.ue-x').onclick = q('.ue-close').onclick = function () { panel.style.display = 'none'; };
    q('.ue-open').onclick = q('.ue-dir').onclick = openFolder;
    q('.ue-dir').title = 'Klasörü dosya yöneticisinde aç';
    // Fare panelin üstündeyken kendiliğinden kapanmasın
    panel.addEventListener('mouseenter', function () { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
  }
  var curKlasor = null;
  async function openFolder() {
    if (!curKlasor) return;
    var r = await ask('openDir', { klasor: curKlasor }, 10000);
    if (r && r.ok) return;
    var err = String(r && r.error || '?');
    var note = /bilinmeyen komut/.test(err) ? 'Klasör açılamadı: yerel yardımcı eski sürüm. Eklenti klasöründeki native dosyalarını güncelleyin.'
      : /context invalidated/i.test(err) ? 'Klasör açılamadı: eklenti yenilenmiş, sayfayı yenileyin (F5).'
      : 'Klasör açılamadı: ' + err;
    q('.ue-dir').textContent = note; q('.ue-dir').style.display = 'block';
  }
  function setState(kind) { panel.setAttribute('data-state', kind); q('.ue-state').textContent = STATE_LABEL[kind] || ''; }
  function setStage(s) { if (panel) q('.ue-stage').textContent = s || ''; }
  function setFile(s) { if (panel) q('.ue-file').textContent = s || ''; }
  function setMsg(s) { if (panel) { q('.ue-msg').textContent = s || ''; q('.ue-msg').style.display = s ? 'block' : 'none'; } }
  function setDir(s) { if (panel) { q('.ue-dir').textContent = s ? 'Klasör: ' + s : ''; q('.ue-dir').style.display = s ? 'block' : 'none'; q('.ue-open').style.display = (s && curKlasor) ? 'inline-block' : 'none'; } }
  function setCounts(ok, skipped, fail) {
    if (!panel) return;
    q('.ue-chip.new b').textContent = ok; q('.ue-chip.have b').textContent = skipped; q('.ue-chip.bad b').textContent = fail;
    q('.ue-chip.bad').classList.toggle('zero', !fail);
  }
  function drawTime() {
    if (!panel || !tStart) return;
    var el = (Date.now() - tStart) / 1000, t = 'Geçen ' + fmt(el);
    if (prog.n >= 2 && prog.n < prog.total) t += '  ·  Kalan yaklaşık ' + fmt(el / prog.n * (prog.total - prog.n));
    q('.ue-time').textContent = t;
  }
  function startClock() { tStart = Date.now(); if (tick) clearInterval(tick); tick = setInterval(drawTime, 1000); drawTime(); }
  function setProgress(n, total) {
    if (!panel) return;
    prog = { n: n, total: total };
    var pct = total ? Math.round(100 * n / total) : 0;
    q('.ue-bar > div').style.width = pct + '%';
    q('.ue-count').textContent = total > 1 ? (n + ' / ' + total + ' evrak  ·  %' + pct) : '';
    drawTime();
    return pct;
  }
  function showPanel(title) {
    ensurePanel();
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (tick) { clearInterval(tick); tick = null; }
    tStart = 0; prog = { n: 0, total: 0 }; curKlasor = null;
    panel.style.display = 'block'; panel.classList.remove('ue-simple');
    setState('run');
    q('.ue-title').textContent = title;
    q('.ue-stop').style.display = 'inline-block'; q('.ue-stop').disabled = false; q('.ue-close').style.display = 'none';
    q('.ue-time').textContent = ''; q('.ue-count').textContent = ''; q('.ue-bar > div').style.width = '0%';
    setStage(''); setFile(''); setMsg(''); setDir(''); setCounts(0, 0, 0);
  }
  function finishPanel(kind, msg) {
    if (!panel) return;
    if (tick) { clearInterval(tick); tick = null; }
    setState(kind || 'ok');
    if (kind === 'err' && !tStart) panel.classList.add('ue-simple');   // indirme hiç başlamadıysa boş çubuk ve sayaç gösterme
    setStage(''); setFile(''); setMsg(msg || '');
    if (tStart) q('.ue-time').textContent = 'Süre ' + fmt((Date.now() - tStart) / 1000);
    q('.ue-stop').style.display = 'none'; q('.ue-close').style.display = 'inline-block';
    if (kind === 'ok') hideTimer = setTimeout(function () { panel.style.display = 'none'; }, 15000);   // hata ve uyarıda açık kalır
  }
  // Tek satırlık bildirim (tarayıcı uyarı penceresi yerine)
  function notify(kind, title, text) {
    if (running && panel && panel.style.display !== 'none') {   // süren eşitlemenin panelini bozma: geçici not göster
      var note = title + '. ' + text; setMsg(note);
      setTimeout(function () { if (running && panel && q('.ue-msg').textContent === note) setMsg(''); }, 6000);
      return;
    }
    ensurePanel();
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (tick) { clearInterval(tick); tick = null; }
    panel.style.display = 'block'; panel.classList.add('ue-simple'); curKlasor = null;
    setState(kind); q('.ue-title').textContent = title; setStage(''); setFile(''); setDir(''); setMsg(text);
    q('.ue-stop').style.display = 'none'; q('.ue-close').style.display = 'inline-block';
    if (kind !== 'err') hideTimer = setTimeout(function () { panel.style.display = 'none'; }, 9000);
  }
  function setStatus(s) { setMsg(s); }

  // ---------- evrak ağacını çek ve ayrıştır ----------
  function fetchTree(dosyaId, pageNumber) {
    var body = 'dosyaId=' + encodeURIComponent(dosyaId) + '&pageNumber=' + pageNumber;
    return fetch(TREE_URL, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: body
    }).then(function (r) { return r.text(); });
  }
  function looksLikeTree(html) { return /class="file"/.test(html) || /id="browser"/.test(html); }
  function parseTitle(titleHtml) {
    var div = document.createElement('div'); div.innerHTML = titleHtml || '';
    var out = {};
    [].forEach.call(div.querySelectorAll('div'), function (d) {
      var t = d.textContent || ''; var i = t.indexOf(':');
      if (i > 0) out[t.slice(0, i).trim().replace(/\s+/g, ' ')] = t.slice(i + 1).trim();
    });
    if (!Object.keys(out).length && div.textContent) out['_'] = div.textContent.trim();
    return out;
  }
  function parseTree(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var items = [];
    var yt = (html.match(/downloadDoc\([^,]+,\s*'[^']*'\s*,\s*'(\d+)'\s*\)/) || [])[1] || null;
    var spans = doc.querySelectorAll('span.file');
    var ekSayac = {};
    [].forEach.call(spans, function (sp) {
      var evrakId = sp.getAttribute('evrak_id');
      if (!evrakId) return;
      var title = sp.getAttribute('title') || sp.getAttribute('data-original-title') || '';
      var ana = sp.getAttribute('ana_evrak_id');
      var txt = (sp.textContent || '').replace(/\s+/g, ' ').trim();
      if (!title && ana) {
        // Ek: üst evrakı bul
        var li = sp.closest('li'); var parentLi = li && li.parentElement ? li.parentElement.closest('li') : null;
        var psp = parentLi ? parentLi.querySelector(':scope > span.file') : null;
        var pinfo = psp ? parseTitle(psp.getAttribute('title') || '') : {};
        var pkey = (pinfo['Birim Evrak No'] || sanitize((pinfo['Türü'] || 'Evrak') + '_' + (pinfo['Evrakın Onaylandığı Tarih'] || ''))) ;
        ekSayac[pkey] = (ekSayac[pkey] || 0) + 1;
        var n = (txt.match(/\d+/) || [ekSayac[pkey]])[0];
        var pdate = trDate(pinfo['Evrakın Onaylandığı Tarih'] || pinfo['Sisteme Gönderildiği Tarih'] || '');
        items.push({
          evrakId: evrakId, key: pkey + '_ek' + n,
          name: pdate + '_' + sanitize(pinfo['Türü'] || 'Evrak') + '_' + sanitize(pkey) + '_Ek' + n,
          label: (pinfo['Türü'] || 'Evrak') + ' Ek ' + n, date: pdate
        });
        return;
      }
      var info = parseTitle(title);
      var birim = info['Birim Evrak No'] || '';
      var tur = info['Türü'] || (sp.closest('li') && sp.closest('li').getAttribute('data-sid') || txt).replace(/\s*\d{2}\/\d{2}\/\d{4}\s*$/, '') || 'Evrak';
      var date = trDate(info['Evrakın Onaylandığı Tarih'] || info['Sisteme Gönderildiği Tarih'] || txt);
      var key = birim ? birim : sanitize(tur + '_' + date + '_' + (info['Açıklama'] || '').slice(0, 60));
      items.push({ evrakId: evrakId, key: key, name: date + '_' + sanitize(tur) + (birim ? '_' + sanitize(birim) : ''), label: tur + ' ' + date, date: date });
    });
    var total = parseInt((html.match(/pageTotal\s*=\s*(\d+)/) || [])[1] || '1', 10) || 1;
    return { items: items, total: total, yargiTuru: yt };
  }

  // ---------- UYAP'ın kendi isteklerinden dosya kimliğini yakala ----------
  var captured = { id: null, t: 0 };
  function noteDosyaId(s) {
    if (!s) return;
    var m = String(s).match(/dosyaId=([^&]+)/), isJson = false;
    if (!m) { m = String(s).match(/"dosyaId"\s*:\s*"((?:[^"\\]|\\.)+)"/); isJson = !!m; }
    if (!m) return;
    try { var v = isJson ? JSON.parse('"' + m[1] + '"').trim() : decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); if (/[A-Za-z0-9+\/@=]{40,}/.test(v)) { captured = { id: v, t: Date.now() }; log('dosyaId yakalandı'); } } catch (e) {}
  }
  try {
    var _open = XMLHttpRequest.prototype.open, _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, url) { this.__uyapUrl = url; return _open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) { noteDosyaId(this.__uyapUrl); if (typeof body === 'string') noteDosyaId(body); else if (body && typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) noteDosyaId(body.toString()); else if (body && typeof FormData !== 'undefined' && body instanceof FormData) { try { var fd = body.get('dosyaId'); if (fd) noteDosyaId('dosyaId=' + encodeURIComponent(fd)); } catch (e) {} } return _send.apply(this, arguments); };
    var _fetch = window.fetch;
    if (_fetch) window.fetch = function (input, init) { try { noteDosyaId(typeof input === 'string' ? input : (input && input.url)); if (init && typeof init.body === 'string') noteDosyaId(init.body); } catch (e) {} return _fetch.apply(this, arguments); };
  } catch (e) { log('hook kurulamadı', e); }

  function findGoruntuleBtn(tr) {
    var cands = tr.querySelectorAll('button, a, input[type=button]');
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i]; if (c.classList.contains('uyap-esitle-btn')) continue;
      if (/görüntüle|goruntule/i.test(c.textContent || c.value || '')) return c;
    }
    for (var j = 0; j < cands.length; j++) if (!cands[j].classList.contains('uyap-esitle-btn')) return cands[j];
    return null;
  }

  // TIKLAMASIZ YOL: "Dosya Görüntüle" düğmesinin işleyicisi  Xxx.baslat(data)  biçiminde; data = dosya kaydı (kimlik içinde).
  // Pencereyi açan fonksiyonu bir anlığına yakalayıcıyla değiştirip işleyiciyi çalıştırırız: pencere açılmaz, kayıt elimize geçer.
  function idFromHandler(tr) {
    try {
      var $ = window.jQuery, gb = findGoruntuleBtn(tr);
      if (!$ || !$._data || !gb) return null;
      var ev = $._data(gb, 'events');
      if (!ev || !ev.click) return null;
      for (var i = 0; i < ev.click.length; i++) {
        var h = ev.click[i].handler, src = String(h);
        var m = src.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)\s*\(\s*data\s*\)/);
        if (!m) continue;
        var owner = m[1].split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, window), fn = m[2];
        if (!owner || typeof owner[fn] !== 'function') { log('tıklamasız yol: ' + fn + ' fonksiyonuna erişilemedi'); continue; }
        var orig = owner[fn], got = null;
        owner[fn] = function (d) { got = d; };
        try { h.call(gb, $.Event('click')); } catch (e) { log('tıklamasız yol: işleyici hata verdi', e && e.message); } finally { owner[fn] = orig; }
        if (!got) continue;
        var id = findEnc(got);
        if (id) return id;
      }
    } catch (e) { log('tıklamasız yol hata', e && e.message); }
    return null;
  }

  // Açılan dosya penceresindeki "Evrak" sekmesini bulur (görünür olan, metni tam "Evrak")
  function findEvrakTab() {
    var cands = document.querySelectorAll('.modal a, .modal li, .modal button, .nav-tabs a, [role=tab]');
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if ((c.textContent || '').replace(/\s+/g, ' ').trim() !== 'Evrak') continue;
      if (c.offsetParent === null) continue;            // görünmüyor
      return c.tagName === 'LI' ? (c.querySelector('a') || c) : c;
    }
    return null;
  }

  // Satırdaki "Dosya Görüntüle"ye basıp kimliği yakalar, sonra eşitler
  async function openThenSync(tr, info, btn) {
    var gb = findGoruntuleBtn(tr);
    if (!gb) { notify('err', 'Dosya açılamadı', 'Bu satırda "Dosya Görüntüle" düğmesi bulunamadı. Dosyayı elle açıp evrak listesinin üstündeki "Bu dosyayı Eşitle" düğmesini kullanın.'); return; }
    var before = captured.t, prevGlobal = (typeof window.dosyaId === 'string') ? window.dosyaId : null;
    btn.disabled = true; btn.textContent = 'Dosya açılıyor...';
    gb.click();
    var id = null;
    var tabClicks = 0;
    for (var i = 0; i < 60; i++) {           // 18 sn bekle
      await sleep(300);
      if (captured.t > before && captured.id) { id = captured.id; break; }
      if (typeof window.dosyaId === 'string' && window.dosyaId !== prevGlobal && isEnc(window.dosyaId)) { id = window.dosyaId; break; }
      // Kimlik çoğu zaman ancak "Evrak" sekmesi açılınca istekte görünür: sekmeyi kullanıcı yerine aç
      if (i >= 2 && i % 5 === 2 && tabClicks < 4) {
        var tab = findEvrakTab();
        if (tab) { tabClicks++; btn.textContent = 'Evrak listesi açılıyor...'; log('Evrak sekmesi açılıyor (' + tabClicks + ')'); try { tab.click(); } catch (e) {} }
      }
    }
    if (!id) {
      btn.disabled = false; btn.textContent = 'Eşitle';
      notify('err', 'Dosya kimliği alınamadı', 'Dosya açıldı ama kimliği yakalanamadı. Evrak listesinin üstündeki "Bu dosyayı Eşitle" düğmesini deneyin.');
      return;
    }
    info.dosyaId = id;
    await syncDosya(info, btn);
  }

  // ---------- evrakı çek ----------
  function toBase64(buf) {
    var bytes = new Uint8Array(buf), bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function guessExt(resp, buf) {
    var cd = resp.headers.get('Content-Disposition') || '';
    var m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    if (m) { var e = (decodeURIComponent(m[1]).match(/\.([A-Za-z0-9]{1,5})$/) || [])[1]; if (e) return e.toLowerCase(); }
    var b = new Uint8Array(buf.slice(0, 64)); var head = String.fromCharCode.apply(null, b); var hl = head.toLowerCase().replace(/^\s+|^\xef\xbb\xbf/, '');
    if (hl.indexOf('<?xml') === 0) return 'xml';
    if (hl.indexOf('<html') === 0 || hl.indexOf('<!doctype') === 0 || hl.indexOf('<style') === 0 || hl.indexOf('<head') === 0 || hl.indexOf('<body') === 0) return 'html';
    if (head.indexOf('%PDF') === 0) return 'pdf';
    if (head.indexOf('PK') === 0) return 'udf';
    if (head.indexOf('II*') === 0 || head.indexOf('MM') === 0) return 'tif';
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpg';
    if (head.indexOf('\x89PNG') === 0) return 'png';
    var ct = (resp.headers.get('Content-Type') || '').toLowerCase();
    if (ct.indexOf('pdf') >= 0) return 'pdf';
    if (ct.indexOf('zip') >= 0 || ct.indexOf('udf') >= 0) return 'udf';
    if (ct.indexOf('tiff') >= 0) return 'tif';
    if (ct.indexOf('xml') >= 0) return 'xml';
    if (ct.indexOf('html') >= 0) return 'html';
    if (ct.indexOf('text/plain') >= 0) return 'txt';
    return 'bin';
  }
  async function fetchEvrak(evrakId, dosyaId, yargiTuru) {
    var url = DL_URL + '?evrakId=' + encodeURIComponent(evrakId) + '&dosyaId=' + encodeURIComponent(dosyaId) + '&yargiTuru=' + encodeURIComponent(yargiTuru);
    var resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var buf = await resp.arrayBuffer();
    var ct = (resp.headers.get('Content-Type') || '').toLowerCase();
    var isHtml = false, txt = '';
    try {
      var h64 = String.fromCharCode.apply(null, new Uint8Array(buf.slice(0, 64))).toLowerCase();
      isHtml = ct.indexOf('text/html') >= 0 || /^\s*<(html|!doctype|head|body|style|script|meta)/.test(h64);
      if (isHtml) txt = new TextDecoder('utf-8').decode(buf);
    } catch (e) {}
    if (isHtml) {
      var low = txt.toLowerCase();
      // UYAP'ın kendi sayfası mı (oturum düşmüş / giriş ekranı), yoksa evrak olarak saklanan bir HTML mi (KEP e-postası vb.)?
      var portalPage = /vatandas\.uyap\.gov\.tr|e-devlet|edevlet|oturum.*(sona|zaman|düş)|giri[şs] yap|<title>[^<]*uyap/i.test(low) && !/kep/i.test(low);
      if (portalPage) { var err = new Error('UYAP sayfası döndü'); err.html = true; err.snippet = txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300); throw err; }
    }
    if (buf.byteLength < 20) throw new Error('boş cevap');
    return { ext: guessExt(resp, buf), data: toBase64(buf), bytes: buf.byteLength };
  }

  // ---------- ana akış ----------
  var running = false;
  async function syncDosya(info, btn) {
    if (running) { notify('warn', 'Başka bir eşitleme sürüyor', 'Bitmesini bekleyin ya da paneldeki Durdur düğmesine basın.'); return; }
    if (!info.dosyaId) { notify('err', 'Dosya kimliği okunamadı', 'Dosyayı "Dosya Görüntüle" ile açın ve evrak listesinin üstündeki "Bu dosyayı Eşitle" düğmesini kullanın.'); return; }
    running = true; stopFlag = false;
    var klasor = klasorAdi(info.daire, info.esas);
    showPanel(info.daire + '  ' + info.esas);
    var setBtn = function (t) { if (btn) btn.textContent = t; };
    if (btn) { btn.disabled = true; btn.classList.remove('done', 'err'); btn.classList.add('busy'); setBtn('Hazırlanıyor'); }
    var ok = 0, fail = 0, skipped = 0, dirShown = klasor, errors = [], sessionLost = false, stopped = false, kalan = 0;
    var endKind = 'ok', endMsg = '';
    try {
      setStage('1/3  Yerel yardımcı denetleniyor');
      var p = await ask('ping', {}, 10000);
      if (!p || !p.ok) {
        if (/context invalidated/i.test(String(p && p.error))) throw new Error('Eklenti yenilenmiş ama bu sayfa eski sürümle açık. Sayfayı yenileyin (F5) ve yeniden deneyin.');
        throw new Error('Yerel yardımcıya ulaşılamadı (' + (p && p.error || '?') + '). Kurulum betiği çalıştırıldı mı, tarayıcı yeniden başlatıldı mı?');
      }
      if (p.baseDir) setDir(p.baseDir + '/' + klasor);

      setStage('1/3  Evrak listesi alınıyor');
      var all = [], seen = {}, page = 1, total = 1, yargiTuru = null, dosyaId = info.dosyaId;
      var html = await fetchTree(dosyaId, 1);
      if (!looksLikeTree(html)) {
        var alt = /^"/.test(dosyaId) ? dosyaId.replace(/^"|"$/g, '') : '"' + dosyaId + '"';
        html = await fetchTree(alt, 1);
        if (looksLikeTree(html)) dosyaId = alt;
      }
      if (!looksLikeTree(html)) throw new Error('Evrak listesi alınamadı. UYAP oturumu düşmüş olabilir: sayfayı yenileyip yeniden giriş yapın.');
      var parsed = parseTree(html);
      total = parsed.total; yargiTuru = parsed.yargiTuru || '1';
      parsed.items.forEach(function (it) { if (!seen[it.key]) { seen[it.key] = 1; all.push(it); } });
      for (page = 2; page <= total; page++) {
        setStage('1/3  Evrak listesi alınıyor (sayfa ' + page + ' / ' + total + ')');
        var h2 = await fetchTree(dosyaId, page);
        parseTree(h2).items.forEach(function (it) { if (!seen[it.key]) { seen[it.key] = 1; all.push(it); } });
        await sleep(400);
      }
      all.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

      setStage('2/3  Klasördeki dosyalarla karşılaştırılıyor');
      var ls = await ask('listDir', { klasor: klasor }, 20000);
      if (!ls || !ls.ok) throw new Error('Klasör okunamadı: ' + (ls && ls.error || '?'));
      dirShown = ls.dir || klasor; curKlasor = klasor; setDir(dirShown);
      var have = {};
      (ls.files || []).forEach(function (f) { have[f.replace(/\.[A-Za-z0-9]{1,5}$/, '')] = 1; });
      var todo = all.filter(function (it) { return !have[sanitize(it.name)] && !have[it.name]; });
      skipped = all.length - todo.length;
      setCounts(0, skipped, 0);
      log('toplam', all.length, 'inecek', todo.length, 'klasörde var', skipped);
      if (!todo.length) {
        q('.ue-bar > div').style.width = '100%';
        endMsg = 'Klasör güncel: dosyadaki ' + all.length + ' evrakın hepsi zaten klasörde.';
        return;
      }
      setStage('3/3  Evraklar indiriliyor');
      startClock();
      for (var i = 0; i < todo.length; i++) {
        if (stopFlag) { stopped = true; kalan = todo.length - i; break; }
        var it = todo[i];
        var pct = setProgress(i, todo.length);
        setFile(it.label); setBtn('%' + pct);
        var done = false, attempt;
        for (attempt = 1; attempt <= 2 && !done; attempt++) {
          try {
            var f = await fetchEvrak(it.evrakId, dosyaId, yargiTuru);
            var w = await ask('writeFile', { klasor: klasor, name: it.name, ext: f.ext, data: f.data }, 60000);
            if (w && w.ok) { ok++; done = true; }
            else { fail++; errors.push(it.label + ' | yazılamadı: ' + (w && w.error || '?')); log('yazılamadı', it.label, w); done = true; }
          } catch (e) {
            if (e && e.html) {
              // Gerçekten oturum mu düştü? Evrak listesi hâlâ geliyorsa hayır: bu evraka özgü hata.
              var alive = false;
              try { alive = looksLikeTree(await fetchTree(dosyaId, 1)); } catch (e2) {}
              if (!alive) { sessionLost = true; fail++; errors.push(it.label + ' | oturum düştü'); done = true; break; }
              if (attempt < 2) { await sleep(2500); continue; }
              fail++; errors.push(it.label + ' | UYAP evrak yerine sayfa döndürdü: ' + (e.snippet || '')); log('evrak hatası', it.label, e.snippet); done = true;
            } else {
              if (attempt < 2) { await sleep(2500); continue; }
              fail++; errors.push(it.label + ' | ' + (e && e.message || e)); log('indirilemedi', it.label, e); done = true;
            }
          }
        }
        setCounts(ok, skipped, fail); setProgress(i + 1, todo.length);
        if (sessionLost) { kalan = todo.length - i - 1; break; }
        await sleep(DELAY_MS);
      }
      if (!stopped && !sessionLost) setProgress(todo.length, todo.length);
      if (errors.length) {
        try {
          var rapor = 'UYAP Eşitleyici hata raporu  ' + new Date().toLocaleString('tr-TR') + '\n' + info.daire + ' ' + info.esas + '\n\n' + errors.join('\n') + '\n';
          await ask('writeFile', { klasor: klasor, name: '_hatalar', ext: 'txt', data: btoa(unescape(encodeURIComponent(rapor))) }, 20000);
        } catch (e3) {}
      }
      if (sessionLost) { endKind = 'err'; endMsg = 'UYAP oturumu düşmüş görünüyor. ' + ok + ' evrak yazıldı. Yeniden giriş yapıp Eşitle\'ye basın: kaldığı yerden devam eder.'; }
      else if (stopped) { endKind = 'warn'; endMsg = 'Durduruldu. ' + ok + ' evrak yazıldı, ' + kalan + ' evrak kaldı. Yeniden Eşitle\'ye basınca kaldığı yerden devam eder.'; }
      else if (fail) { endKind = 'warn'; endMsg = ok + ' yeni evrak yazıldı, ' + fail + ' evrak indirilemedi. Ayrıntı klasördeki _hatalar.txt dosyasında.'; }
      else { endMsg = ok + ' yeni evrak klasöre yazıldı.' + (skipped ? ' ' + skipped + ' evrak zaten vardı.' : ''); }
    } catch (e) {
      log(e); endKind = 'err'; endMsg = (e && e.message) ? e.message : String(e);
    } finally {
      running = false; finishPanel(endKind, endMsg);
      if (btn) {
        btn.disabled = false; btn.classList.remove('busy');
        btn.classList.toggle('err', endKind === 'err' || fail > 0);
        btn.classList.toggle('done', endKind === 'ok');
        setBtn(endKind === 'ok' ? '✓ Eşitlendi' : (endKind === 'err' || fail ? 'Eşitle (hata var)' : 'Eşitle'));
      }
    }
  }

  // ---------- düğmeleri yerleştir ----------
  function makeBtn(text) { var b = document.createElement('button'); b.type = 'button'; b.className = 'uyap-esitle-btn'; b.textContent = text; return b; }

  // ---------- hangi ekrandayız? Eşitle yalnızca Dosya Sorgulama ekranındaki dosya satırlarında görünür ----------
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  var RE_DS = /^dosya\s+sorgulama$/i;
  function visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
  // 'evet' | 'hayir' | 'bilinmiyor'
  function ekranDosyaSorgulama() {
    var cur = (location.search.match(/[?&]menuId=(\d+)/i) || [])[1] || null;
    var links = [].filter.call(document.querySelectorAll('a'), function (a) { return RE_DS.test(norm(a.textContent)); });
    var i, linkIds = [];
    for (i = 0; i < links.length; i++) {
      var a = links[i], li = a.closest('li');
      // 1) menü bağlantısı o an seçili mi
      if (/(^|\s)(active|selected|current)(\s|$)/i.test(a.className + ' ' + (li ? li.className : ''))) return 'evet';
      // 2) menü bağlantısının taşıdığı menuId
      var attrs = [].map.call(a.attributes, function (x) { return x.value; }).join(' ');
      var m = attrs.match(/menuId\W{0,3}(\d+)/i); if (m) linkIds.push(m[1]);
    }
    if (cur && linkIds.indexOf(cur) >= 0) return 'evet';
    // 3) sayfa başlığı
    var heads = document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,.caption,.caption-subject,.page-title,.panel-title,.portlet-title,.card-title');
    for (i = 0; i < heads.length; i++) if (visible(heads[i]) && /^dosya\s+sorgulama(\s|$)/i.test(norm(heads[i].textContent))) return 'evet';
    if (cur && linkIds.length) return 'hayir';   // adres başka bir menüyü gösteriyor
    return 'bilinmiyor';
  }
  function tabloBasliklari(tr) {
    var t = tr.closest('table'); if (!t) return '';
    if (t.__ueHead == null) {
      var wrap = t.closest('.dataTables_wrapper') || t;
      t.__ueHead = norm([].map.call(wrap.querySelectorAll('thead th'), function (th) { return th.textContent; }).join(' | '));
    }
    return t.__ueHead;
  }
  // Satırda "Dosya Görüntüle" düğmesi var mı (ekran belirlenemezse kullanılır)
  function dosyaGoruntuleVar(tr) {
    var $ = window.jQuery, cands = tr.querySelectorAll('button, a, input[type=button]');
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i]; if (c.classList.contains('uyap-esitle-btn')) continue;
      var t = [c.title, c.getAttribute('data-original-title'), c.getAttribute('aria-label'), c.textContent, c.value].join(' ');
      if (/dosya\s*g[öo]r[üu]nt[üu]le/i.test(t)) return true;
      try {
        var ev = $ && $._data && $._data(c, 'events');
        if (ev && ev.click) for (var j = 0; j < ev.click.length; j++) if (/\.baslat\s*\(\s*data\s*\)/.test(String(ev.click[j].handler))) return true;
      } catch (e) {}
    }
    return false;
  }
  function satirUygun(tr, ekran) {
    if (ekran === 'hayir') return false;
    if (/[iİ][şŞ]\s*em[iİ]r/i.test(tabloBasliklari(tr))) return false;   // İşlemlerim tablosu: dosya listesi değil
    if (ekran === 'evet') return true;
    return dosyaGoruntuleVar(tr);
  }

  function scanRows() {
    var ekran = ekranDosyaSorgulama();
    if (ekran === 'hayir') {
      [].forEach.call(document.querySelectorAll('tr .uyap-esitle-btn'), function (b) { if (b.id !== 'uyap-esitle-tree-btn' && !b.classList.contains('busy')) b.remove(); });
      return;
    }
    var rows = document.querySelectorAll('table tbody tr[role="row"], table.dataTable tbody tr');
    [].forEach.call(rows, function (tr) {
      if (tr.querySelector('.uyap-esitle-btn') || tr.children.length < 2) return;
      var info = rowInfo(tr);
      if (!info) return;
      if (!satirUygun(tr, ekran)) return;
      var b = makeBtn('Eşitle');
      b.title = 'Bu dosyanın evraklarını ayarlardaki klasörün ' + klasorAdi(info.daire, info.esas) + ' alt klasörüne yazar (klasörde olanları atlar)';
      b.addEventListener('click', function (ev) {
        ev.stopPropagation(); ev.preventDefault();
        if (running) { notify('warn', 'Başka bir eşitleme sürüyor', 'Bitmesini bekleyin ya da paneldeki Durdur düğmesine basın.'); return; }
        var fresh = rowInfo(tr) || info;     // tablo yeniden çizilmiş olabilir
        if (!fresh.dosyaId) { fresh.dosyaId = idFromHandler(tr); if (fresh.dosyaId) log('kimlik tıklamadan alındı'); }
        if (fresh.dosyaId) syncDosya(fresh, b);
        else openThenSync(tr, fresh, b);
      });
      var td = tr.children[tr.children.length - 1];
      td.appendChild(b);
    });
  }

  function treeInfoFallback() {
    // Açık dosyanın daire / esas bilgisini bul: seçili satır > sayfa metni
    var sel = document.querySelector('tr.selected, tr.selected-row, tr.active');
    if (sel) { var ri = rowInfo(sel); if (ri) return ri; }
    var txt = (document.body.innerText || '');
    var daire = (txt.match(/([A-ZÇĞİÖŞÜ][\wÇĞİÖŞÜçğıöşü.]*\s+(?:\d+\.\s*)?(?:İcra Dairesi|İcra Hukuk Mahkemesi|İcra Ceza Mahkemesi|Asliye Hukuk Mahkemesi|Asliye Ceza Mahkemesi|Asliye Ticaret Mahkemesi|Sulh Ceza Hakimliği|Sulh Hukuk Mahkemesi|Cumhuriyet Başsavcılığı|Ağır Ceza Mahkemesi|[A-ZÇĞİÖŞÜ][a-zçğıöşü]+ Mahkemesi))/) || [])[1] || 'Dosya';
    var esas = (txt.match(/\b(\d{4}\/\d{1,7})\b/) || [])[1] || 'Esas';
    return { daire: daire.replace(/\s+/g, ' ').trim(), esas: esas, dosyaId: null };
  }

  function scanTreeView() {
    var anchor = document.getElementById('onizleme') || document.getElementById('pageTotalSpan');
    if (!anchor || document.getElementById('uyap-esitle-tree-btn')) return;
    var b = makeBtn('Bu dosyayı Eşitle'); b.id = 'uyap-esitle-tree-btn';
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var info = treeInfoFallback();
      info.dosyaId = (typeof window.dosyaId === 'string' && window.dosyaId) ? window.dosyaId : info.dosyaId;
      if (!info.dosyaId) {
        var m = (document.documentElement.innerHTML.match(/var dosyaId\s*=\s*'("?[A-Za-z0-9+\/@=]{40,}"?)'/) || [])[1];
        if (m) info.dosyaId = m;
      }
      syncDosya(info, b);
    });
    var p = anchor.closest('p') || anchor.parentElement;
    (p || anchor.parentElement).appendChild(b);
  }

  var scheduled = false;
  function scheduleScan() {
    if (scheduled) return; scheduled = true;
    setTimeout(function () { scheduled = false; try { scanRows(); scanTreeView(); } catch (e) { log(e); } }, 300);
  }
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  scheduleScan();
  log('yüklendi');
})();
