import { validateProviderInteractive, type ProviderInteractive } from '@/lib/whatsapp/evolution/interactive-client';

type Config = Record<string, unknown>;

function object(value: unknown): Config | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Config : null;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid ${field}`);
  return value;
}

function optional(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return string(value, field);
}

function render(value: string, vars: unknown): string {
  const output = value.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const source = object(vars);
    if (!source) throw new Error('Flow variables are invalid');
    const item = source[key];
    return item === undefined || item === null ? '' : String(item);
  });
  if (output.trim() === '') throw new Error('Rendered Flow text is empty');
  return output;
}

/** Builds the exact provider payload. Selection IDs stay byte-for-byte as authored. */
export function buildEvolutionInteractiveMessage(
  nodeType: 'send_buttons' | 'send_list',
  config: Config,
  vars: unknown,
  recipient: string,
  requestId: string,
): ProviderInteractive {
  const body = render(string(config.text, 'text'), vars);
  const header = optional(config.header_text, 'header_text');
  const footer = optional(config.footer_text, 'footer_text');
  let result: ProviderInteractive;
  if (nodeType === 'send_buttons') {
    if (!Array.isArray(config.buttons)) throw new Error('Invalid buttons');
    result = {
      kind: 'buttons', recipient, requestId,
      title: header ? render(header, vars) : body,
      ...(header ? { description: body } : {}),
      ...(footer ? { footer: render(footer, vars) } : {}),
      buttons: config.buttons.map((entry: unknown) => {
        const button = object(entry);
        if (!button) throw new Error('Invalid button');
        return {
          id: string(button.reply_id, 'reply_id'),
          displayText: render(string(button.title, 'title'), vars),
        };
      }),
    };
  } else {
    if (!Array.isArray(config.sections)) throw new Error('Invalid sections');
    result = {
      kind: 'list', recipient, requestId,
      title: header ? render(header, vars) : 'Opções',
      description: body,
      footerText: footer ? render(footer, vars) : '',
      buttonText: render(string(config.button_label, 'button_label'), vars),
      sections: config.sections.map((entry: unknown) => {
        const section = object(entry);
        if (!section || !Array.isArray(section.rows)) throw new Error('Invalid section');
        const sectionTitle = optional(section.title, 'section.title');
        return {
          title: sectionTitle ? render(sectionTitle, vars) : 'Opções',
          rows: section.rows.map((item: unknown) => {
            const row = object(item);
            if (!row) throw new Error('Invalid row');
            const description = optional(row.description, 'row.description');
            return {
              rowId: string(row.reply_id, 'reply_id'),
              title: render(string(row.title, 'title'), vars),
              ...(description ? { description: render(description, vars) } : {}),
            };
          }),
        };
      }),
    };
  }
  validateProviderInteractive(result);
  return result;
}
