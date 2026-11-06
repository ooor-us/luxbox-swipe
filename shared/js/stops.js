// The four fixed stops of round 14 (PLAN.md), with each stop's UI tint from its round-13 tint proposal.
// Tint values were read from the 13.x hero screens in Figma (5dXkG6JZr5RLjfEyX2AilR: 1278:1164, 1278:2739,
// 1278:4314, 1278:9039) and cross-checked with box-refresh/themes/<theme>/fill-data.js and NOTES.md.
// bgLum: median relative luminance of the round-13 hero background (themes/<theme>/hero-bg.png) under each
// UI text region; ui.js uses it to pick the ink with the better contrast in a polarity-changing transition.
// Prototypes with a different backdrop should pass their own measured bgLum (ui.setBackgroundLuminance).

export const STOPS = [
  { index: 0, key: 'obsidian', name: 'Obsidian Box', tierName: 'Obsidian', finish: 'leather', tierHex: '#1A1A1C',
    theme: 'ivory-morning', themeName: 'Ivory Morning', figma: '1278:1156', ui: 'ivory', polarity: 'dark-on-light' },
  { index: 1, key: 'sapphire', name: 'Sapphire Box', tierName: 'Sapphire', finish: 'leather', tierHex: '#1C2A47',
    theme: 'reeded-glass', themeName: 'Reeded Glass', figma: '1278:2731', ui: 'reeded', polarity: 'dark-on-light' },
  { index: 2, key: 'emerald', name: 'Emerald Box', tierName: 'Emerald', finish: 'lacquer', tierHex: '#1E3B31',
    theme: 'riviera-caustics', themeName: 'Riviera Caustics', figma: '1278:4306', ui: 'riviera', polarity: 'light-on-dark' },
  { index: 3, key: 'amethyst', name: 'Amethyst Box', tierName: 'Amethyst', finish: 'leather', tierHex: '#3B2A42',
    theme: 'desert-dawn', themeName: 'Desert Dawn', figma: '1278:9031', ui: 'desert', polarity: 'light-on-dark' },
];

/** Label under the box name (the template's tier slot). Prototypes may replace this. */
export const tierLabel = (s) => `${s.tierName} · ${s.finish}`;

const glassBlue = { glassTop: '#FFFFFF', glassBottom: '#A4CEE9', glassOpacity: 0.06, glassShade: '#003355', glassShadeOpacity: 0.2, glassStroke: 0.16 };

