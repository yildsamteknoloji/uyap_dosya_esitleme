#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UYAP Dosya Eşitleyici - yerel yardımcı (Chromium native messaging host)

Tarayıcı eklentisi bu betiğe mesaj gönderir; betik klasörü listeler ve dosyaları yazar.
Protokol: 4 bayt (little-endian uzunluk) + UTF-8 JSON.
Komutlar:
  {"cmd":"ping"}                                  -> {"ok":true,"version":"2.1","home":"<ev klasörü>"}
  {"cmd":"list","dir":"~/UYAP/Daire_Esas"}        -> {"ok":true,"dir":"...","files":["a.pdf",...]}
  {"cmd":"write","dir":"...","name":"x","ext":"pdf","data":"<base64>"} -> {"ok":true,"path":"...","bytes":1234}
  {"cmd":"open","dir":"..."}                      -> {"ok":true,"dir":"..."}   (klasörü dosya yöneticisinde açar)
Betik sadece yazılan klasöre dokunur; hiçbir yere ağ bağlantısı kurmaz.
Linux, macOS ve Windows'ta çalışır.
"""
import sys, os, json, struct, base64, re, time, subprocess

VERSION = "2.1"

if sys.platform == "win32":
    # Windows'ta standart giriş/çıkış metin kipinde açılır; mesajlar bozulmasın diye ikili kipe al
    import msvcrt
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
LOG = os.path.expanduser("~/.uyap_esitle_host.log")


def log(msg):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + str(msg) + "\n")
    except Exception:
        pass


def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    (n,) = struct.unpack("<I", raw)
    data = sys.stdin.buffer.read(n)
    return json.loads(data.decode("utf-8"))


def send_msg(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def safe_name(s):
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", str(s or ""))
    s = re.sub(r"\s+", " ", s).strip().replace(" ", "_")
    return s[:150] or "Dosya"


def resolve_dir(d):
    d = os.path.expanduser(str(d or "~/UYAP"))
    d = os.path.abspath(d)
    return d


def open_folder(d):
    """Klasörü işletim sisteminin dosya yöneticisinde açar. Alt süreç, tarayıcıyla konuştuğumuz
    standart çıkışı devralmasın diye giriş/çıkışı boşa yönlendirilir."""
    if sys.platform == "win32":
        os.startfile(d)
        return
    cmd = ["open", d] if sys.platform == "darwin" else ["xdg-open", d]
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


def handle(msg):
    cmd = msg.get("cmd")
    if cmd == "ping":
        return {"ok": True, "version": VERSION, "home": os.path.expanduser("~")}

    if cmd == "list":
        d = resolve_dir(msg.get("dir"))
        os.makedirs(d, exist_ok=True)
        files = [f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))]
        return {"ok": True, "dir": d, "files": files}

    if cmd == "write":
        d = resolve_dir(msg.get("dir"))
        os.makedirs(d, exist_ok=True)
        name = safe_name(msg.get("name"))
        ext = re.sub(r"[^A-Za-z0-9]", "", str(msg.get("ext") or "bin")).lower() or "bin"
        data = base64.b64decode(msg.get("data") or "")
        path = os.path.join(d, name + "." + ext)
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        return {"ok": True, "path": path, "bytes": len(data)}

    if cmd == "open":
        d = resolve_dir(msg.get("dir"))
        if not os.path.isdir(d):
            return {"ok": False, "error": "klasör henüz yok: " + d}
        open_folder(d)
        return {"ok": True, "dir": d}

    return {"ok": False, "error": "bilinmeyen komut: %r" % cmd}


def main():
    while True:
        try:
            msg = read_msg()
        except Exception as e:
            log("okuma hatası: %r" % e)
            return
        if msg is None:
            return
        try:
            send_msg(handle(msg))
        except Exception as e:
            log("hata: %r  mesaj: %s" % (e, str(msg)[:200]))
            send_msg({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
