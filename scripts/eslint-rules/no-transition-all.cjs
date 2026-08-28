/**
 * Disallow Tailwind's transition-all utility in product code.
 *
 * Broad transitions silently animate newly-added properties and can turn a
 * harmless style change into layout or paint work. Product components must
 * name the properties they intend to animate.
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require explicit transition properties instead of transition-all.',
      recommended: true,
    },
    schema: [],
    messages: {
      noTransitionAll:
        'Avoid transition-all. Use an explicit transition-[property,...] list and a semantic motion duration.',
    },
  },

  create(context) {
    const containsTransitionAll = (value) =>
      typeof value === 'string' && /(^|\s)transition-all(?=\s|$)/.test(value)

    return {
      Literal(node) {
        if (containsTransitionAll(node.value)) {
          context.report({ node, messageId: 'noTransitionAll' })
        }
      },
      TemplateElement(node) {
        if (containsTransitionAll(node.value.cooked ?? node.value.raw)) {
          context.report({ node, messageId: 'noTransitionAll' })
        }
      },
    }
  },
}
