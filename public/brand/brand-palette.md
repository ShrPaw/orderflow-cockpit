# Brand Palette — Orderflow Cockpit

## Core Colors

| Role | Name | Hex | Usage |
|------|------|-----|-------|
| Background | Deep Night | `#0A0E14` | App background |
| Panel | Dark Slate | `#111827` | Panels, sidebars |
| Border | Slate Border | `#182030` | All borders |
| Field Deep | Ocean | `#0D4F6E` | Outermost field lines |
| Field Mid | Teal Current | `#00B8C4` | Mid field lines, secondary accents |
| Field Inner | Bright Teal | `#00E8DC` | Inner field lines |
| Core | Pulse Cyan | `#00F5EC` | Gravity point, primary accent |
| Text Primary | Silver | `#E0E6ED` | Headings, primary text |
| Text Muted | Steel | `#4A5E6E` | Secondary text, labels |
| Border Accent | Slate Light | `#1F2B40` | Hover borders |

## CSS Variables (index.css)

```css
--brand-deep:    #0d4f6e;
--brand-teal:    #00b8c4;
--brand-cyan:    #00e8dc;
--brand-core:    #00f5ec;
```

## Typography

- **ORDERFLOW** — Inter 300 (Light), letter-spacing 6px
- **COCKPIT** — Inter 200 (ExtraLight), letter-spacing 10px
- Fallback: Helvetica Neue, Helvetica, Arial, sans-serif

## Symbolism

The Liquidity Field mark represents:
- **Converging field lines** — market pressure and liquidity density
- **Central gravity point** — the invisible force shaping all flow
- **Density nodes** — detected liquidity concentrations
- **Asymmetric curves** — the market is never symmetrical; there are always imbalances

## Usage Rules

1. Always use on dark backgrounds (`#0A0E14` or darker)
2. Never add drop shadows or heavy glow effects
3. The icon mark can stand alone at any size
4. Minimum icon size: 16px
5. For light backgrounds, use the mono-dark variant
