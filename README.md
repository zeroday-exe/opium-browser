<p align="center"><img src="opium/logo.png" width="128" alt="Opium"></p>

<h1 align="center">Opium</h1>

<p align="center">A privacy-first browser built on Firefox. Purple, minimal and Zen-inspired, with glowing snowfall.</p>

## Features

- **A standalone browser**: compiled from Firefox source with its own name, logo, `opium.exe` and installer
- **Hardened privacy**: zero telemetry, no studies or crash reporter, Total Cookie Protection, strict tracking protection, fingerprinting protection, DNS over HTTPS (Quad9), HTTPS-only, WebRTC leak protection, Global Privacy Control
- **Built-in ad blocker**: uBlock Origin is bundled with an extended set of filter lists (ads, trackers, malware, cookie banners, annoyances)
- **Zen-style UI**: vertical tabs, a floating rounded content card and a purple glow theme
- **macOS window controls**: red, yellow and green buttons on the left
- **Glowing snowflakes**: in the sidebar and on the start page
- **JetBrainsMono Nerd Font** throughout the UI
- **Brave import**: Menu → Bookmarks → Import from another browser → Brave (passwords, bookmarks, history)
- **Private search**: DuckDuckGo by default, with Startpage (`@sp`) and Brave Search (`@br`)

## Installation

Download `Opium-Setup-1.0.0.exe` (installer) or `Opium-Portable-1.0.0.exe` from [Releases](../../releases).

Build the Electron version yourself: `cd electron && npm install && npm run dist`

## Building from source

Requirements: Windows 10/11, about 40 GB of free disk space, Python 3 with Pillow, and [MozillaBuild](https://wiki.mozilla.org/MozillaBuild).

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

Individual steps: `-Step fetch | prepare | bootstrap | build | package`

Output: `dist/Opium-<version>-setup.exe` and `dist/Opium-<version>-portable.zip`

## Project structure

| Path | Contents |
|---|---|
| `opium/prefs/opium.js` | Privacy defaults |
| `opium/files/userChrome.css` | Browser UI |
| `opium/files/opium-start.html` | Start page |
| `opium/files/policies.json` | Enterprise policies (uBlock, search, telemetry) |
| `scripts/prepare.py` | Applies branding, logo, theme, fonts and prefs to the Firefox source |
| `mozconfig` | Build configuration |

## Privacy compared with Tor

Opium blocks tracking and fingerprinting very aggressively, but it does not hide your IP address. For anonymity, use Tor Browser.

## License

The Opium sources are MIT-licensed. Firefox is under the MPL 2.0, uBlock Origin under the GPLv3, and JetBrains Mono under the OFL.
