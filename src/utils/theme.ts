/**
 * Moth color theme — inverted from Claude Code's dark theme.
 * Claude Code: dark bg, light text, orange/tan accents
 * Moth: warm light bg, dark text, purple/coral accents
 */

export const theme = {
  // Core colors
  bg: '#FDF6E3',           // warm cream background
  text: '#2D1B69',         // deep purple text
  textMuted: '#6B7280',    // gray secondary text
  textDim: '#9CA3AF',      // dim gray for hints

  // Accents
  purple: '#7C3AED',       // vivid purple — prompts, highlights, brand
  purpleLight: '#A78BFA',  // lighter purple — borders, secondary
  coral: '#F97066',        // coral — warnings, important actions
  coralLight: '#FECACA',   // light coral — warning backgrounds

  // Semantic
  success: '#059669',      // emerald green
  error: '#DC2626',        // red
  warning: '#D97706',      // amber
  info: '#7C3AED',         // purple (brand-aligned)

  // UI elements
  border: '#DDD6C1',       // warm gray borders
  inputBg: '#F5EDDA',      // slightly darker cream for input areas
  selection: '#EDE9FE',    // very light purple selection highlight
  userInput: '#1E1B4B',    // indigo-black for user-typed text

  // Status
  streaming: '#7C3AED',    // purple pulse while streaming
  thinking: '#A78BFA',     // lighter purple while thinking
  toolRunning: '#D97706',  // amber while running tools
  toolSuccess: '#059669',  // green when tool completes
  toolError: '#DC2626',    // red when tool fails
} as const;

export type Theme = typeof theme;

/**
 * Terminal-safe color mappings for 256-color terminals.
 * Falls back automatically via chalk's color detection.
 */
export const theme256 = {
  bg: 230,          // lightyellow
  text: 55,         // dark purple
  purple: 135,      // medium purple
  coral: 203,       // salmon
  success: 35,      // green
  error: 160,       // red
  warning: 172,     // orange
  border: 250,      // light gray
  muted: 245,       // gray
} as const;
