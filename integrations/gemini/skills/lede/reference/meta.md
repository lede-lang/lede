# Lede reference: page metadata
Meta lines (`@key value`) go at the top of the page, before the first heading. The core reference covers `@title`,
`@subtitle`, `@author`, `@date` and `@width wide`; these add to them.

| Key | Value | Effect |
|---|---|---|
| `@description` | one sentence | The page's description for search and link previews. When publishing as a Claude Artifact, pass the same sentence as the tool's `description`. |
| `@accent` | `#2357c6` (a hex colour) | Links, labels and highlights take this colour. It must read as text: `check` warns (`accent-contrast`) when it is under 4.5:1 on the page background; pick a darker one for light pages, lighter for dark. |
| `@theme` | `light` or `dark` | Forces one theme instead of following the reader's system setting. |
| `@lang` | `es`, `fr`, `de`... | The page's language code (default `en`); changes hyphenation and screen-reader voice, not the text. |
| `@status` | `Shipped=good, Parked=neutral` | Your own status words: each shows as a coloured chip wherever a status word does (table cells, kpi notes, steps). Tones: `good`, `warn`, `bad`, `info`, `neutral`. |
| `@meta` | `Owner \| Ana Ruiz` | A fact shown under the title (owner, status, review date); repeat the line for more. |
| `@image` | an `https://` image URL | The picture shown in link previews. |
| `@canonical` | an `https://` URL | The page's one true address, when it is published in several places. |
| `@width` | `wide` or `narrow` | Dashboards are already wide; `narrow` keeps the reading column, `wide` widens any page. |

Rules: one line per key, no key twice (`@status` and `@meta` may repeat). Write `@description` on every page meant to be shared. Use `@accent` for a brand
colour, not for emphasis (the compiler colours status words and tones itself). Do not force `@theme` unless the page is
for a wall screen or a slide; readers choose. `@lang` matches the language the page is written in.
<!-- teaches: @description, @accent, @theme, @lang, @status, @meta, @image, @canonical, @width -->
