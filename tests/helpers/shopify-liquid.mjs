// Shopify owns pagination; fixtures supply one page while rendering the real body.
export function registerPaginate(engine) {
  engine.registerTag('paginate', {
    parse(_token, tokens) {
      this.templates = [];
      while (tokens.length) {
        const token = tokens.shift();
        if (token.name === 'endpaginate') return;
        this.templates.push(this.liquid.parser.parseToken(token, tokens));
      }
      throw new Error('Unclosed paginate fixture');
    },
    *render(context, emitter) {
      yield this.liquid.renderer.renderTemplates(this.templates, context, emitter);
    },
  });
}

export function registerImageTag(engine) {
  engine.registerFilter('image_tag', (url, ...args) => {
    const attrs = Object.fromEntries(args.filter(Array.isArray));
    const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    const srcset = String(attrs.widths).split(',').map(width => `${url}&width=${width.trim()} ${width.trim()}w`).join(', ');
    return `<img src="${escape(url)}" srcset="${escape(srcset)}" width="1200" height="1200" class="${escape(attrs.class)}" sizes="${escape(attrs.sizes)}" alt="${escape(attrs.alt)}" loading="${escape(attrs.loading)}">`;
  });
}
