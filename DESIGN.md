---
version: alpha
name: KB Studio
colors:
  primary: "#a8479a"
  surface: "#ffffff"
  background: "#fcf5fa"
  subtle: "#f6eef8"
  text: "#392844"
  secondary-text: "#7c6887"
  photo: "#323136"
typography:
  controls:
    fontFamily: "system-ui, sans-serif"
  heading:
    fontFamily: "Lexend, system-ui, sans-serif"
    fontWeight: 700
  tagline:
    fontFamily: "Caveat, cursive"
    fontWeight: 700
rounded:
  control: "8px"
  welcome: "26px"
spacing:
  action-gap: "12px"
  start-max: "1180px"
---

## Overview

KB Studio is a desktop workspace for making classroom materials, designing with photos, and editing shoots. Start feels like opening a teacher's project desk, with the existing illustration as its welcome. The editing workspaces emphasize the work itself and keep actions visible for mouse users.

## Colors

`ui/style.css` owns the runtime palette. The values above mirror `--accent`, `--panel`, `--bg`, `--deep`, `--text`, `--muted`, and `--photo`. Keep the established blush, lavender, and sky colors, the orchid action accent, and the neutral photo well. Use text and icons alongside color to show selection, rating, and tool state.

## Typography

Use system UI text for controls, Lexend for workspace headings, and Caveat for the Start tagline. The editor's document fonts belong to the design itself.

## Layout

Start pairs the original `ui/home-art.jpg` with the studio name, followed by project actions, recent designs, and template groups. Create follows the Canva-style arrangement of a command bar and selection toolbar above the page, a tool rail and drawer on the left, and page controls below. Edit photo uses that same drawer with a labeled tool picker.

Photos is a contact sheet. Keep shoot actions, view controls, and output actions in separate groups. Put filenames below the thumbnails and keep the loupe, Compare, and Develop views on neutral backgrounds.

Use the illustration as a washed backdrop on Start and as a faint backdrop behind workspace controls and the contact sheet. Keep it outside the photo viewing areas, design canvas, and exported work.

## Components

Reuse the existing buttons, segmented controls, rails, and drawers in `ui/style.css`. Keep the control label visible, the selected state distinct, and the keyboard focus ring visible even on a selected control. At smaller window sizes, wrap command groups and let tool drawers scroll.

Give frequent actions a visible click target. Show photo selection on the contact sheet, put source picking and crop cancellation next to their tools, and keep canvas commands under Edit. Show shortcut hints on demand and in tooltips.
