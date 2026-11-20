import { RenderingContext2D } from '../types'
import {
  compressSpaces,
  trimLeft,
  trimRight
} from '../util'
import { Axis } from '../ViewPort'
import { Font } from '../Font'
import { BoundingBox } from '../BoundingBox'
import { Property } from '../Property'
import { Document } from './Document'
import { Element } from './Element'
import { FontElement } from './FontElement'
import { ArabicForm, GlyphElement } from './GlyphElement'
import { RenderedElement } from './RenderedElement'

interface IGlyphMetrics {
  char: string
  /** Index of the character in the (possibly reversed) text. */
  index: number
  /** Advance width, already scaled by `lengthAdjust="spacingAndGlyphs"`. */
  width: number
  /** Spacing inserted after the glyph (never after the last one). */
  spacingAfter: number
  /** Absolute horizontal offset from the start of the run, if any. */
  xOffset: number | null
  /** Absolute vertical offset from the baseline of the run, if any. */
  yOffset: number | null
  /** Horizontal shift applied before the glyph. */
  dx: number
  /** Vertical shift applied before the glyph. */
  dy: number
}

interface IGlyphPosition {
  char: string
  index: number
  x: number
  y: number
  scaleX: number
}

interface ITextMetrics {
  key: string
  glyphs: IGlyphMetrics[]
  /** Total advance of the text run (from the element's `x`). */
  total: number
  /** Horizontal glyph scale (`lengthAdjust="spacingAndGlyphs"`). */
  scaleX: number
  text: string
  customFont: FontElement | undefined
  perGlyph: boolean
}

export class TextElement extends RenderedElement {
  override type = 'text'
  protected x = 0
  protected y = 0
  private leafTexts: TextElement[] = []
  private textChunkStart = 0
  private minX = Number.POSITIVE_INFINITY
  private maxX = Number.NEGATIVE_INFINITY
  private textMetricsCache: ITextMetrics | null = null

  constructor(
    document: Document,
    node: HTMLElement,
    captureTextNodes?: boolean
  ) {
    super(
      document,
      node,
      new.target === TextElement
        ? true
        : captureTextNodes
    )
  }

  override setContext(ctx: RenderingContext2D, fromMeasure = false) {
    super.setContext(ctx, fromMeasure)

    const textBaseline = this.getStyle('dominant-baseline').getTextBaseline()
      || this.getStyle('alignment-baseline').getTextBaseline()

    if (textBaseline) {
      ctx.textBaseline = textBaseline as CanvasTextBaseline
    }
  }

  protected initializeCoordinates() {
    this.x = 0
    this.y = 0
    this.leafTexts = []
    this.textChunkStart = 0
    this.minX = Number.POSITIVE_INFINITY
    this.maxX = Number.NEGATIVE_INFINITY
  }

  getBoundingBox(ctx: RenderingContext2D) {
    if (this.type !== 'text') {
      return this.getTElementBoundingBox(ctx)
    }

    // first, calculate child positions
    this.initializeCoordinates()
    this.adjustChildCoordinatesRecursive(ctx)

    let boundingBox: BoundingBox | null = null

    // then calculate bounding box
    this.children.forEach((_, i) => {
      const childBoundingBox = this.getChildBoundingBox(ctx, this, this, i)

      if (!boundingBox) {
        boundingBox = childBoundingBox
      } else {
        boundingBox.addBoundingBox(childBoundingBox)
      }
    })

    return boundingBox
  }

  protected getFontSize() {
    if (typeof this.resolvedFontSize === 'number') {
      return this.resolvedFontSize
    }

    const fontSize = this.getStyle('font-size')

    if (fontSize.hasValue()) {
      const resolvedFontSize = fontSize.getPixels(true)

      if (!isNaN(resolvedFontSize)) {
        return resolvedFontSize
      }
    }

    const inheritedFontSize = parseFloat(
      Font.parse(this.document.ctx.font).fontSize
    )

    return isNaN(inheritedFontSize) ? 0 : inheritedFontSize
  }

  protected getTElementBoundingBox(ctx: RenderingContext2D) {
    const fontSize = this.getFontSize()

    return new BoundingBox(
      this.x,
      this.y - fontSize,
      this.x + this.measureText(ctx),
      this.y
    )
  }

