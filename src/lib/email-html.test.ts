import { describe, expect, it } from 'bun:test';
import {
  buildEmailDocument,
  emailColorMode,
  hasDarkModeStyles,
  hasRemoteImages,
} from './email-html';

describe('email HTML documents', () => {
  it('keeps email head styles after the compatibility and security rules', () => {
    const document = buildEmailDocument(
      '<html><head><style>.message{color:red}</style></head><body class="message">Hello</body></html>',
      false,
      'inverted'
    );

    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(
      document.indexOf('.message{color:red}')
    );
    expect(document).toContain('img-src data:');
    expect(document).not.toContain('img-src data: https:');
  });

  it('wraps fragments and permits remote images only after approval', () => {
    const document = buildEmailDocument('<p>Hello</p>', true, 'inverted');

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
    expect(buildEmailDocument('<p>Hello</p>', false, 'inverted')).toContain('img,video,canvas');
    expect(buildEmailDocument('<p>Hello</p>', false, 'dark')).not.toContain('img,video,canvas');
    expect(buildEmailDocument('<p>Hello</p>', false, 'light')).not.toContain('img,video,canvas');
  });

  it('applies the color scheme queries for the color mode', () => {
    const html =
      '<style>@media screen and (prefers-color-scheme: dark){body{color:#fff}}</style><picture><source media="(prefers-color-scheme: light)" srcset="a.png"></picture>';
    const dark = buildEmailDocument(html, false, 'dark');
    const light = buildEmailDocument(html, false, 'light');

    expect(dark).toContain('@media screen and (min-width: 0px){');
    expect(dark).toContain('media="(max-width: 0px) and (min-width: 1px)"');
    expect(light).toContain('@media screen and (max-width: 0px) and (min-width: 1px){');
    expect(light).toContain('media="(min-width: 0px)"');
  });

  it('chooses the color mode', () => {
    const darkStyles = '<style>@media (prefers-color-scheme: dark){body{color:#fff}}</style>';
    expect(emailColorMode('<p>Hello</p>', false)).toBe('inverted');
    expect(emailColorMode(darkStyles, false)).toBe('dark');
    expect(emailColorMode(darkStyles, true)).toBe('light');
    expect(emailColorMode('<p>Hello</p>', true)).toBe('light');
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
