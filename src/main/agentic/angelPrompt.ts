import { MAX_ANGEL_MESSAGE, type AngelChatMessage, type ChatTurn, type StorySection } from '../../shared/agenticChat'
import type { AngelRecipe } from './angelRecipe'

export const PROFILE_TOOL = 'get_elder_profile'
export const STORY_TOOL = 'get_family_content'
export const HISTORY_TOOL = 'get_recent_interactions'
export const DRAFT_TOOLS: ReadonlySet<string> = new Set(['draft_email', 'send_email', 'send_family_notification'])

const MAX_STORIES = 3
const MAX_STORY_CHARS = 900
const MAX_HISTORY_MESSAGES = 6
const MAX_HISTORY_CHARS = 1800

// Short and concrete: the local 0.8B model follows a few direct rules far better than long guidance.
const FAMILY_CIRCLE_RULES = [
  'You are a Guardian Angel inside Family Circle, a private family app. You run on this computer.',
  'Always follow these rules first, before anything else below:',
  '- Reply in two to four short, warm sentences. No Markdown.',
  '- Answer what the person said or asked first.',
  '- When family memories are given and they fit the message, use their details in your answer; never invent family details, names or events that are not in them.',
  '- Never give medical, legal or money advice. Suggest asking a family member or a professional instead.',
  '- You cannot send messages. If asked to write one, write the short message itself, then say they can copy it and send it themselves.',
  '- If the person seems unsafe, unwell or very upset, gently ask them to contact a family member or their carer.',
].join('\n')

// Instruction sections about tools, sending and escalation describe the website's agent.
// Family Circle does that work itself, and they only distract the small local model.
const HANDLED_SECTION = /^#{1,6} .*(tool|e-?mail|send|escalat)/i

function withoutHandledSections(instructions: string): string {
  return instructions
    .split(/\n(?=#{1,6} )/)
    .filter((section) => !HANDLED_SECTION.test(section.trim()))
    .join('\n')
    .trim()
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd()
}

/** One chat request that fits the local model's 4,096-token window. The model never calls tools. */
export function buildAngelPrompt(input: {
  recipe: AngelRecipe
  firstName: string | null
  stories: StorySection[]
  history: AngelChatMessage[]
  message: string
}): ChatTurn[] {
  const tools = new Set(input.recipe.tools)
  const system = [
    FAMILY_CIRCLE_RULES,
    input.recipe.trustBoundaries.length ? `Safety rules for this angel: ${input.recipe.trustBoundaries.join('; ')}.` : '',
    tools.has(PROFILE_TOOL) && input.firstName ? `You are talking with ${input.firstName}.` : '',
    [...DRAFT_TOOLS].some((tool) => tools.has(tool)) ? 'You may write drafts of messages for the person to send themselves.' : '',
    `Your name is ${input.recipe.name}. Your instructions from the angel's settings:`,
    withoutHandledSections(input.recipe.instructions) || 'Be a warm, patient companion.',
  ].filter(Boolean).join('\n\n')

  const turns: ChatTurn[] = [{ role: 'system', content: system }]

  if (tools.has(HISTORY_TOOL)) {
    // Newest messages first, until the history budget runs out.
    let used = 0
    const kept: ChatTurn[] = []
    for (const item of input.history.slice(-MAX_HISTORY_MESSAGES).reverse()) {
      const room = MAX_HISTORY_CHARS - used
      if (room <= 0) break
      const content = cut(item.text, room)
      used += content.length
      kept.unshift({ role: item.role === 'person' ? 'user' : 'assistant', content })
    }
    turns.push(...kept)
  }

  const memories = tools.has(STORY_TOOL)
    ? input.stories.slice(0, MAX_STORIES).map((story, index) => `[Memory ${index + 1}: ${story.label}]\n${cut(story.text, MAX_STORY_CHARS)}`)
    : []
  const message = cut(input.message.trim(), MAX_ANGEL_MESSAGE)
  turns.push({
    role: 'user',
    content: memories.length ? `Family memories you may use:\n${memories.join('\n\n')}\n\nMessage:\n${message}` : message,
  })
  return turns
}
