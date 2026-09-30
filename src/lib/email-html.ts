const compatibilityStyles = `
html,body{margin:0;min-width:0}
html{overflow-y:hidden!important;font-family:ui-sans-serif,system-ui,sans-serif}
body{padding:20px;background:Canvas;color:CanvasText;overflow-wrap:anywhere}
img{max-width:100%!important;height:auto!important}
table{max-width:100%!important}
pre{white-space:pre-wrap}
`;

/*
 * The reading pane inverts emails without dark styles (see .message-paper.inverted).
 * These rules invert media again so that photos and logos keep their colors.
 * Media inside an element that is already inverted again must not invert a third time.
 */
const invertedMediaStyles = `
img,video,canvas,[background],[style*="url("]{filter:invert(1) hue-rotate(180deg)}
:is([background],[style*="url("]) :is(img,video,canvas,[background],[style*="url("]){filter:none}
`;

/*
 * Quoted replies from common mail clients: Gmail, Apple Mail and Thunderbird, Yahoo, Proton,
 * Outlook web (its reply header, the <hr> before it, and everything after it),
 * the new Outlook apps (the reply header container and the quoted body), and Outlook desktop.
 * Outlook desktop has no id or class. Its reply header is a div with a top border, and the
 * quoted text comes after the header or after the header's wrapper.
 */
const outlookDesktopHeader = 'div[style*="border-top:solid"][style*="padding:3.0pt 0in 0in 0in"]';
export const quotedHtmlSelector = [
  '.gmail_quote',
  'blockquote[type=cite]',
  '.moz-cite-prefix',
  '.yahoo_quoted',
  '.protonmail_quote',
  '#divRplyFwdMsg',
  '#divRplyFwdMsg~*',
  ':has(>hr):has(+#divRplyFwdMsg)',
  '#appendonsend~*',
  '#mail-editor-reference-message-container',
  '#mail-editor-reference-message-body',
  outlookDesktopHeader,
  `${outlookDesktopHeader}~*`,
  `:has(>${outlookDesktopHeader}:first-child)~*`,
].join(',');
const quotedHtmlPattern =
  /\bclass\s*=\s*["']?[^"'>]*\b(?:gmail_quote|moz-cite-prefix|yahoo_quoted|protonmail_quote)\b|<blockquote\b[^>]*\btype\s*=\s*["']?cite\b|\bid\s*=\s*["']?(?:divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)\b|border-top:solid[^"']*padding:3\.0pt 0in 0in 0in/i;

/*
 * Quoted text stays hidden until the reader checks the #quote-toggle checkbox, which the
 * reading pane puts before the quoted text. This works without scripts in the frame.
 * The colors suit light and dark emails and the inverted view.
 */
const hiddenQuoteStyles = `
html:not(:has(#quote-toggle-input:checked)) :is(${quotedHtmlSelector}):not(#quote-toggle){display:none!important}
#quote-toggle{all:initial;display:block;position:relative;width:fit-content;margin:8px 0;padding:0 6px;border:1px solid #8888;border-radius:4px;color:#888;font:12px/14px ui-sans-serif,system-ui,sans-serif;letter-spacing:1px;cursor:pointer}
#quote-toggle-input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
#quote-toggle:hover,#quote-toggle:has(#quote-toggle-input:focus-visible){border-color:#888}
`;

export function hasQuotedHtml(html: string): boolean {
  return quotedHtmlPattern.test(html);
}

const darkSchemeQuery = /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi;
const lightSchemeQuery = /\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi;
const alwaysTrueQuery = '(min-width: 0px)';
const alwaysFalseQuery = '(max-width: 0px) and (min-width: 1px)';

/*
 * - inverted: light-only email, inverted to fit the dark app.
 * - dark: the email's own dark mode styles.
 * - light: the original light colors, when the reader asks for them.
 */
export type EmailColorMode = 'inverted' | 'dark' | 'light';

export function hasDarkModeStyles(html: string): boolean {
  return /@media[^{]*prefers-color-scheme\s*:\s*dark/i.test(html);
}

export function emailColorMode(html: string, originalColors: boolean): EmailColorMode {
  if (originalColors) return 'light';
  return hasDarkModeStyles(html) ? 'dark' : 'inverted';
}

/*
 * The browser gives the iframe the system preference, not the app color scheme.
 * Replace the color scheme queries so that the styles and <picture> sources for the scheme always apply.
 */
function forceColorScheme(html: string, scheme: 'dark' | 'light'): string {
  const dark = scheme === 'dark';
  return html
    .replace(darkSchemeQuery, dark ? alwaysTrueQuery : alwaysFalseQuery)
    .replace(lightSchemeQuery, dark ? alwaysFalseQuery : alwaysTrueQuery);
}

export function hasRemoteImages(html: string): boolean {
  return /(?:\bsrc\s*=\s*["']?https?:|\bsrcset\s*=\s*["'][^"']*https?:|url\(\s*["']?https?:)/i.test(
    html
  );
}

export function buildEmailDocument(
  html: string,
  allowRemoteImages: boolean,
  colorMode: EmailColorMode,
  hideQuotes = false
): string {
  const imageSources = allowRemoteImages ? 'data: https: http:' : 'data:';
  /*
   * An inverted email renders light but looks dark. It takes the dark <picture> sources,
   * because media is inverted again and shows as designed on the dark result.
   */
  const queryScheme = colorMode === 'light' ? 'light' : 'dark';
  const canvasScheme = colorMode === 'dark' ? 'dark' : 'light';
  const colorStyles = `html{color-scheme:${canvasScheme}}${colorMode === 'inverted' ? invertedMediaStyles : ''}`;
  const quoteStyles = hideQuotes ? hiddenQuoteStyles : '';
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imageSources}; font-src 'none'; media-src data:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${compatibilityStyles}${colorStyles}${quoteStyles}</style>`;
  const schemeHtml = forceColorScheme(html, queryScheme);

  if (/<head\b[^>]*>/i.test(schemeHtml))
    return schemeHtml.replace(/<head\b[^>]*>/i, (tag) => `${tag}${head}`);
  if (/<html\b[^>]*>/i.test(schemeHtml))
    return schemeHtml.replace(/<html\b[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${schemeHtml}</body></html>`;
}