  getGlyph(
    font: FontElement,
    text: string,
    i: number
  ) {
    const char = text[i]
    let glyph: GlyphElement | undefined

    if (font.isArabic) {
      const len = text.length
      const prevChar = text[i - 1]
      const nextChar = text[i + 1]
      let arabicForm: ArabicForm = 'isolated'

      if ((i === 0 || prevChar === ' ') && i < len - 1 && nextChar !== ' ') {
        arabicForm = 'terminal'
      }

      if (i > 0 && prevChar !== ' ' && i < len - 1 && nextChar !== ' ') {
        arabicForm = 'medial'
      }

      if (i > 0 && prevChar !== ' ' && (i === len - 1 || nextChar === ' ')) {
        arabicForm = 'initial'
      }

      glyph = font.arabicGlyphs.get(char)?.get(arabicForm) || font.glyphs.get(char)
    } else {
      glyph = font.glyphs.get(char)
    }

    if (!glyph) {
      glyph = font.missingGlyph
    }

    return glyph
  }

  getText() {
    return ''
  }

  protected getTextFromNode(node?: ChildNode) {
    const textNode = node || this.node
    const childNodes = Array.from(textNode.parentNode.childNodes)
    const index = childNodes.indexOf(textNode)
    const lastIndex = childNodes.length - 1
    let text = compressSpaces(
      // textNode.value
      // || textNode.text
      textNode.textContent
      || ''
    )

    if (index === 0) {
      text = trimLeft(text)
    }

    if (index === lastIndex) {
      text = trimRight(text)
    }

    return text
  }

  override renderChildren(ctx: RenderingContext2D) {
    if (this.type !== 'text') {
      this.renderTElementChildren(ctx)
      return
    }

    // first, calculate child positions
    this.initializeCoordinates()
    this.adjustChildCoordinatesRecursive(ctx)

    // then render
    this.children.forEach((_, i) => {
      this.renderChild(ctx, this, this, i)
    })

    const { mouse } = this.document.screen

    // Do not calc bounding box if mouse is not working.
    if (mouse.isWorking()) {
      mouse.checkBoundingBox(
        this,
        this.getBoundingBox(ctx)
      )
    }
  }

  protected renderTElementChildren(ctx: RenderingContext2D) {
    const { document } = this
    const renderText = this.getText()
    const metrics = this.getTextMetrics(ctx)
    const { customFont } = metrics

    if (customFont) {
      const { unitsPerEm } = customFont.fontFace
      const fontSize = this.getFontSize()
      const fontStyle = this.getStyle('font-style').getString(
        Font.parse(document.ctx.font).fontStyle
      )
      const scale = fontSize / unitsPerEm
      const positions = this.getGlyphPositions(metrics)

      for (const position of positions) {
        const glyph = this.getGlyph(customFont, metrics.text, position.index)

        if (!glyph) {
          continue
        }

        ctx.save()
        ctx.translate(position.x, position.y)
        ctx.scale(scale * position.scaleX, -scale)

        const lw = ctx.lineWidth

        ctx.lineWidth = ctx.lineWidth * unitsPerEm / fontSize

        if (fontStyle === 'italic') {
          ctx.transform(1, 0, .4, 1, 0, 0)
        }

        glyph.render(ctx)
        ctx.lineWidth = lw
        ctx.restore()
      }

      return
    }

    if (!metrics.perGlyph) {
      const {
        x,
        y
      } = this

      // NEED TEST
      // if (ctx.paintOrder === 'stroke') {
      //   if (ctx.strokeStyle) {
      //     ctx.strokeText(renderText, x, y);
      //   }

      //   if (ctx.fillStyle) {
      //     ctx.fillText(renderText, x, y);
      //   }
      // } else {
      if (ctx.fillStyle) {
        ctx.fillText(renderText, x, y)
      }

      if (ctx.strokeStyle) {
        ctx.strokeText(renderText, x, y)
      }
      // }

      return
    }

    // Glyphs are not necessarily on a single baseline and their advances may
    // be adjusted (`x`/`y`/`dx`/`dy` lists, `textLength`, `letter-spacing`),
    // so every character is positioned and drawn on its own.
    const positions = this.getGlyphPositions(metrics)

    for (const position of positions) {
      if (position.scaleX === 1) {
        if (ctx.fillStyle) {
          ctx.fillText(position.char, position.x, position.y)
        }

        if (ctx.strokeStyle) {
          ctx.strokeText(position.char, position.x, position.y)
        }

        continue
      }

      ctx.save()
      ctx.translate(position.x, position.y)
      ctx.scale(position.scaleX, 1)

      if (ctx.fillStyle) {
        ctx.fillText(position.char, 0, 0)
      }

      if (ctx.strokeStyle) {
        ctx.strokeText(position.char, 0, 0)
      }

      ctx.restore()
    }
  }

