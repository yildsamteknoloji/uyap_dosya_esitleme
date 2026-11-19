#!/bin/bash
# UYAP Dosya Eşitleyici: yerel yardımcıyı tarayıcıya tanıtır (Linux ve macOS)
# Kullanım:  bash install.sh        Kaldırmak için:  bash install.sh --kaldir
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "HATA: python3 bulunamadı. Önce Python 3 kurun."
  echo "  Linux (Debian/Ubuntu): sudo apt install python3"
  echo "  macOS: xcode-select --install   ya da   https://www.python.org/downloads/"
  exit 1
fi
exec python3 "$DIR/install.py" "$@"
