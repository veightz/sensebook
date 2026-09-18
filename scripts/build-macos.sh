#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
output="$root/dist/native"
app="$output/Sensebook.app"
mkdir -p "$output" "$app/Contents/MacOS" "$app/Contents/Resources"
for arch in arm64 x86_64; do
  swift build --package-path macos -c release --arch "$arch"
  binary_dir=$(swift build --package-path macos -c release --arch "$arch" --show-bin-path)
  cp "$binary_dir/Sensebook" "$output/Sensebook-$arch"
done
lipo -create "$output/Sensebook-arm64" "$output/Sensebook-x86_64" -output "$app/Contents/MacOS/Sensebook"
cp macos/Resources/Info.plist "$app/Contents/Info.plist"
swift macos/make-icon.swift "$output/icon.png"
iconset="$output/AppIcon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$output/icon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  doubled=$((size * 2))
  sips -z "$doubled" "$doubled" "$output/icon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"
codesign --force --sign - --identifier com.veightz.sensebook.mac "$app"
codesign --verify --deep --strict "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$output/Sensebook-0.3.0-preview.1-macOS-universal.zip"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/Sensebook.app"
ln -s /Applications "$stage/Applications"
cp macos/INSTALL.md "$stage/安装说明.txt"
hdiutil create -volname Sensebook -srcfolder "$stage" -ov -format UDZO "$output/Sensebook-0.3.0-preview.1-macOS-universal.dmg"
