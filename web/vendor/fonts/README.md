# Self-hosted fonts

Latin-subset woff2 files for the design system (see `../../style.css`
`@font-face` rules). Self-hosted on purpose: the SPA CSP
(`style-src 'self'`, no CDN) forbids `fonts.googleapis.com`.

All three families are licensed under the SIL Open Font License 1.1.

| File | Family | Weights (variable) | Source |
|------|--------|--------------------|--------|
| `space-grotesk-latin.woff2` | Space Grotesk | 500–700 | fonts.gstatic.com `s/spacegrotesk/v22` |
| `inter-latin.woff2` | Inter | 400–700 | fonts.gstatic.com `s/inter/v20` |
| `jetbrains-mono-latin.woff2` | JetBrains Mono | 400–600 | fonts.gstatic.com `s/jetbrainsmono/v24` |

Refresh with (Google Fonts css2 API, modern UA to get woff2 + the
`/* latin */` block only); keep the filenames the `@font-face` rules use.
