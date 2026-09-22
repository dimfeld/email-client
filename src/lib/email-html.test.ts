import { describe, expect, it } from 'bun:test';
import { buildEmailDocument, hasRemoteImages } from './email-html';

describe('email HTML documents', () => {
  it('keeps email head styles after the compatibility and security rules', () => {
    const document = buildEmailDocument(
      '<html><head><style>.message{color:red}</style></head><body class="message">Hello</body></html>',
      false
    );

    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(
      document.indexOf('.message{color:red}')
    );
    expect(document).toContain('img-src data:');
    expect(document).not.toContain('img-src data: https:');
  });

  it('wraps fragments and permits remote images only after approval', () => {
    const document = buildEmailDocument('<p>Hello</p>', true);

    expect(document).toStartWith('<!doctype html>');
    expect(document).toContain('img-src data: https: http:');
    expect(document).toContain('<body><p>Hello</p></body>');
  });

  it('detects remote image sources and CSS background images', () => {
    expect(hasRemoteImages('<img src="https://example.com/image.png">')).toBe(true);
    expect(hasRemoteImages('<div style="background:url(http://example.com/image.png)">')).toBe(
      true
    );
    expect(hasRemoteImages('<img src="data:image/png;base64,abc">')).toBe(false);
  });
});