// Every colour key is interpolated by ui.js; *Opacity keys are numbers.
export const TINTS = {
  // 13.2 Ivory Morning: dark ink on light (Diana proposal, fill-data.js tint)
  ivory: {
    polarity: 'dark', primary: '#1E1710', secondary: '#2A2017', secondaryOpacity: 1, recentOpacity: 1, tierOpacity: 1, figure: '#483008',
    glassTop: '#FFFFFF', glassBottom: '#F3E6D2', glassOpacity: 0.5, glassShade: '#FFFFFF', glassShadeOpacity: 0.14, glassStroke: 0.16,
    recentGlassTop: '#FFFFFF', recentGlassBottom: '#A4CEE9', recentGlassOpacity: 0.06, recentGlassShade: '#003355', recentGlassShadeOpacity: 0.2,
    strip: '#F3EADB', stripOpacity: 1, card: '#F3EADB', cardOpacity: 0.92, cardStroke: '#FFFFFF', cardStrokeOpacity: 1, cardShadow: '#5A3D0E', cardShadowOpacity: 0.14,
    viewAllA: '#F3E6D2', viewAllB: '#C9A25A', viewAllInk: '#1E1710', plusA: '#C9A25A', plusB: '#C9A25A', plusInk: '#0E0E15',
    homeIndicator: '#1E1710', nameShadow: '#FFFFFF', nameShadowOpacity: 0.35, nameShadowBlur: 6, swipe: 'ivory',
    bgLum: { header: 0.443, recent: 0.465, name: 0.346, cards: 0.768, values: 0.296, swipe: 0.3 },
  },
  // 13.3 Reeded Glass: dark ink on light (cool)
  reeded: {
    polarity: 'dark', primary: '#101827', secondary: '#26303F', secondaryOpacity: 1, recentOpacity: 1, tierOpacity: 1, figure: '#101827',
    glassTop: '#FFFFFF', glassBottom: '#EAF0F6', glassOpacity: 0.6, glassShade: '#1C2A47', glassShadeOpacity: 0.06, glassStroke: 0.4,
    recentGlassTop: '#FFFFFF', recentGlassBottom: '#A4CEE9', recentGlassOpacity: 0.06, recentGlassShade: '#003355', recentGlassShadeOpacity: 0.2,
    strip: '#EEF2F6', stripOpacity: 0.9, card: '#EEF2F6', cardOpacity: 0.92, cardStroke: '#FFFFFF', cardStrokeOpacity: 1, cardShadow: '#1C2A47', cardShadowOpacity: 0.1,
    viewAllA: '#FFFFFF', viewAllB: '#E6ECF2', viewAllInk: '#101827', plusA: '#A4CEE9', plusB: '#A4CEE9', plusInk: '#0E0E15',
    homeIndicator: '#101827', nameShadow: '#FFFFFF', nameShadowOpacity: 0, nameShadowBlur: 6, swipe: 'reeded',
    bgLum: { header: 0.594, recent: 0.587, name: 0.41, cards: 0.378, values: 0.38, swipe: 0.6 },
  },
  // 13.4 Riviera Caustics: light ink on mid/dark
  riviera: {
    polarity: 'light', primary: '#FFFFFF', secondary: '#FFFFFF', secondaryOpacity: 1, recentOpacity: 1, tierOpacity: 1, figure: '#FFF1CF',
    glassTop: '#FFFFFF', glassBottom: '#EBD9BD', glassOpacity: 0.08, glassShade: '#2E261E', glassShadeOpacity: 0.45, glassStroke: 0.16,
    recentGlassTop: '#FFFFFF', recentGlassBottom: '#EBD9BD', recentGlassOpacity: 0.06, recentGlassShade: '#2E261E', recentGlassShadeOpacity: 0.2,
    strip: '#2E261E', stripOpacity: 0, card: '#2E261E', cardOpacity: 0.35, cardStroke: '#FFFFFF', cardStrokeOpacity: 0.16, cardShadow: '#000000', cardShadowOpacity: 0,
    viewAllA: '#4A3A28', viewAllB: '#4A3A28', viewAllInk: '#FFFFFF', plusA: '#C9A25A', plusB: '#C9A25A', plusInk: '#0E0E15',
    homeIndicator: '#FFFFFF', nameShadow: '#C9A25A', nameShadowOpacity: 0.25, nameShadowBlur: 28, swipe: 'riviera',
    bgLum: { header: 0.093, recent: 0.097, name: 0.194, cards: 0.125, values: 0.072, swipe: 0.05 },
  },
  // 13.7 Desert Dawn: light ink on mid/dark
  desert: {
    polarity: 'light', primary: '#FFFFFF', secondary: '#FFFFFF', secondaryOpacity: 1, recentOpacity: 1, tierOpacity: 1, figure: '#FFFFFF',
    glassTop: '#FFFFFF', glassBottom: '#EBCDB8', glassOpacity: 0.06, glassShade: '#1C1E33', glassShadeOpacity: 0.66, glassStroke: 0.16,
    recentGlassTop: '#FFFFFF', recentGlassBottom: '#A4CEE9', recentGlassOpacity: 0.06, recentGlassShade: '#003355', recentGlassShadeOpacity: 0.2,
    strip: '#1C1E33', stripOpacity: 0, card: '#1C1E33', cardOpacity: 0.45, cardStroke: '#FFFFFF', cardStrokeOpacity: 0.16, cardShadow: '#000000', cardShadowOpacity: 0,
    viewAllA: '#F4C9AA', viewAllB: '#C98E86', viewAllInk: '#2A1A2A', plusA: '#F6CFB2', plusB: '#D59A8C', plusInk: '#2A1A2A',
    homeIndicator: '#FFFFFF', nameShadow: '#668CF2', nameShadowOpacity: 0.25, nameShadowBlur: 28, swipe: 'desert',
    bgLum: { header: 0.037, recent: 0.073, name: 0.168, cards: 0.147, values: 0.12, swipe: 0.05 },
  },
  // Today's app (Dima's template "Noble velvet — 3D studio", 1270:1519): white ink, 40 % secondary, blue glass.
  // Used by baseline/ for every stop: today's home is always a dark page.
  today: {
    polarity: 'light', primary: '#FFFFFF', secondary: '#FFFFFF', secondaryOpacity: 0.4, recentOpacity: 0.5, tierOpacity: 0.5, figure: '#FFF7BC',
    ...glassBlue,
    recentGlassTop: '#FFFFFF', recentGlassBottom: '#A4CEE9', recentGlassOpacity: 0.06, recentGlassShade: '#003355', recentGlassShadeOpacity: 0.2,
    strip: '#003355', stripOpacity: 0, card: '#003355', cardOpacity: 0.2, cardStroke: '#FFFFFF', cardStrokeOpacity: 0.16, cardShadow: '#000000', cardShadowOpacity: 0,
    viewAllA: '#A3CEE9', viewAllB: '#2997B5', viewAllInk: '#FFFFFF', plusA: '#A4CEE9', plusB: '#A4CEE9', plusInk: '#0E0E15',
    homeIndicator: '#FFFFFF', nameShadow: '#FFFFFF', nameShadowOpacity: 0, nameShadowBlur: 6, swipe: 'today',
    bgLum: { header: 0.004, recent: 0.004, name: 0.01, cards: 0.004, values: 0.004, swipe: 0.004 },
  },
};
