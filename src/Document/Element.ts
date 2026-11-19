import { RenderingContext2D } from '../types'
import {
  IMPORTANT_RULE_SPECIFICITY_TIER,
  INLINE_IMPORTANT_STYLES_SPECIFICITY_WEIGHT,
  INLINE_STYLES_SPECIFICITY_WEIGHT,
  matchesSelector as matchesCssSelector,
  normalizeAttributeName,
  RULE_SPECIFICITY_TIER
} from '../util'
import { Property } from '../Property'
import { Transform } from '../Transform'
import { Document } from './Document'
import { ClipPathElement } from './ClipPathElement'
import { MaskElement } from './MaskElement'
import { FilterElement } from './FilterElement'

export abstract class Element {
  static readonly ignoreChildTypes = ['title']

  readonly type: string = ''
  readonly attributes: Map<string, Property> = new Map()
  readonly styles: Map<string, Property> = new Map()
  readonly stylesSpecificity: Map<string, string> = new Map()
  animationFrozen = false
  animationFrozenValue = ''
  parent: Element | null = null
  children: Element[] = []

  constructor(
    protected readonly document: Document,
    protected readonly node?: HTMLElement,
    protected readonly captureTextNodes = false
  ) {
    if (!node || node.nodeType !== 1) { // ELEMENT_NODE
      return
    }

    // add attributes
    Array.from(node.attributes).forEach((attribute) => {
      const nodeName = normalizeAttributeName(attribute.nodeName)

      this.attributes.set(nodeName, new Property(document, nodeName, attribute.value))
    })

    this.addStylesFromStyleDefinition()

    // add inline styles
    if (this.getAttribute('style').hasValue()) {
      const styles = this.getAttribute('style')
        .getString()
        .split(';')
        .map(_ => _.trim())

      styles.forEach((style) => {
        if (!style) {
          return
        }

        const [name, value] = style.split(':').map(_ => _.trim())

        if (name) {
          let important = false
          let normalizedValue = value
          const importantMatch = /!important\s*$/.exec(value)

          if (importantMatch) {
            important = true
            normalizedValue = value.slice(0, value.length - importantMatch[0].length).trim()
          }

          this.styles.set(name, new Property(document, name, normalizedValue))
          // inline styles always win over style sheet rules, so they get a
          // weight no selector can reach
          this.stylesSpecificity.set(
            name,
            important
              ? INLINE_IMPORTANT_STYLES_SPECIFICITY_WEIGHT
              : INLINE_STYLES_SPECIFICITY_WEIGHT
          )
        }
      })
    }

    const { definitions } = document
    const id = this.getAttribute('id')

    // add id
    if (id.hasValue()) {
      if (!definitions.has(id.getString())) {
        definitions.set(id.getString(), this)
      }
    }

    Array.from(node.childNodes).forEach((childNode: HTMLElement) => {
      if (childNode.nodeType === 1) {
        this.addChild(childNode) // ELEMENT_NODE
      } else
      if (captureTextNodes && (
        childNode.nodeType === 3
        || childNode.nodeType === 4
      )) {
        const textNode = document.createTextNode(childNode)

        if (textNode.getText().length > 0) {
          this.addChild(textNode) // TEXT_NODE
        }
      }
    })
  }

  getAttribute(name: string, createIfNotExists = false): Property {
    const attr = this.attributes.get(name)

    if (!attr && createIfNotExists) {
      const attr = new Property(this.document, name, '')

      this.attributes.set(name, attr)

      return attr
    }

    return attr || Property.empty(this.document)
  }

  getHrefAttribute(): Property {
    let href: Property | undefined

    for (const [key, value] of this.attributes) {
      if (key === 'href' || key.endsWith(':href')) {
        href = value
        break
      }
    }

    return href || Property.empty(this.document)
  }

  getStyle(name: string, createIfNotExists = false, skipAncestors = false): Property {
    const style = this.styles.get(name)

    if (style) {
      return style
    }

    const attr = this.getAttribute(name)

    if (attr.hasValue()) {
      this.styles.set(name, attr) // move up to me to cache
      return attr
    }

    if (!skipAncestors) {
      const { parent } = this

      if (parent) {
        const parentStyle = parent.getStyle(name)

        if (parentStyle.hasValue()) {
          return parentStyle
        }
      }
    }

    if (createIfNotExists) {
      const style = new Property(this.document, name, '')

      this.styles.set(name, style)

      return style
    }

    return Property.empty(this.document)
  }

