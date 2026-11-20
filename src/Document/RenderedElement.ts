import { RenderingContext2D } from '../types'
import {
  PSEUDO_ZERO,
  toNumbers
} from '../util'
import { Font } from '../Font'
import { Property } from '../Property'
import { Element } from './Element'

export abstract class RenderedElement extends Element {
  /**
   * Font size (in pixels) resolved by the last {@link setContext} call. It is
   * kept separate from the `font-size` style property because relative units
   * (`em`, `%`, ...) must be resolved against the context the element is
   * rendered in. The same definition can be rendered by several `<use>`
   * elements with different font sizes, so the resolved value cannot be
   * written back to the (shared) style property.
   */
  protected resolvedFontSize: number | undefined = undefined
  private modifiedEmSizeStack = false

  protected calculateOpacity() {
    let opacity = 1.0
    // eslint-disable-next-line @typescript-eslint/no-this-alias, consistent-this
    let element: Element | null = this

    while (element) {
      const opacityStyle = element.getStyle('opacity', false, true) // no ancestors on style call

      if (opacityStyle.hasValue(true)) {
        opacity *= opacityStyle.getNumber()
      }

      element = element.parent
    }

    return opacity
  }

  override setContext(ctx: RenderingContext2D, fromMeasure = false) {
    if (!fromMeasure) { // causes stack overflow when measuring text with gradients
      // fill
      const fillStyleProp = this.getStyle('fill')
      const fillOpacityStyleProp = this.getStyle('fill-opacity')
      const strokeStyleProp = this.getStyle('stroke')
      const strokeOpacityProp = this.getStyle('stroke-opacity')

      if (fillStyleProp.isUrlDefinition()) {
        const fillStyle = fillStyleProp.getFillStyleDefinition(this, fillOpacityStyleProp)

        if (fillStyle) {
          ctx.fillStyle = fillStyle
        }
      } else
      if (fillStyleProp.hasValue()) {
        if (fillStyleProp.getString() === 'currentColor') {
          fillStyleProp.setValue(this.getStyle('color').getColor())
        }

        const fillStyle = fillStyleProp.getColor()

        if (fillStyle !== 'inherit') {
          ctx.fillStyle = fillStyle === 'none'
            ? 'rgba(0,0,0,0)'
            : fillStyle
        }
      }

      if (fillOpacityStyleProp.hasValue()) {
        const fillStyle = new Property(this.document, 'fill', ctx.fillStyle)
          .addOpacity(fillOpacityStyleProp)
          .getColor()

        ctx.fillStyle = fillStyle
      }

      // stroke
      if (strokeStyleProp.isUrlDefinition()) {
        const strokeStyle = strokeStyleProp.getFillStyleDefinition(this, strokeOpacityProp)

        if (strokeStyle) {
          ctx.strokeStyle = strokeStyle
        }
      } else
      if (strokeStyleProp.hasValue()) {
        if (strokeStyleProp.getString() === 'currentColor') {
          strokeStyleProp.setValue(this.getStyle('color').getColor())
        }

        const strokeStyle = strokeStyleProp.getString()

        if (strokeStyle !== 'inherit') {
          ctx.strokeStyle = strokeStyle === 'none'
            ? 'rgba(0,0,0,0)'
            : strokeStyle
        }
      }

      if (strokeOpacityProp.hasValue()) {
        const strokeStyle = new Property(this.document, 'stroke', ctx.strokeStyle)
          .addOpacity(strokeOpacityProp)
          .getString()

        ctx.strokeStyle = strokeStyle
      }

      const strokeWidthStyleProp = this.getStyle('stroke-width')

      if (strokeWidthStyleProp.hasValue()) {
        const newLineWidth = strokeWidthStyleProp.getPixels()

        ctx.lineWidth = !newLineWidth
          ? PSEUDO_ZERO // browsers don't respect 0 (or node-canvas? :-)
          : newLineWidth
      }

      const strokeLinecapStyleProp = this.getStyle('stroke-linecap')
      const strokeLinejoinStyleProp = this.getStyle('stroke-linejoin')
      const strokeMiterlimitProp = this.getStyle('stroke-miterlimit')
      // NEED TEST
      // const pointOrderStyleProp = this.getStyle('paint-order');
      const strokeDasharrayStyleProp = this.getStyle('stroke-dasharray')
      const strokeDashoffsetProp = this.getStyle('stroke-dashoffset')

      if (strokeLinecapStyleProp.hasValue()) {
        ctx.lineCap = strokeLinecapStyleProp.getString() as CanvasLineCap
      }

      if (strokeLinejoinStyleProp.hasValue()) {
        ctx.lineJoin = strokeLinejoinStyleProp.getString() as CanvasLineJoin
      }

      if (strokeMiterlimitProp.hasValue()) {
        ctx.miterLimit = strokeMiterlimitProp.getNumber()
      }

      // NEED TEST
      // if (pointOrderStyleProp.hasValue()) {
      //   // ?
      //   ctx.paintOrder = pointOrderStyleProp.getValue();
      // }

      if (strokeDasharrayStyleProp.hasValue() && strokeDasharrayStyleProp.getString() !== 'none') {
        const gaps = toNumbers(strokeDasharrayStyleProp.getString())

        if (typeof ctx.setLineDash !== 'undefined') {
          ctx.setLineDash(gaps)
        } else
        // @ts-expect-error Handle browser prefix.
        if (typeof ctx.webkitLineDash !== 'undefined') {
          // @ts-expect-error Handle browser prefix.
          ctx.webkitLineDash = gaps
        } else
        // @ts-expect-error Handle browser prefix.
        if (typeof ctx.mozDash !== 'undefined' && !(gaps.length === 1 && gaps[0] === 0)) {
          // @ts-expect-error Handle browser prefix.
          ctx.mozDash = gaps
        }

        const offset = strokeDashoffsetProp.getPixels()

        if (typeof ctx.lineDashOffset !== 'undefined') {
          ctx.lineDashOffset = offset
        } else
        // @ts-expect-error Handle browser prefix.
        if (typeof ctx.webkitLineDashOffset !== 'undefined') {
          // @ts-expect-error Handle browser prefix.
          ctx.webkitLineDashOffset = offset
        } else
        // @ts-expect-error Handle browser prefix.
        if (typeof ctx.mozDashOffset !== 'undefined') {
          // @ts-expect-error Handle browser prefix.
          ctx.mozDashOffset = offset
        }
      }
    }

    // font
    this.modifiedEmSizeStack = false

    if (typeof ctx.font !== 'undefined') {
      const fontStyleProp = this.getStyle('font')
      const fontStyleStyleProp = this.getStyle('font-style')
      const fontVariantStyleProp = this.getStyle('font-variant')
      const fontWeightStyleProp = this.getStyle('font-weight')
      const fontFamilyStyleProp = this.getStyle('font-family')
      // Resolve the font size without overwriting the style property.
      // Relative units (`em`, `%`, ...) must be resolved against the context
      // the element is rendered in: the same definition can be reused by
      // several `<use>` elements with different font sizes. Overwriting the
      // property with the first resolved size would make every subsequent
      // render use a stale size (and would also invalidate the measurement
      // cache keyed by it).
      let resolvedFontSize = this.getComputedFontSize()
      const font = new Font(
        fontStyleStyleProp.getString(),
        fontVariantStyleProp.getString(),
        fontWeightStyleProp.getString(),
        typeof resolvedFontSize === 'number' && !isNaN(resolvedFontSize)
          ? `${resolvedFontSize}px`
          : '',
        fontFamilyStyleProp.getString(),
        Font.parse(
          fontStyleProp.getString(),
          ctx.font
        )
      )

      if (typeof resolvedFontSize === 'number' && isNaN(resolvedFontSize)) {
        resolvedFontSize = undefined
      }

      if (typeof resolvedFontSize === 'undefined') {
        // The size comes from the `font` shorthand or from the context.
        const inheritedFontSize = parseFloat(font.fontSize)

        if (!isNaN(inheritedFontSize)) {
          resolvedFontSize = inheritedFontSize
        }
      }

      fontStyleStyleProp.setValue(font.fontStyle)
      fontVariantStyleProp.setValue(font.fontVariant)
      fontWeightStyleProp.setValue(font.fontWeight)
      fontFamilyStyleProp.setValue(font.fontFamily)

      ctx.font = font.toString()

      this.resolvedFontSize = resolvedFontSize

      if (typeof resolvedFontSize === 'number') {
        this.document.emSize = resolvedFontSize
        this.modifiedEmSizeStack = true
      }
    }

    if (!fromMeasure) {
      // effects
      this.applyEffects(ctx)
      // opacity
      ctx.globalAlpha = this.calculateOpacity()
    }
  }