  /**
   * Converts glyph metrics into absolute glyph positions for the current
   * {@link x}/{@link y} origin of this element.
   * @param metrics - The metrics of the text run.
   * @returns The absolute positions of the glyphs.
   */
  protected getGlyphPositions(metrics: ITextMetrics): IGlyphPosition[] {
    const positions: IGlyphPosition[] = []

    if (!metrics.glyphs.length) {
      return positions
    }

    // `adjustChildCoordinates` already applied the first `dx`/`dy` value to
    // `this.x`/`this.y`, so the flow starts before them.
    const startX = this.x - metrics.glyphs[0].dx
    const startY = this.y - metrics.glyphs[0].dy
    let cursorX = startX
    let cursorY = startY

    metrics.glyphs.forEach((glyph, i) => {
      if (glyph.xOffset !== null && i > 0) {
        cursorX = startX + glyph.xOffset
      }

      cursorX += glyph.dx

      if (glyph.yOffset !== null && i > 0) {
        cursorY = startY + glyph.yOffset
      }

      cursorY += glyph.dy

      positions.push({
        char: glyph.char,
        index: glyph.index,
        x: cursorX,
        y: cursorY,
        scaleX: metrics.scaleX
      })

      cursorX += glyph.width + glyph.spacingAfter
    })

    return positions
  }

  protected applyAnchoring() {
    if (this.textChunkStart >= this.leafTexts.length) {
      return
    }

    // This is basically the "Apply anchoring" part of https://www.w3.org/TR/SVG2/text.html#TextLayoutAlgorithm.
    // The difference is that we apply the anchoring as soon as a chunk is finished. This saves some extra looping.
    // Vertical text is not supported.

    const firstElement = this.leafTexts[this.textChunkStart]
    const textAnchor = firstElement.getStyle('text-anchor').getString('start')
    const isRTL = false // we treat RTL like LTR
    let shift = 0

    if (textAnchor === 'start' && !isRTL || textAnchor === 'end' && isRTL) {
      shift = firstElement.x - this.minX
    } else if (textAnchor === 'end' && !isRTL || textAnchor === 'start' && isRTL) {
      shift = firstElement.x - this.maxX
    } else {
      shift = firstElement.x - (this.minX + this.maxX) / 2
    }

    for (let i = this.textChunkStart; i < this.leafTexts.length; i++) {
      this.leafTexts[i].x += shift
    }

    // start new chunk
    this.minX = Number.POSITIVE_INFINITY
    this.maxX = Number.NEGATIVE_INFINITY
    this.textChunkStart = this.leafTexts.length
  }

  protected adjustChildCoordinatesRecursive(ctx: RenderingContext2D) {
    this.children.forEach((_, i) => {
      this.adjustChildCoordinatesRecursiveCore(ctx, this, this, i)
    })
    this.applyAnchoring()
  }

  protected adjustChildCoordinatesRecursiveCore(
    ctx: RenderingContext2D,
    textParent: TextElement,
    parent: Element,
    i: number
  ): void {
    const child = parent.children[i] as TextElement

    if (child.children.length > 0) {
      child.children.forEach((_, i) => {
        textParent.adjustChildCoordinatesRecursiveCore(ctx, textParent, child, i)
      })
    } else {
      // only leafs are relevant
      this.adjustChildCoordinates(ctx, textParent, parent, i)
    }
  }

