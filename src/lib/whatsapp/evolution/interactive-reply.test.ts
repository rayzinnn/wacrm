import { describe, expect, it } from 'vitest';
import { readEvolutionInteractiveReply } from './interactive-reply';

describe('Baileys interactive reply selection', () => {
  it.each([
    ['buttonsResponseMessage', { buttonsResponseMessage: { selectedButtonId: 'new', selectedDisplayText: 'New customer' } }, 'button', 'new', 'New customer'],
    ['templateButtonReplyMessage', { templateButtonReplyMessage: { selectedId: 'existing', selectedDisplayText: 'Existing customer' } }, 'button', 'existing', 'Existing customer'],
    ['listResponseMessage', { listResponseMessage: { singleSelectReply: { selectedRowId: 'hours' }, title: 'Opening hours' } }, 'list', 'hours', 'Opening hours'],
  ] as const)('reads %s using its explicit selection ID', (type, message, kind, replyId, label) => {
    expect(readEvolutionInteractiveReply(type, message)).toEqual({ kind, replyId, label });
  });

  it('rejects free text and malformed or unbounded IDs', () => {
    expect(readEvolutionInteractiveReply('conversation', { conversation: 'new' })).toBeNull();
    expect(readEvolutionInteractiveReply('buttonsResponseMessage', { buttonsResponseMessage: { selectedDisplayText: 'New' } })).toBeNull();
    expect(readEvolutionInteractiveReply('listResponseMessage', { listResponseMessage: { singleSelectReply: { selectedRowId: 'bad\nrow' } } })).toBeNull();
    expect(readEvolutionInteractiveReply('buttonsResponseMessage', { buttonsResponseMessage: { selectedButtonId: 'x'.repeat(201) } })).toBeNull();
  });
});
