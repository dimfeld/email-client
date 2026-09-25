import { describe, expect, it } from 'bun:test';
import { splitQuotedReply } from './quoted-reply';

describe('quoted reply separation', () => {
  it('keeps a message without a quoted reply as the latest email', () => {
    expect(splitQuotedReply('Please send the report by Friday.')).toEqual({
      latest: 'Please send the report by Friday.',
      quotedContext: '',
    });
  });

  it('separates a Gmail reply and all earlier quoted messages', () => {
    expect(
      splitQuotedReply(
        'I sent it today.\n\nOn Tue, Sep 22, Alex <alex@example.com> wrote:\n> Please send it by Friday.\n> On Monday, Casey wrote:\n> > Earlier request.'
      )
    ).toEqual({
      latest: 'I sent it today.',
      quotedContext:
        'On Tue, Sep 22, Alex <alex@example.com> wrote:\n> Please send it by Friday.\n> On Monday, Casey wrote:\n> > Earlier request.',
    });
  });

  it('separates a wrapped reply heading', () => {
    expect(
      splitQuotedReply(
        'Done.\n\nOn Tuesday, September 22, Alex <alex@example.com>\nwrote:\n> Please send it.'
      )
    ).toEqual({
      latest: 'Done.',
      quotedContext: 'On Tuesday, September 22, Alex <alex@example.com>\nwrote:\n> Please send it.',
    });
  });

  it('separates an Outlook reply header', () => {
    expect(
      splitQuotedReply(
        'Approved.\n\nFrom: Alex <alex@example.com>\nSent: Tuesday, September 22\nTo: Casey\nSubject: Plan\nPlease approve.'
      )
    ).toEqual({
      latest: 'Approved.',
      quotedContext:
        'From: Alex <alex@example.com>\nSent: Tuesday, September 22\nTo: Casey\nSubject: Plan\nPlease approve.',
    });
  });

  it('separates a plain quoted line without a reply header', () => {
    expect(splitQuotedReply('Done.\n\n> Please do this.')).toEqual({
      latest: 'Done.',
      quotedContext: '> Please do this.',
    });
  });
});
