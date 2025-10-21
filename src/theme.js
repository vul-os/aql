/**
 * Bot Korp Modern Tech Theme Configuration
 * 
 * Centralized theme configuration for consistent color usage across the application.
 * Use these exports in components for better maintainability.
 */

export const colors = {
  // Primary Colors
  black: {
    DEFAULT: '#121212',  // Matte black - primary brand color
    light: '#1a1a1a',     // Slightly lighter for cards/elevation
    soft: '#2a2a2a'       // Even lighter for subtle contrast
  },
  
  // Accent Colors
  orange: {
    DEFAULT: '#FF6B35',   // Bright tangerine - main accent
    dark: '#E85A2A',      // Darker for hover states
    light: '#FF8A5C'      // Lighter for highlights
  },
  
  // Supporting Colors
  slateBlue: {
    DEFAULT: '#4F5D75',   // Slate blue-gray - secondary
    light: '#6B7A94'      // Lighter variant
  },
  
  silver: {
    DEFAULT: '#B0B3B8',   // Cool silver - neutral supporting
    light: '#D0D2D5'      // Lighter for borders/dividers
  }
};

/**
 * Semantic color mappings for different UI states
 */
export const semanticColors = {
  // Light mode
  light: {
    primary: colors.black.DEFAULT,
    primaryHover: colors.black.light,
    accent: colors.orange.DEFAULT,
    accentHover: colors.orange.dark,
    secondary: colors.slateBlue.DEFAULT,
    neutral: colors.silver.DEFAULT,
    background: '#FFFFFF',
    foreground: colors.black.DEFAULT,
  },
  
  // Dark mode
  dark: {
    primary: colors.orange.DEFAULT,
    primaryHover: colors.orange.dark,
    accent: colors.orange.DEFAULT,
    accentHover: colors.orange.light,
    secondary: colors.slateBlue.DEFAULT,
    neutral: colors.silver.DEFAULT,
    background: colors.black.DEFAULT,
    foreground: '#FFFFFF',
  }
};

/**
 * Tailwind CSS class name helpers
 * Use these for consistent styling across components
 */
export const themeClasses = {
  // Buttons
  button: {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
    accent: 'bg-accent text-accent-foreground hover:bg-accent/90',
  },
  
  // Backgrounds
  bg: {
    primary: 'bg-botkorp-black',
    primaryLight: 'bg-botkorp-black-light',
    accent: 'bg-botkorp-orange',
    secondary: 'bg-botkorp-slate-blue',
    neutral: 'bg-botkorp-silver',
  },
  
  // Text
  text: {
    primary: 'text-primary',
    accent: 'text-botkorp-orange',
    secondary: 'text-botkorp-slate-blue',
    muted: 'text-botkorp-silver',
  },
  
  // Borders
  border: {
    accent: 'border-botkorp-orange',
    secondary: 'border-botkorp-slate-blue',
    neutral: 'border-botkorp-silver',
  },
  
  // Gradients
  gradient: {
    primary: 'bg-gradient-to-r from-primary to-primary/90',
    accent: 'bg-gradient-to-r from-botkorp-orange to-botkorp-orange-dark',
    dark: 'bg-gradient-to-b from-botkorp-black to-botkorp-slate-blue',
    sidebar: 'bg-gradient-to-b from-botkorp-black to-botkorp-slate-blue',
  },
  
  // Shadows/Glows
  shadow: {
    orange: 'shadow-glow-orange',
    accent: 'shadow-glow',
  }
};

/**
 * Usage Examples:
 * 
 * // In JSX:
 * <button className={themeClasses.button.accent}>Click Me</button>
 * <div className={themeClasses.gradient.dark}>Dark Section</div>
 * 
 * // Or use CSS variables directly:
 * <div className="bg-primary text-primary-foreground">
 *   Uses CSS variables that automatically adjust for light/dark mode
 * </div>
 * 
 * // For custom components:
 * <div style={{ backgroundColor: colors.orange.DEFAULT }}>
 *   Direct color usage
 * </div>
 */

export default {
  colors,
  semanticColors,
  themeClasses
};