  protected adjustChildCoordinates(
    ctx: RenderingContext2D,
    textParent: TextElement,
    parent: Element,
    i: number
  ) {
    const child = parent.children[i] as TextElement

    if (typeof child.measureText !== 'function') {
      return child
    }

    ctx.save()
    child.setContext(ctx, true)

    const xAttr = child.getAttribute('x')
    const yAttr = child.getAttribute('y')
    const dxAttr = child.getAttribute('dx')
    const dyAttr = child.getAttribute('dy')
    const customFont = child.getStyle('font-family').getDefinition<FontElement>()
    const isRTL = Boolean(customFont?.isRTL)

    if (i === 0) {
      // First children inherit attributes from parent(s). Positional attributes
      // are only inherited from a parent to it's first child.
      if (!xAttr.hasValue()) {
        xAttr.setValue(child.getInheritedAttribute('x'))
      }

      if (!yAttr.hasValue()) {
        yAttr.setValue(child.getInheritedAttribute('y'))
      }

      if (!dxAttr.hasValue()) {
        dxAttr.setValue(child.getInheritedAttribute('dx'))
      }

      if (!dyAttr.hasValue()) {
        dyAttr.setValue(child.getInheritedAttribute('dy'))
      }
    }

    const width = child.measureText(ctx)

    if (isRTL) {
      textParent.x -= width
    }

    if (xAttr.hasValue()) {
      // an "x" attribute marks the start of a new chunk
      textParent.applyAnchoring()

      child.x = xAttr.getPixels('x')

      if (dxAttr.hasValue()) {
        child.x += dxAttr.getPixels('x')
      }
    } else {
      if (dxAttr.hasValue()) {
        textParent.x += dxAttr.getPixels('x')
      }

      child.x = textParent.x
    }

    textParent.x = child.x

    if (!isRTL) {
      textParent.x += width
    }

    if (yAttr.hasValue()) {
      child.y = yAttr.getPixels('y')

      if (dyAttr.hasValue()) {
        child.y += dyAttr.getPixels('y')
      }
    } else {
      if (dyAttr.hasValue()) {
        textParent.y += dyAttr.getPixels('y')
      }

      child.y = textParent.y
    }

    textParent.y = child.y

    // update the current chunk and it's bounds
    textParent.leafTexts.push(child)
    textParent.minX = Math.min(textParent.minX, child.x, child.x + width)
    textParent.maxX = Math.max(textParent.maxX, child.x, child.x + width)

    child.clearContext(ctx)
    ctx.restore()

    return child
  }

  protected getChildBoundingBox(
    ctx: RenderingContext2D,
    textParent: TextElement,
    parent: Element,
    i: number
  ) {
    const child = parent.children[i] as TextElement

    // not a text node?
    if (typeof child.getBoundingBox !== 'function') {
      return null
    }

    const boundingBox = child.getBoundingBox(ctx)

    if (boundingBox) {
      child.children.forEach((_, i) => {
        const childBoundingBox = textParent.getChildBoundingBox(ctx, textParent, child, i)

        boundingBox.addBoundingBox(childBoundingBox)
      })
    }

    return boundingBox
  }

  protected renderChild(
    ctx: RenderingContext2D,
    textParent: TextElement,
    parent: Element,
    i: number
  ) {
    const child = parent.children[i] as TextElement

    child.render(ctx)
    child.children.forEach((_, i) => {
      textParent.renderChild(ctx, textParent, child, i)
    })
  }

  /**
   * Reads a whitespace/comma separated list of lengths. Positional lists are
   * passed on from a parent to its first child (see
   * {@link adjustChildCoordinates}), which does not copy the attribute itself,
   * so the inherited value is read here as a fallback.
   * @param name - The attribute name.
   * @returns The list of resolved pixel values.
   */
  protected getPositionList(name: string): number[] {
    const attribute = this.getAttribute(name)
    const source = attribute.hasValue()
      ? attribute.getString()
      : this.getInheritedAttribute(name)

    if (!source) {
      return []
    }

    const axis: Axis = name === 'y' || name === 'dy'
      ? 'y'
      : 'x'
    const value = compressSpaces(source.replace(/,/g, ' ')).trim()

    if (!value) {
      return []
    }

    return value.split(/\s+/).map(length => new Property(
      this.document,
      name,
      length
    ).getPixels(axis))
  }

  /**
   * Text length attributes are inherited from {@link TextElement} ancestors
   * (e.g. `textLength` on `<text>` applies to its text content).
   * @param name - The attribute name.
   * @returns The attribute value or an empty property.
   */
  protected getInheritedTextAttribute(name: string): Property {
    // eslint-disable-next-line @typescript-eslint/no-this-alias,consistent-this
    let current: Element | null = this

    while (current) {
      if (current instanceof TextElement) {
        const attribute = current.getAttribute(name)

        if (attribute.hasValue(true)) {
          return attribute
        }
      }

      current = current.parent
    }

    return Property.empty(this.document)
  }