  render(ctx: RenderingContext2D) {
    // don't render display=none
    // don't render visibility=hidden
    if (this.getStyle('display').getString() === 'none'
      || this.getStyle('visibility').getString() === 'hidden'
    ) {
      return
    }

    ctx.save()

    if (this.getStyle('mask').hasValue()) { // mask
      const mask = this.getStyle('mask').getDefinition<MaskElement>()

      if (mask) {
        this.applyEffects(ctx)
        mask.apply(ctx, this)
      }
    } else
    if (this.getStyle('filter').getValue('none') !== 'none') { // filter
      const filter = this.getStyle('filter').getDefinition<FilterElement>()

      if (filter) {
        this.applyEffects(ctx)
        filter.apply(ctx, this)
      }
    } else {
      this.setContext(ctx)
      this.renderChildren(ctx)
      this.clearContext(ctx)
    }

    ctx.restore()
  }

  setContext(_: RenderingContext2D) {
    // NO RENDER
  }

  protected applyEffects(ctx: RenderingContext2D) {
    // transform
    const transform = Transform.fromElement(this.document, this)

    if (transform) {
      transform.apply(ctx)
    }

    // clip
    const clipPathStyleProp = this.getStyle('clip-path', false, true)

    if (clipPathStyleProp.hasValue()) {
      const clip = clipPathStyleProp.getDefinition<ClipPathElement>()

      if (clip) {
        clip.apply(ctx)
      }
    }
  }

  clearContext(_: RenderingContext2D) {
    // NO RENDER
  }

  renderChildren(ctx: RenderingContext2D) {
    this.children.forEach((child) => {
      child.render(ctx)
    })
  }

  protected addChild(childNode: Element|HTMLElement) {
    const child = childNode instanceof Element
      ? childNode
      : this.document.createElement(childNode)

    child.parent = this

    if (!Element.ignoreChildTypes.includes(child.type)) {
      this.children.push(child)
    }
  }

  protected matchesSelector(selector: string) {
    const { node } = this

    // prefer the host DOM's native matcher when it exists
    if (typeof node.matches === 'function') {
      return node.matches(selector)
    }

    if (typeof node.getAttribute !== 'function') {
      // not a real DOM element (e.g. the fake node used for masks):
      // it has no attributes, so no selector can match it
      return false
    }

    return matchesCssSelector(node, selector)
  }

  addStylesFromStyleDefinition() {
    const { styleRules } = this.document

    for (const rule of styleRules) {
      if (rule.selector.startsWith('@') || !this.matchesSelector(rule.selector)) {
        continue
      }

      for (const declaration of rule.declarations) {
        const { name } = declaration
        // rules are applied in document order, so on equal specificity the
        // later declaration wins
        const specificity = `${declaration.important
          ? IMPORTANT_RULE_SPECIFICITY_TIER
          : RULE_SPECIFICITY_TIER}${declaration.specificity}`
        const existingSpecificity = this.stylesSpecificity.get(name) || ''

        if (specificity >= existingSpecificity) {
          this.styles.set(name, new Property(this.document, name, declaration.value))
          this.stylesSpecificity.set(name, specificity)
        }
      }
    }
  }

  protected removeStyles(element: Element, ignoreStyles: string[]) {
    const toRestore = ignoreStyles.reduce<[string, string][]>((toRestore, name) => {
      const styleProp = element.getStyle(name)

      if (!styleProp.hasValue()) {
        return toRestore
      }

      const value = styleProp.getString()

      styleProp.setValue('')

      return [...toRestore, [name, value]]
    }, [])

    return toRestore
  }

  protected restoreStyles(element: Element, styles: [string, string][]) {
    styles.forEach(([name, value]) => {
      element.getStyle(name, true).setValue(value)
    })
  }

  isFirstChild() {
    return this.parent?.children.indexOf(this) === 0
  }
}
