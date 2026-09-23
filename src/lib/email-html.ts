const compatibilityStyles = `
html,body{margin:0;min-width:0}
html{overflow-y:hidden!important}
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

const darkSchemeQuery = /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi;
const lightSchemeQuery = /\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi;
const alwaysTrueQuery = '(min-width: 0px)';
const alwaysFalseQuery = '(max-width: 0px) and (min-width: 1px)';

export function hasDarkModeStyles(html: string): boolean {
  return /@media[^{]*prefers-color-scheme\s*:\s*dark/i.test(html);
}

/*
 * The app is always dark, but the browser gives the iframe the system preference.
 * Replace the color scheme queries so that dark styles and dark <picture> sources always apply.
 */
function forceDarkScheme(html: string): string {
  return html.replace(darkSchemeQuery, alwaysTrueQuery).replace(lightSchemeQuery, alwaysFalseQuery);
}

export function hasRemoteImages(html: string): boolean {
  return /(?:\bsrc\s*=\s*["']?https?:|\bsrcset\s*=\s*["'][^"']*https?:|url\(\s*["']?https?:)/i.test(
    html
  );
}

export function buildEmailDocument(
  html: string,
  allowRemoteImages: boolean,
  invertColors: boolean
): string {
  const imageSources = allowRemoteImages ? 'data: https: http:' : 'data:';
  const colorStyles = invertColors
    ? `html{color-scheme:light}${invertedMediaStyles}`
    : 'html{color-scheme:dark}';
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imageSources}; font-src 'none'; media-src data:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>${compatibilityStyles}${colorStyles}</style>`;
  const darkHtml = forceDarkScheme(html);

  if (/<head\b[^>]*>/i.test(darkHtml))
    return darkHtml.replace(/<head\b[^>]*>/i, (tag) => `${tag}${head}`);
  if (/<html\b[^>]*>/i.test(darkHtml))
    return darkHtml.replace(/<html\b[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${darkHtml}</body></html>`;
}
