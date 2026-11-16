export type EvolutionMediaKind = 'image' | 'document' | 'audio' | 'video'

/**
 * Milestone capabilities for the Evolution transport.
 * Text is enabled after T09 activation plus T03/T10 verification; media
 * and Meta-only actions remain disabled until their own delivery recuts.
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
    text: true,
    media: [],
    templates: false,
    broadcasts: false,
    reactions: false,
    interactive: false,
    typing: false,
  }
}
