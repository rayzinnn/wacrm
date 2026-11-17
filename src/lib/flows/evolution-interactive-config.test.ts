import { describe, expect, it } from 'vitest';
import { buildEvolutionInteractiveMessage } from './evolution-interactive-config';

const recipient = '15551234567@s.whatsapp.net';

describe('Evolution Flow interactive payload mapping', () => {
  it('interpolates visible button text while preserving routing IDs', () => {
    expect(buildEvolutionInteractiveMessage('send_buttons', {
      text: 'Olá {{vars.name}}', header_text: 'Escolha',
      buttons: [{ reply_id: 'route_{{vars.name}}', title: 'Sim {{vars.short}}' }],
    }, { name: 'Ana', short: 'A' }, recipient, 'step-1')).toEqual({
      kind: 'buttons', recipient, requestId: 'step-1', title: 'Escolha',
      description: 'Olá Ana', buttons: [{ id: 'route_{{vars.name}}', displayText: 'Sim A' }],
    });
  });

  it('maps list rows and supplies required provider fields', () => {
    expect(buildEvolutionInteractiveMessage('send_list', {
      text: 'Escolha {{vars.subject}}', button_label: 'Abrir',
      sections: [{ rows: [{ reply_id: 'one', title: 'Primeira' }] }],
    }, { subject: 'uma opção' }, recipient, 'step-2')).toEqual({
      kind: 'list', recipient, requestId: 'step-2', title: 'Opções',
      description: 'Escolha uma opção', footerText: '', buttonText: 'Abrir',
      sections: [{ title: 'Opções', rows: [{ rowId: 'one', title: 'Primeira' }] }],
    });
  });

  it('rejects duplicate IDs and labels made too long by variables', () => {
    expect(() => buildEvolutionInteractiveMessage('send_buttons', {
      text: 'Choose', buttons: [
        { reply_id: 'same', title: 'A' }, { reply_id: 'same', title: 'B' },
      ],
    }, {}, recipient, 'step')).toThrow();
    expect(() => buildEvolutionInteractiveMessage('send_buttons', {
      text: 'Choose', buttons: [{ reply_id: 'one', title: '{{vars.long}}' }],
    }, { long: 'x'.repeat(21) }, recipient, 'step')).toThrow();
  });
});
