# KB Studio: agent instructions

KB Studio is a Tauri desktop app with two workspaces: Create, a Canva-style design
editor with classroom and preschool tools (the main focus), and Photos, for culling
and editing a photo shoot. Rust in `src-tauri/src`, plain JavaScript in `ui/` with
no bundler. This repository is public, so keep personal details, real photos and
local paths out of code, docs and commits.

## Name

The app was once called Shoot Studio. Use "KB Studio" in anything a person reads.
These old identifiers stay because installed copies and saved data depend on them:
- `.shootstudio/` in each shoot folder: existing ratings and edits live there.
- `identifier` `dev.matt.shoot-studio` in `tauri.conf.json`: the app's settings folder.
- Cargo package `shoot-studio`: the binary name, window app id and `shoot-studio.desktop` entry.
- The GitHub repository name, which the updater endpoint uses.

## Build and checks (from the repository root)

Needs Rust, Node.js, Chromium and Tauri 2 Linux system libraries (README.md, Development).
- Run: `npx @tauri-apps/cli@2 dev`.
- Build the local binary: `cargo build --release --manifest-path src-tauri/Cargo.toml`.
- Rust tests: `cargo test --release --manifest-path src-tauri/Cargo.toml` (matches CI).
- UI checks: `node ui-check.cjs` (headless Chromium, mocked Tauri commands;
  set `CHROMIUM` to select the browser; exercises WebGL2 through SwiftShader).
- Lint: `cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml`.
- `live-check.sh` drives the real window on a hidden Hyprland monitor; read its
  usage first and use disposable shoot folders because the app writes `.shootstudio/`.

## Code map

- `ui/app.js`: photo browsing, Develop controls and Deliver; `ui/develop.js`: the WebGL2
  develop engine (sliders, looks, shaders, zoom); `ui/photobar.js`: view buttons, photo
  bar, filmstrip and Develop drawers.
- `ui/create.js`: Create design editor; the other `ui/*.js` split out its tools.
- `ui/index.html` and `ui/style.css`: shared markup and styles; `ui/vendor/`: bundled libraries.
- `src-tauri/src/main.rs`: Tauri commands, photo loading, recipes and delivery file writes.
- `src-tauri/src/retouch.rs`, `photocraft*.rs` and `photocraft*/`: image processing.
- `src-tauri/src/cutout.rs`, `effects.rs`, `faces.rs`, `focus.rs`, `reshape.rs`,
  `see_through.rs`, `straighten.rs`: Create's photo tools (Cut out, Effects, Faces, Edit photo).
- `src-tauri/src/creations.rs`, `pptx.rs`, `backup.rs`: designs, imports and backups;
  `desktop.rs`: AppImage menu entry and dock pin.
- Large files: `main.rs` and `create.js` (~2,200 lines), `app.js` (~1,200),
  `photocraft_remove.rs` (~1,400), `ui-check.cjs` (~3,300). Locate the symbol first,
  then read a relevant line range with `sed -n 'START,ENDp'`; do not read them whole.
- `ui-check.cjs` is the UI regression harness; `test-data/` holds synthetic fixtures.

## Shared notes

Never read `PROJECT_NOTES.md` whole; retrieve only the relevant note by header and ID.
Chats may share a git-ignored `PROJECT_NOTES.md`. Never edit it directly:
post each note as a fenced `project-note` block in your reply, under 4,000
characters. When a round is committed and checked, close its notes with one
`SUMMARY` note whose last line is `Close:` and the ids it makes obsolete, and
carry anything still open into a single `BACKLOG` note. Never close a note
whose open items aren't carried in the backlog, a doc or git.

## Releases

- Keep versions in `src-tauri/Cargo.toml`, its application entry in `Cargo.lock`,
  and `src-tauri/tauri.conf.json` aligned; record releases in `CHANGELOG.md`.
- Release builds come only from `.github/workflows/release.yml` on Ubuntu 22.04
  for Zorin OS 17 compatibility. Local builds do not validate signed updates.
- Commit only when the owner asks; the owner pushes and tags.
