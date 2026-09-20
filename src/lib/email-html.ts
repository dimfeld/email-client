const compatibilityStyles = `
html,body{margin:0;min-width:0}
body{padding:20px;background:#fff;color:#111;overflow-wrap:anywhere}
img{max-width:100%!important;height:auto!important}
table{max-width:100%!important}
pre{white-space:pre-wrap}
`;

export function hasRemoteImages(html: string): boolean {
	return /(?:\bsrc\s*=\s*["']?https?:|\bsrcset\s*=\s*["'][^"']*https?:|url\(\s*["']?https?:)/i.test(html);
}

export function buildEmailDocument(html: string, allowRemoteImages: boolean): string {
	const imageSources = allowRemoteImages ? 'data: https: http:' : 'data:';
	const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imageSources}; font-src 'none'; media-src data:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>${compatibilityStyles}</style>`;

	if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (tag) => `${tag}${head}`);
	if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
	return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}
