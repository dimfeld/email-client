import { describe, expect, it } from 'bun:test';
import { queueGmailAccountWork } from './gmail-account-queue';

describe('Gmail account queue', () => {
  it('runs account work in order after a failed task', async () => {
    const events: string[] = [];
    let finishFirst: () => void = () => undefined;
    const first = queueGmailAccountWork('One@Example.com', async () => {
      events.push('first start');
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      events.push('first end');
      throw new Error('First failed');
    });
    const second = queueGmailAccountWork('one@example.com', async () => {
      events.push('second start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first start']);
    finishFirst();
    await expect(first).rejects.toThrow('First failed');
    await second;
    expect(events).toEqual(['first start', 'first end', 'second start']);
  });
});
