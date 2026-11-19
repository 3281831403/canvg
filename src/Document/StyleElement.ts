import { parseExternalUrl } from '../util'
import { Document } from './Document'
import { Element } from './Element'

/**
 * `<style>` element.
 *
 * Style sheets are collected and parsed by the document before any element is
 * created (see `Document.parseStyleSheets`), so the position of the `<style>`
 * element within the SVG doesn't matter.
 */
export class StyleElement extends Element {
  static readonly parseExternalUrl = parseExternalUrl

  override type = 'style'

  constructor(
    document: Document,
    node: HTMLElement,
    captureTextNodes?: boolean
  ) {
    super(document, node, captureTextNodes)

    // style sheets are normally parsed in advance by the document; this is a
    // safety net for elements created outside `Document.createDocumentElement`
    document.parseStyleSheets(node.ownerDocument)
  }
}
