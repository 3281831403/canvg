/* eslint-disable @typescript-eslint/no-use-before-define */
import {
  compressSpaces,
  getSelectorSpecificityParts,
  parseExternalUrl,
  Specificity,
  toSpecificityWeight
} from '../util'
import { Canvg } from '../Canvg'
import { IScreenViewBoxConfig, Screen } from '../Screen'
import { Property } from '../Property'
import { SVGFontLoader } from '../SVGFontLoader'
import { Element } from './Element'
import { UnknownElement } from './UnknownElement'
import { TextNode } from './TextNode'
import { ImageElement } from './ImageElement'
import { SVGElement } from './SVGElement'
import {
  AnyElement,
  elements as elementTypes
} from './elements'

/**
 * Function to create new canvas.
 */
export type CreateCanvas = (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas & {
  getContext(contextId: '2d'): OffscreenCanvasRenderingContext2D
}

/**
 * Function to create new image.
 */
export type CreateImage = (src: string, anonymousCrossOrigin?: boolean) => Promise<CanvasImageSource>

export interface IDocumentOptions {
  /**
   * Default `rem` size.
   */
  rootEmSize?: number
  /**
   * Default `em` size.
   */
  emSize?: number
  /**
   * Function to create new canvas.
   */
  createCanvas?: CreateCanvas
  /**
   * Function to create new image.
   */
  createImage?: CreateImage
  /**
   * Load images anonymously.
   */
  anonymousCrossOrigin?: boolean
}

export type IViewBoxConfig = Omit<IScreenViewBoxConfig, 'document'>

type DOMDocument = typeof window.document

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height

  return canvas
}

async function createImage(src: string, anonymousCrossOrigin = false) {
  const image = document.createElement('img')

  if (anonymousCrossOrigin) {
    image.crossOrigin = 'Anonymous'
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => {
      resolve(image)
    }

    image.onerror = (_event, _source, _lineno, _colno, error) => {
      reject(error)
    }

    image.src = src
  })
}

const DEFAULT_EM_SIZE = 12

/**
 * A single declaration of a style sheet rule.
 */
export interface IStyleDeclaration {
  /**
   * Declaration order across all style sheets (used as tie-breaker).
   */
  order: number
  /**
   * Specificity weight of the selector.
   */
  specificity: string
  /**
   * Specificity parts of the selector.
   */
  specificityParts: Specificity
  /**
   * Whether the declaration is marked as `!important`.
   */
  important: boolean
  /**
   * Property name.
   */
  name: string
  /**
   * Property value.
   */
  value: string
}

/**
 * A single style sheet rule.
 */
export interface IStyleRule {
  /**
   * Selector text.
   */
  selector: string
  /**
   * Declarations belonging to the rule.
   */
  declarations: IStyleDeclaration[]
}

export class Document {
  static readonly createCanvas = createCanvas
  static readonly createImage = createImage
  static readonly elementTypes: Record<string, AnyElement> = elementTypes

  rootEmSize: number
  documentElement?: SVGElement
  readonly screen: Screen
  readonly createCanvas: CreateCanvas
  readonly createImage: CreateImage
  readonly definitions: Map<string, Element> = new Map()
  /**
   * Style sheet rules in document order.
   */
  readonly styleRules: IStyleRule[] = []
  readonly images: ImageElement[] = []
  readonly fonts: SVGFontLoader[] = []
  private readonly emSizeStack: number[] = []
  private readonly parsedStyleSheets: Set<HTMLElement> = new Set()
  private styleDeclarationOrder = 0
  private uniqueId = 0

  constructor(
    readonly canvg: Canvg,
    {
      rootEmSize = DEFAULT_EM_SIZE,
      emSize = DEFAULT_EM_SIZE,
      createCanvas = Document.createCanvas,
      createImage = Document.createImage,
      anonymousCrossOrigin
    }: IDocumentOptions = {}
  ) {
    this.screen = canvg.screen
    this.rootEmSize = rootEmSize
    this.emSize = emSize
    this.createCanvas = createCanvas
    this.createImage = this.bindCreateImage(createImage, anonymousCrossOrigin)

    this.screen.wait(() => this.isImagesLoaded())
    this.screen.wait(() => this.isFontsLoaded())
  }

  private bindCreateImage(createImage: CreateImage, anonymousCrossOrigin?: boolean) {
    if (typeof anonymousCrossOrigin === 'boolean') {
      return (source: string, forceAnonymousCrossOrigin?: boolean) => createImage(
        source,
        typeof forceAnonymousCrossOrigin === 'boolean'
          ? forceAnonymousCrossOrigin
          : anonymousCrossOrigin
      )
    }

    return createImage
  }

  get window() {
    return this.screen.window
  }

  get fetch() {
    return this.screen.fetch
  }

  get ctx() {
    return this.screen.ctx
  }

