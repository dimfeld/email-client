import { describe, expect, it } from 'bun:test';
import { buildEmailDocument, hasDarkModeStyles, hasRemoteImages } from './email-html';

describe('email HTML documents', () => {
  it('keeps email head styles after the compatibility and security rules', () => {
    const document = buildEmailDocument(
      '<html><head><style>.message{color:red}</style></head><body class="message">Hello</body></html>',
      false,
      true
    );

    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(
      document.indexOf('.message{color:red}')
    );
    expect(document).toContain('img-src data:');
    expect(document).not.toContain('img-src data: https:');
  });

  it('wraps fragments and permits remote images only after approval', () => {
    const document = buildEmailDocument('<p>Hello</p>', true, true);

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

  it('inverts media again only for inverted emails', () => {
    expect(buildEmailDocument('<p>Hello</p>', false, true)).toContain('img,video,canvas');
    expect(buildEmailDocument('<p>Hello</p>', false, false)).not.toContain('img,video,canvas');
  });

  it('always applies dark color scheme queries', () => {
    const document = buildEmailDocument(
      '<style>@media screen and (prefers-color-scheme: dark){body{color:#fff}}</style><picture><source media="(prefers-color-scheme: light)" srcset="a.png"></picture>',
      false,
      false
    );

    expect(document).toContain('@media screen and (min-width: 0px){');
    expect(document).toContain('media="(max-width: 0px) and (min-width: 1px)"');
  });

  it('detects emails with their own dark mode styles', () => {
    expect(
      hasDarkModeStyles('<style>@media (prefers-color-scheme: dark){body{color:#fff}}</style>')
    ).toBe(true);
    expect(hasDarkModeStyles('<style>body{color:#000}</style>')).toBe(false);
    expect(hasDarkModeStyles('<source media="(prefers-color-scheme: dark)" srcset="a.png">')).toBe(
      false
    );
  });
});
