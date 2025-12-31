/**
 * Unified Theme System - Main Export
 * Single import for all design tokens and utilities
 *
 * Usage:
 * import { colors, spacing, radius, textStyles, shadows, duration } from '@/theme/unified';
 */

// Core design tokens
export * from './colors';
export * from './spacing';
export * from './radius';
export * from './typography';
export * from './shadows';
export * from './animations';

// Re-export commonly used items at top level for convenience
export { colors, semanticColors, gradients } from './colors';
export { spacing, layout, touchTargets, hitSlop } from './spacing';
export { radius, componentRadius } from './radius';
export { fontSize, fontWeight, textStyles, fontFamily } from './typography';
export { shadows, coloredShadows, blurIntensity } from './shadows';
export { duration, easing, animationPresets, springConfigs, opacity, zIndex } from './animations';

/**
 * Complete unified theme object
 * For passing to ThemeProvider or accessing all tokens at once
 */
export const unifiedTheme = {
  colors: require('./colors').colors,
  semanticColors: require('./colors').semanticColors,
  gradients: require('./colors').gradients,
  spacing: require('./spacing').spacing,
  layout: require('./spacing').layout,
  touchTargets: require('./spacing').touchTargets,
  hitSlop: require('./spacing').hitSlop,
  radius: require('./radius').radius,
  componentRadius: require('./radius').componentRadius,
  fontSize: require('./typography').fontSize,
  fontWeight: require('./typography').fontWeight,
  fontFamily: require('./typography').fontFamily,
  textStyles: require('./typography').textStyles,
  shadows: require('./shadows').shadows,
  coloredShadows: require('./shadows').coloredShadows,
  blurIntensity: require('./shadows').blurIntensity,
  duration: require('./animations').duration,
  easing: require('./animations').easing,
  animationPresets: require('./animations').animationPresets,
  springConfigs: require('./animations').springConfigs,
  opacity: require('./animations').opacity,
  zIndex: require('./animations').zIndex,
} as const;

export type UnifiedTheme = typeof unifiedTheme;