  get emSize() {
    const { emSizeStack } = this

    return emSizeStack[emSizeStack.length - 1] || DEFAULT_EM_SIZE
  }

  set emSize(value: number) {
    const { emSizeStack } = this

    emSizeStack.push(value)
  }

  popEmSize() {
    const { emSizeStack } = this

    emSizeStack.pop()
  }

  getUniqueId() {
    return `canvg${++this.uniqueId}`
  }

  isImagesLoaded() {
    return this.images.every(_ => _.loaded)
  }

  isFontsLoaded() {
    return this.fonts.every(_ => _.loaded)
  }

  createDocumentElement(document: DOMDocument) {
    // collect all style sheets up front, so the position of the `<style>`
    // elements within the document doesn't matter
    this.parseStyleSheets(document)

    const documentElement = this.createElement<SVGElement>(document.documentElement)

    documentElement.root = true
    documentElement.addStylesFromStyleDefinition()

    this.documentElement = documentElement

    return documentElement
  }

  /**
   * Parse every `<style>` element found under the given root node into
   * {@link Document.styleRules}. Each style sheet is parsed only once.
   * @param root - Root DOM node (usually the parsed document).
   */
  parseStyleSheets(root: unknown) {
    if (!root || typeof (root as DOMDocument).getElementsByTagName !== 'function') {
      return
    }

    const styleNodes = Array.from(
      (root as DOMDocument).getElementsByTagName('style')
    ) as HTMLElement[]

    styleNodes.forEach((node) => {
      if (this.parsedStyleSheets.has(node)) {
        return
      }

      this.parsedStyleSheets.add(node)
      this.parseStyleSheet(node)
    })
  }

  private parseStyleSheet(node: HTMLElement) {
    const css = compressSpaces(
      Array.from(node.childNodes)
        .map(_ => _.textContent)
        .join('')
        .replace(/(\/\*([^*]|[\r\n]|(\*+([^*/]|[\r\n])))*\*+\/)|(^[\s]*\/\/.*)/gm, '') // remove comments
        .replace(/@import.*;/g, '') // remove imports
    )
    const cssDefs = css.split('}')

    cssDefs.forEach((_) => {
      const def = _.trim()

      if (!def) {
        return
      }

      const cssParts = def.split('{')
      const cssClasses = cssParts[0].split(',')
      const cssProps = (cssParts[1] || '').split(';')

      cssClasses.forEach((_) => {
        const cssClass = _.trim()

        if (!cssClass) {
          return
        }

        const declarations: IStyleDeclaration[] = []

        cssProps.forEach((cssProp) => {
          const prop = cssProp.indexOf(':')
          const name = cssProp.substr(0, prop).trim()
          let value = cssProp.substr(prop + 1, cssProp.length - prop).trim()

          if (!name || !value) {
            return
          }

          let important = false
          const importantMatch = /!important\s*$/.exec(value)

          if (importantMatch) {
            important = true
            value = value.slice(0, value.length - importantMatch[0].length).trim()
          }

          if (!value) {
            return
          }

          const specificityParts = getSelectorSpecificityParts(cssClass)

          declarations.push({
            order: ++this.styleDeclarationOrder,
            specificity: toSpecificityWeight(specificityParts),
            specificityParts,
            important,
            name,
            value
          })
        })

        if (cssClass === '@font-face') {
          this.loadFontFace(declarations)
          return
        }

        if (declarations.length) {
          this.styleRules.push({
            selector: cssClass,
            declarations
          })
        }
      })
    })
  }

  private loadFontFace(declarations: IStyleDeclaration[]) {
    const props = new Map<string, Property>()

    declarations.forEach((declaration) => {
      props.set(declaration.name, new Property(this, declaration.name, declaration.value))
    })

    const fontFamilyProp = props.get('font-family')
    const srcProp = props.get('src')

    if (!fontFamilyProp || !srcProp) {
      return
    }

    const fontFamily = fontFamilyProp.getString().replace(/"|'/g, '')
    const srcs = srcProp.getString().split(',')

    srcs.forEach((src) => {
      if (src.indexOf('format("svg")') > 0) {
        const url = parseExternalUrl(src)

        if (url) {
          void new SVGFontLoader(this).load(fontFamily, url)
        }
      }
    })
  }

  createElement<T extends Element>(node: HTMLElement) {
    const elementType = node.nodeName.replace(/^[^:]+:/, '')
    const ElementType = Document.elementTypes[elementType]

    if (ElementType) {
      return new ElementType(this, node) as T
    }

    return new UnknownElement(this, node) as T
  }

  createTextNode(node: HTMLElement) {
    return new TextNode(this, node)
  }

  setViewBox(config: IViewBoxConfig) {
    this.screen.setViewBox({
      document: this,
      ...config
    })
  }
}