  protected getLetterSpacing() {
    const letterSpacing = this.getStyle('letter-spacing')

    if (!letterSpacing.hasValue()) {
      return 0
    }

    const value = letterSpacing.getPixels()

    return isNaN(value) ? 0 : value
  }

  private getTextMetricsKey(ctx: RenderingContext2D, customFont: FontElement | undefined) {
    return [
      ctx.font,
      this.resolvedFontSize,
      this.getText(),
      this.getAttribute('x').getString(),
      this.getAttribute('y').getString(),
      this.getAttribute('dx').getString(),
      this.getAttribute('dy').getString(),
      this.getInheritedTextAttribute('textLength').getString(),
      this.getInheritedTextAttribute('lengthAdjust').getString(),
      this.getStyle('letter-spacing').getString(),
      this.getStyle('font-family').getString(),
      customFont ? `${customFont.fontFace?.unitsPerEm}:${customFont.horizAdvX}` : 'canvas'
    ].join('|')
  }

  /**
   * Returns lazily built glyph metrics for the current text and font context.
   * The cache is keyed by the font (family/size), the text and the positional
   * attributes, so changing any of them invalidates the measurement.
   * @param ctx - The rendering context.
   * @returns The metrics of the text run.
   */
  protected getTextMetrics(ctx: RenderingContext2D): ITextMetrics {
    ctx.save()
    this.setContext(ctx, true)

    const customFont = this.getStyle('font-family').getDefinition<FontElement>()
    const key = this.getTextMetricsKey(ctx, customFont)
    let metrics = this.textMetricsCache

    if (!metrics || metrics.key !== key) {
      metrics = this.computeTextMetrics(ctx, key, customFont)
      this.textMetricsCache = metrics
    }

    this.clearContext(ctx)
    ctx.restore()

    return metrics
  }

