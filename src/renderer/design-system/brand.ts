export const brandTokens = {
  navy: '#0C2348',
  ocean: '#0C557F',
  teal: '#0E9F9A',
  tealDark: '#0C6F70',
  gold: '#E6AD69',
  mint: '#E9FBF6',
  coolTint: '#EEF2F7',
  canvas: '#F7F9FB',
  card: '#FFFFFF',
} as const

export type BrandToken = keyof typeof brandTokens
