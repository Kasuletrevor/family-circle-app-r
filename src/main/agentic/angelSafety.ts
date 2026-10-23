import type { AngelEscalationGroup } from '../../shared/agenticChat'

// Fixed phrases, checked before the model runs: a 0.8B model cannot be trusted to notice danger.
const PATTERNS: Record<AngelEscalationGroup, RegExp[]> = {
  'self-harm': [
    /\b(?:kill|hurt|harm) (?:my ?self)\b/i,
    /\bend (?:my|my own) life\b/i,
    /\bend it all\b/i,
    /\bsuicid/i,
    /\b(?:want|wish) (?:to|I could) (?:die|be dead|not wake up)\b/i,
    /\bjoin (?:him|her|them) (?:soon|in heaven)\b/i,
  ],
  'medical-emergency': [
    /\bchest pains?\b/i,
    /\b(?:can't|cannot|can not) breathe\b/i,
    /\btrouble breathing\b/i,
    /\bi(?:'ve| have) fallen\b/i,
    /\bi fell (?:down|over|in|on|and)\b/i,
    /\bhad a fall\b/i,
    /\b(?:having|had) a stroke\b/i,
    /\bunconscious\b/i,
    /\bbleeding (?:badly|a lot|won't stop)\b/i,
  ],
  abuse: [
    /\b(?:hits|hit|beats|beat|hurts|slaps|kicks) me\b/i,
    /\bsomeone (?:is )?(?:hurting|abusing) me\b/i,
    /\babus(?:e|ed|es|ing)\b/i,
    /\btakes? my money\b/i,
    /\bscared of (?:my )?(?:carer|son|daughter|husband|wife|nurse)\b/i,
  ],
  confusion: [
    /\b(?:don't|do not) know where I am\b/i,
    /\bwhere am I\b/i,
    /\b(?:don't|do not) recogni[sz]e (?:anyone|my|this|where)\b/i,
    /\bwhat year is it\b/i,
  ],
  distress: [
    /\bhopeless\b/i,
    /\bpanic(?:king)?\b/i,
    /\bcan't (?:go on|cope)\b/i,
    /\bso (?:scared|frightened)\b/i,
  ],
  privacy: [
    /\b(?:asked|wants?) (?:for )?my (?:bank|card|pin|password)/i,
    /\bpassword\b/i,
    /\bscam/i,
  ],
}

const ALWAYS: AngelEscalationGroup[] = ['self-harm', 'medical-emergency', 'abuse']

// Trigger keys from the templates, mapped to the groups they turn on.
const KEY_GROUPS: Record<string, AngelEscalationGroup> = {
  severe_confusion: 'confusion',
  confusion_about_family_members: 'confusion',
  confusion_or_distress: 'confusion',
  sudden_confusion: 'confusion',
  extreme_distress: 'distress',
  distress_about_family_absence: 'distress',
  distress_or_safety_concern: 'distress',
  severe_distress: 'distress',
  privacy_or_security_concern: 'privacy',
  account_access_problem: 'privacy',
}

export const ESCALATION_REPLIES: Record<AngelEscalationGroup, string> = {
  'self-harm': "I'm worried about what you just said, and I want you to be safe. Please talk to someone now: a family member, your carer, or emergency services if you are in danger.",
  'medical-emergency': 'This sounds like it could be urgent. Please get help now: call emergency services, or ask someone near you to call for you.',
  abuse: 'Thank you for telling me. No one should treat you that way. Please tell someone you trust today, such as a family member or your doctor, or call emergency services if you are in danger.',
  confusion: "It's all right to feel unsure. Please let a family member or your carer know how you are feeling, so they can be with you.",
  distress: "I'm sorry this feels so hard right now. Please reach out to a family member or your carer, so you're not alone with it.",
  privacy: 'Please never share passwords, PINs or bank details with anyone who asks. Check with a family member you trust before you do anything.',
}

/** The first safety group the message matches, or null. */
export function escalationFor(message: string, escalationKeys: string[]): AngelEscalationGroup | null {
  const groups = new Set<AngelEscalationGroup>(ALWAYS)
  for (const key of escalationKeys) {
    const group = KEY_GROUPS[key]
    if (group) groups.add(group)
  }
  for (const group of groups) {
    if (PATTERNS[group].some((pattern) => pattern.test(message))) return group
  }
  return null
}