  override clearContext(ctx: RenderingContext2D) {
    super.clearContext(ctx)

    if (this.modifiedEmSizeStack) {
      this.document.popEmSize()
    }
  }

  /**
   * Resolves a `font-size` property to pixels. Relative units (`em`, `ex`,
   * `%`) are resolved against the computed size of the parent instead of the
   * mutable document `em` size, so nested measurement passes cannot resolve
   * the same value twice.
   * @param property - The `font-size` property to resolve.
   * @returns The size in pixels.
   */
  private resolveFontSize(property: Property) {
    const units = property.getUnits()
    const isRelative = units === 'em' || units === 'ex' || units === '%'
    const parentFontSize = this.parent instanceof RenderedElement
      ? this.parent.getComputedFontSize()
      : undefined

    if (isRelative && typeof parentFontSize === 'number') {
      const number = property.getNumber()

      switch (units) {
        case 'em':
          return number * parentFontSize

        case 'ex':
          return number * parentFontSize / 2.0

        case '%':
          return number * parentFontSize

        default:
      }
    }

    return property.getPixels(true)
  }

  /**
   * Returns the font size this element is rendered with, even before its
   * {@link setContext} has been called. The element's own `font-size` is
   * always resolved from the style chain (never cached), so changing it or
   * rendering the same definition under another `<use>` with a different size
   * is picked up immediately. An inherited size is taken from the ancestor
   * that resolved it in the current render pass.
   * @returns The computed font size in pixels, or `undefined`.
   */
  protected getComputedFontSize(): number | undefined {
    const ownFontSizeProp = this.getStyle('font-size', false, true)

    if (ownFontSizeProp.hasValue()) {
      return this.resolveFontSize(ownFontSizeProp)
    }

    if (!this.getStyle('font-size').hasValue()
      || !(this.parent instanceof RenderedElement)
    ) {
      return undefined
    }

    if (typeof this.parent.resolvedFontSize === 'number') {
      return this.parent.resolvedFontSize
    }

    return this.parent.getComputedFontSize()
  }
}