  private computeTextMetrics(
    ctx: RenderingContext2D,
    key: string,
    customFont: FontElement | undefined
  ): ITextMetrics {
    const renderText = this.getText()
    const text = customFont?.isRTL
      ? renderText.split('').reverse().join('')
      : renderText
    const chars = text.split('')
    const length = chars.length
    const fontSize = this.getFontSize()
    const xList = this.getPositionList('x')
    const yList = this.getPositionList('y')
    const dxList = this.getPositionList('dx')
    const dyList = this.getPositionList('dy')
    const letterSpacing = this.getLetterSpacing()
    const textLengthAttr = this.getInheritedTextAttribute('textLength')
    const textLength = textLengthAttr.hasValue()
      ? textLengthAttr.getPixels('x')
      : null
    const lengthAdjust = this.getInheritedTextAttribute('lengthAdjust')
      .getString('spacing')

    if (!length) {
      return {
        key,
        glyphs: [],
        total: 0,
        scaleX: 1,
        text,
        customFont,
        perGlyph: false
      }
    }

    const widths: number[] = []

    if (customFont) {
      const unitsPerEm = customFont.fontFace?.unitsPerEm || 1

      for (let i = 0; i < length; i++) {
        const glyph = this.getGlyph(customFont, text, i)

        widths.push(
          (glyph?.horizAdvX || customFont.horizAdvX || 0)
          * fontSize
          / unitsPerEm
        )
      }
    } else if (ctx.measureText) {
      // Measure cumulatively so that the sum of the glyph widths is exactly
      // the width of the whole run (kerning included).
      let previous = 0

      for (let i = 0; i < length; i++) {
        const measured = ctx.measureText(text.slice(0, i + 1)).width

        widths.push(Math.max(measured - previous, 0))
        previous = measured
      }
    } else {
      for (let i = 0; i < length; i++) {
        widths.push(10)
      }
    }

    const naturalWidth = widths.reduce((sum, width) => sum + width, 0)
    const fullWidth = customFont || !ctx.measureText
      ? naturalWidth
      : ctx.measureText(text).width
    const gapCount = length - 1
    const dxSum = dxList.reduce(
      (sum, dx, i) => (i === 0 ? sum : sum + dx),
      0
    )
    // Advance of the run, excluding the (already applied) first `dx`.
    const naturalTotal = naturalWidth + letterSpacing * gapCount + dxSum
    let scaleX = 1
    let spacing = letterSpacing

    if (textLength !== null && isFinite(textLength)) {
      const targetLength = Math.max(textLength, 0)

      if (lengthAdjust === 'spacingAndGlyphs' && naturalTotal > 0) {
        scaleX = targetLength / naturalTotal
        spacing = letterSpacing * scaleX
      } else if (gapCount > 0) {
        spacing += (targetLength - naturalTotal) / gapCount
      }
    }

    const glyphs: IGlyphMetrics[] = chars.map((char, i) => ({
      char,
      index: i,
      width: widths[i] * scaleX,
      spacingAfter: i < gapCount
        ? spacing
        : 0,
      xOffset: i < xList.length
        ? xList[i] - xList[0]
        : null,
      yOffset: i < yList.length
        ? yList[i] - yList[0]
        : null,
      dx: typeof dxList[i] === 'number' && !isNaN(dxList[i])
        ? dxList[i]
        : 0,
      dy: typeof dyList[i] === 'number' && !isNaN(dyList[i])
        ? dyList[i]
        : 0
    }))
    const perGlyph = Boolean(customFont)
      || textLength !== null
      || scaleX !== 1
      || xList.length > 1
      || yList.length > 1
      || dxList.length > 1
      || dyList.length > 1
      || (gapCount > 0 && spacing !== 0)

    if (!perGlyph) {
      // Keep the whole run measured at once, exactly as the canvas does it.
      return {
        key,
        glyphs,
        total: fullWidth,
        scaleX,
        text,
        customFont,
        perGlyph
      }
    }

    // Simulate the layout to find the total advance.
    let cursor = 0
    let maxX = 0
    let lastIndex = -1

    for (const glyph of glyphs) {
      if (glyph.xOffset !== null && glyph.index > 0) {
        cursor = glyph.xOffset
      }

      cursor += glyph.dx
      cursor += glyph.width
      maxX = Math.max(maxX, cursor)
      cursor += glyph.spacingAfter
      lastIndex = glyph.index
    }

    // The first `dx` was already applied to the element's `x`.
    const total = lastIndex < 0
      ? 0
      : Math.max(maxX - glyphs[0].dx, 0)

    return {
      key,
      glyphs,
      total,
      scaleX,
      text,
      customFont,
      perGlyph
    }
  }

  protected measureText(ctx: RenderingContext2D) {
    return this.getTextMetrics(ctx).total
  }

  protected measureTargetText(
    ctx: RenderingContext2D,
    targetText: string
  ) {
    if (!targetText.length) {
      return 0
    }

    const { parent } = this
    const customFont = parent.getStyle('font-family').getDefinition<FontElement>()

    if (customFont) {
      const fontSize = this.getFontSize()
      const text = customFont.isRTL
        ? targetText.split('').reverse().join('')
        : targetText
      const dx = this.getPositionList('dx')
      const len = text.length
      let measure = 0

      for (let i = 0; i < len; i++) {
        const glyph = this.getGlyph(customFont, text, i)

        measure += (glyph.horizAdvX || customFont.horizAdvX)
          * fontSize
          / customFont.fontFace.unitsPerEm

        if (typeof dx[i] !== 'undefined' && !isNaN(dx[i])) {
          measure += dx[i]
        }
      }

      return measure
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!ctx.measureText) {
      return targetText.length * 10
    }

    ctx.save()
    this.setContext(ctx, true)

    const { width: measure } = ctx.measureText(targetText)

    this.clearContext(ctx)
    ctx.restore()

    return measure
  }

  /**
   * Inherits positional attributes from {@link TextElement} parent(s). Attributes
   * are only inherited from a parent to its first child.
   * @param name - The attribute name.
   * @returns The attribute value or null.
   */
  protected getInheritedAttribute(name: string): string | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias,consistent-this
    let current: Element | null = this

    while (current instanceof TextElement && current.isFirstChild() && current.parent) {
      const parentAttr = current.parent.getAttribute(name)

      if (parentAttr.hasValue(true)) {
        return parentAttr.getString('0')
      }

      current = current.parent
    }

    return null
  }
}
