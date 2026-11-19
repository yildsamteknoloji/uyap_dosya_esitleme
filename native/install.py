#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UYAP Dosya Eşitleyici: yerel yardımcıyı tarayıcıya tanıtır (Linux, macOS, Windows).

Kullanım:
    Linux / macOS :  bash install.sh        (ya da: python3 install.py)
    Windows       :  install_windows.bat    (ya da: python install.py)

Ne yapar: Chromium tabanlı tarayıcılara (Brave, Chrome, Chromium, Edge) "bu eklenti şu betikle konuşabilir"
diyen küçük bir kayıt dosyası yazar. Başka hiçbir şeye dokunmaz. Kaldırmak için: python3 install.py --kaldir
"""
import json, os, struct, subprocess, sys

NAME = "com.yildsam.uyap_esitle"
EXT_ID = "dddoamcdjibnmeocehdlolhaipfpdgll"
HERE = os.path.dirname(os.path.abspath(__file__))
HOST = os.path.join(HERE, "uyap_esitle_host.py")


def linux_targets(home):
    c = os.path.join(home, ".config")
    return [
        ("Brave", os.path.join(c, "BraveSoftware", "Brave-Browser")),
        ("Brave Beta", os.path.join(c, "BraveSoftware", "Brave-Browser-Beta")),
        ("Brave Nightly", os.path.join(c, "BraveSoftware", "Brave-Browser-Nightly")),
        ("Chrome", os.path.join(c, "google-chrome")),
        ("Chromium", os.path.join(c, "chromium")),
        ("Edge", os.path.join(c, "microsoft-edge")),
        ("Brave (Flatpak)", os.path.join(home, ".var", "app", "com.brave.Browser", "config", "BraveSoftware", "Brave-Browser")),
        ("Brave (Snap)", os.path.join(home, "snap", "brave", "current", ".config", "BraveSoftware", "Brave-Browser")),
    ]


def mac_targets(home):
    a = os.path.join(home, "Library", "Application Support")
    return [
        ("Brave", os.path.join(a, "BraveSoftware", "Brave-Browser")),
        ("Chrome", os.path.join(a, "Google", "Chrome")),
        ("Chromium", os.path.join(a, "Chromium")),
        ("Edge", os.path.join(a, "Microsoft Edge")),
    ]


WIN_KEYS = [
    ("Brave", r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"),
    ("Chrome", r"Software\Google\Chrome\NativeMessagingHosts"),
    ("Chromium", r"Software\Chromium\NativeMessagingHosts"),
    ("Edge", r"Software\Microsoft\Edge\NativeMessagingHosts"),
]


def manifest(path):
    return {
        "name": NAME,
        "description": "UYAP Dosya Eşitleyici yerel yardımcı",
        "path": path,
        "type": "stdio",
        "allowed_origins": ["chrome-extension://%s/" % EXT_ID],
    }


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def install_posix(targets, launcher):
    yazilan = 0
    for ad, kok in targets:
        if not os.path.isdir(kok):
            continue                      # bu tarayıcı kurulu değil
        d = os.path.join(kok, "NativeMessagingHosts")
        os.makedirs(d, exist_ok=True)
        write_json(os.path.join(d, NAME + ".json"), manifest(launcher))
        print("  yazıldı (%s): %s" % (ad, os.path.join(d, NAME + ".json")))
        yazilan += 1
    return yazilan


def uninstall_posix(targets):
    for ad, kok in targets:
        f = os.path.join(kok, "NativeMessagingHosts", NAME + ".json")
        if os.path.isfile(f):
            os.remove(f)
            print("  silindi (%s): %s" % (ad, f))


def install_windows():
    import winreg
    # Windows .py dosyasını doğrudan başlatamaz: araya küçük bir .bat konur
    bat = os.path.join(HERE, "uyap_esitle_host.bat")
    with open(bat, "w", encoding="utf-8", newline="\r\n") as f:
        f.write('@echo off\n"%s" "%s"\n' % (sys.executable, HOST))
    mf = os.path.join(HERE, NAME + ".json")
    write_json(mf, manifest(bat))
    yazilan = 0
    for ad, key in WIN_KEYS:
        k = winreg.CreateKey(winreg.HKEY_CURRENT_USER, key + "\\" + NAME)
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, mf)
        winreg.CloseKey(k)
        print("  kayıt defterine yazıldı (%s)" % ad)
        yazilan += 1
    return yazilan


def uninstall_windows():
    import winreg
    for ad, key in WIN_KEYS:
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key + "\\" + NAME)
            print("  kayıt silindi (%s)" % ad)
        except OSError:
            pass


def self_test():
    """Yardımcıyı tarayıcının yapacağı gibi çalıştırıp 'ping' gönderir."""
    m = b'{"cmd":"ping"}'
    try:
        out = subprocess.run([sys.executable, HOST], input=struct.pack("<I", len(m)) + m,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15).stdout
        (n,) = struct.unpack("<I", out[:4])
        r = json.loads(out[4:4 + n].decode("utf-8"))
        return bool(r.get("ok")), "sürüm %s, ev klasörü %s" % (r.get("version"), r.get("home"))
    except Exception as e:
        return False, str(e)


def main():
    kaldir = "--kaldir" in sys.argv
    home = os.path.expanduser("~")
    print("UYAP Dosya Eşitleyici yerel yardımcı %s" % ("kaldırılıyor" if kaldir else "kuruluyor"))
    if sys.platform == "win32":
        if kaldir:
            uninstall_windows(); return 0
        n = install_windows()
    else:
        targets = mac_targets(home) if sys.platform == "darwin" else linux_targets(home)
        if kaldir:
            uninstall_posix(targets); return 0
        os.chmod(HOST, 0o755)
        launcher = HOST
        if sys.platform == "darwin":
            # macOS'ta tarayıcı kısıtlı bir PATH ile başlar; Python'un tam yolunu kullanan küçük bir başlatıcı yaz
            launcher = os.path.join(HERE, "uyap_esitle_host.sh")
            with open(launcher, "w", encoding="utf-8") as f:
                f.write('#!/bin/sh\nexec "%s" "%s"\n' % (sys.executable, HOST))
            os.chmod(launcher, 0o755)
        n = install_posix(targets, launcher)
    if not n:
        print("HATA: Kurulu bir Chromium tabanlı tarayıcı (Brave, Chrome, Chromium, Edge) bulunamadı.")
        return 1
    ok, bilgi = self_test()
    print("Kendi kendine test: %s (%s)" % ("BAŞARILI" if ok else "BAŞARISIZ", bilgi))
    print()
    print("Kurulum tamam. Tarayıcıyı TAMAMEN kapatıp yeniden açın (yalnızca pencereyi kapatmak yetmez).")
    print("Eklenti kimliği şu olmalı: %s" % EXT_ID)
    if sys.platform.startswith("linux"):
        print("Not: Tarayıcı Flatpak ya da Snap olarak kuruluysa kum havuzu yüzünden yardımcıya erişemeyebilir.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
