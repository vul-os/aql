# Bot Korp Theme Update - Complete ✅

## Overview
Successfully updated the entire frontend color palette to use the modern tech color scheme with proper dark mode support.

## New Color Palette

### Primary Colors
- **Matte Black** (#121212) - Primary brand color
- **Bright Tangerine** (#FF6B35) - Accent color for CTAs and highlights
- **Slate Blue-Gray** (#4F5D75) - Secondary/supporting color
- **Cool Silver** (#B0B3B8) - Neutral/supporting color

### Design Philosophy
- **Light Mode**: Matte black primary with tangerine accents
- **Dark Mode**: Tangerine primary on matte black background
- High contrast for accessibility
- Modern, sleek, and professional appearance

## Files Updated

### 1. Core Theme Configuration
- ✅ `tailwind.config.js` - Updated color definitions and shadow effects
- ✅ `src/index.css` - Updated CSS variables for light and dark modes
- ✅ `src/colours.txt` - Documented new color palette
- ✅ `src/theme.js` - **NEW** Centralized theme configuration file

### 2. Layout Components
- ✅ `src/components/layout/portal-layout.jsx` - Updated sidebar, navigation, and header
- ✅ `src/components/theme-provider.jsx` - Already supports dark mode (no changes needed)

### 3. Landing Page
- ✅ `src/pages/landing/landing-page.jsx` - Updated hero, sections, and footer

### 4. Component Colors
Most UI components automatically inherit the new colors through CSS variables:
- Buttons use `primary`, `secondary`, `accent` classes
- Cards use `card` and `card-foreground`
- Borders use `border` color
- Focus rings use `ring` color (now tangerine)

## How to Use the New Theme

### Option 1: Use CSS Variable Classes (Recommended)
```jsx
// These automatically adjust for light/dark mode
<button className="bg-primary text-primary-foreground hover:bg-primary/90">
  Primary Button
</button>

<div className="bg-accent text-accent-foreground">
  Accent Section
</div>
```

### Option 2: Use Custom Color Classes
```jsx
// Direct color references
<div className="bg-botkorp-black text-white">
  Black Background
</div>

<button className="bg-botkorp-orange hover:bg-botkorp-orange-dark">
  Orange Button
</button>

<div className="border-botkorp-slate-blue">
  Slate Blue Border
</div>
```

### Option 3: Use Theme Configuration
```jsx
import { themeClasses } from '@/theme';

<button className={themeClasses.button.accent}>
  Themed Button
</button>

<div className={themeClasses.gradient.sidebar}>
  Gradient Background
</div>
```

## Dark Mode

### How It Works
- Uses the existing `ThemeProvider` from `src/components/theme-provider.jsx`
- Toggle between light/dark/system modes
- CSS variables automatically switch based on the `.dark` class on the root element

### Color Behavior
**Light Mode:**
- Background: White
- Foreground: Matte Black (#121212)
- Primary: Matte Black
- Accent: Bright Tangerine

**Dark Mode:**
- Background: Matte Black (#121212)
- Foreground: White
- Primary: Bright Tangerine (#FF6B35)
- Accent: Bright Tangerine

### Toggle Dark Mode
Users can toggle dark mode from:
1. User dropdown menu in portal
2. System preference detection (default)

## Visual Effects

### Shadows & Glows
Updated glow effects to use tangerine orange:
- `shadow-glow` - Standard orange glow
- `shadow-glow-lg` - Large orange glow
- `shadow-glow-orange` - Named orange glow

### Gradients
New gradient utilities:
- `brand-gradient` - Primary to secondary blend
- `bg-gradient-to-b from-botkorp-black to-botkorp-slate-blue` - Sidebar gradient
- `bg-gradient-to-r from-botkorp-orange to-botkorp-orange-dark` - Active nav items

## Key Components Updated

### Portal Layout
- Sidebar: Black to slate-blue gradient background
- Active nav items: Orange gradient
- Bot icon: Orange accent with glow
- Location selector: Orange/slate-blue gradient

### Landing Page
- Hero section: Uses matte black and tangerine accents
- Feature cards: Tangerine primary, slate-blue secondary
- "How It Works" section: Dark background with orange accents
- Footer: Black to slate-blue gradient

## Remaining Hardcoded Colors

Some components still use standard Tailwind colors (e.g., `blue-500`, `green-400`) for:
- Semantic states (success/error/warning)
- Service type badges (color-coded by type)
- Information highlights

These can be updated on a case-by-case basis if needed, but they serve specific semantic purposes.

## CSS Variables Reference

### Light Mode (:root)
```css
--primary: 0 0% 7%           /* Matte black */
--secondary: 214 20% 38%     /* Slate blue-gray */
--accent: 17 100% 60%        /* Bright tangerine */
--ring: 17 100% 60%          /* Tangerine focus ring */
```

### Dark Mode (.dark)
```css
--primary: 17 100% 60%       /* Bright tangerine */
--secondary: 214 20% 38%     /* Slate blue-gray */
--accent: 17 100% 60%        /* Bright tangerine */
--background: 0 0% 7%        /* Matte black */
```

## Testing Checklist

✅ Theme configuration loaded correctly
✅ Light mode colors applied
✅ Dark mode colors applied
✅ Portal layout displays new colors
✅ Landing page displays new colors
✅ Navigation uses orange accents
✅ Buttons use new color scheme
✅ Cards and borders updated
✅ Focus states show tangerine ring
✅ Gradients render correctly
✅ No linter errors

## Browser Compatibility

The theme uses:
- CSS Custom Properties (CSS Variables) - Supported in all modern browsers
- HSL color format - Universal support
- CSS `backdrop-filter` - Supported with prefixes (included in PostCSS)
- Dark mode class toggle - Full support

## Performance

No performance impact:
- CSS variables are parsed once by the browser
- No JavaScript calculations for colors
- Efficient color switching via class toggle
- Minimal CSS bundle size increase

## Future Enhancements

Consider these optional improvements:
1. Add more color variations (e.g., light/dark variants)
2. Create themed component library
3. Add color accessibility checker
4. Support custom user themes
5. Add theme preview/switcher in settings

## Support

For questions or issues with the theme:
1. Check `src/theme.js` for available utilities
2. Reference `src/colours.txt` for color codes
3. Review `src/index.css` for CSS variable definitions
4. Test in both light and dark modes

---

**Theme Update Completed**: October 17, 2025
**Color Palette**: Modern Tech (Matte Black + Bright Tangerine)
**Status**: ✅ Production Ready

