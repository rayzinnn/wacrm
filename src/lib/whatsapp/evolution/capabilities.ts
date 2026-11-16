export type EvolutionMediaKind = 'image' | 'document' | 'audio' | 'video'

/**
 * Milestone capabilities, not the completed C5 transport contract.
 * Text/media stay disabled until their delivery recuts are implemented.
 * The remaining flags describe Meta-only CRM actions kept disabled during
 * the Evolution migration; they may be removed when those consumers change.
 */
export interface EvolutionCapabilities {
  text: boolean
  media: EvolutionMediaKind[]
  templates: boolean
  broadcasts: boolean
  reactions: boolean
  interactive: boolean
  typing: boolean
}

export function getEvolutionCapabilities(): EvolutionCapabilities {
  return {
    text: false,
    media: [],
    templates: false,
    broadcasts: false,
    reactions: false,
    interactive: false,
    typing: false,
  }
}
