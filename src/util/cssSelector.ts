/**
 * Minimal CSS selector engine used when the host DOM doesn't provide `Element.matches`
 * (e.g. `@xmldom/xmldom`).
 *
 * Supported: type/universal selectors, `#id`, `.class`, attribute selectors,
 * descendant/child/adjacent/general sibling combinators, `:not()`, `:is()`,
 * `:where()` and the structural pseudo-classes commonly used in SVG.
 * Dynamic pseudo-classes (`:hover`, `:focus`, ...) never match, as expected for static rendering.
 */

interface IAttributeSelector {
  name: string
  operator: string | null
  value: string | null
  caseInsensitive: boolean
}

interface IPseudoClassSelector {
  name: string
  argument: string | null
}

interface ICompoundSelector {
  type: string | null
  ids: string[]
  classes: string[]
  attributes: IAttributeSelector[]
  pseudoClasses: IPseudoClassSelector[]
  pseudoElement: boolean
}

interface IComplexSelector {
  // left-to-right compounds
  compounds: ICompoundSelector[]
  // combinators[i] is between compounds[i] and compounds[i + 1]
  combinators: string[]
}

const selectorCache: Map<string, IComplexSelector | null> = new Map()

function isWhitespace(char: string) {
  return /\s/.test(char)
}

function isIdentifierChar(char: string) {
  return /[-\w -￿]/.test(char)
}

function readIdentifier(selector: string, start: number): [string, number] {
  let end = start

  while (end < selector.length) {
    const char = selector[end]

    if (char === '\\' && end + 1 < selector.length) {
      end += 2
      continue
    }

    if (!isIdentifierChar(char)) {
      break
    }

    end++
  }

  if (end === start) {
    return ['', start]
  }

  return [
    selector.slice(start, end).replace(/\\(.)/g, '$1'),
    end
  ]
}

function readQuoted(selector: string, start: number): [string, number] | null {
  const quote = selector[start]

  if (quote !== '"' && quote !== '\'') {
    return null
  }

  let end = start + 1
  let value = ''

  while (end < selector.length) {
    const char = selector[end]

    if (char === '\\' && end + 1 < selector.length) {
      value += selector[end + 1]
      end += 2
      continue
    }

    if (char === quote) {
      return [value, end + 1]
    }

    value += char
    end++
  }

  return null
}

function readBalanced(selector: string, start: number): [string, number] | null {
  // selector[start] must be '('
  let depth = 0
  let end = start

  while (end < selector.length) {
    const char = selector[end]

    if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--

      if (depth === 0) {
        return [selector.slice(start + 1, end), end + 1]
      }
    } else if (char === '"' || char === '\'') {
      const quoted = readQuoted(selector, end)

      if (!quoted) {
        return null
      }

      end = quoted[1]
      continue
    }

    end++
  }

  return null
}

function parseAttributeSelector(selector: string, start: number): [IAttributeSelector, number] | null {
  // selector[start] must be '['
  let i = start + 1
  const length = selector.length

  while (i < length && isWhitespace(selector[i])) {
    i++
  }

  let name = ''

  // optional namespace: `ns|name`, `*|name` or `|name`
  if (selector[i] === '*') {
    i++
    if (selector[i] === '|') {
      i++
    }
  } else if (selector[i] === '|') {
    i++
  } else {
    const [prefix, next] = readIdentifier(selector, i)

    if (!prefix) {
      return null
    }

    if (selector[next] === '|' && selector[next + 1] !== '=') {
      name = ''
      i = next + 1
    } else {
      name = prefix
      i = next
    }
  }

  if (!name) {
    const [localName, next] = readIdentifier(selector, i)

    if (!localName) {
      return null
    }

    name = localName
    i = next
  }

  while (i < length && isWhitespace(selector[i])) {
    i++
  }

  if (i >= length) {
    return null
  }

  if (selector[i] === ']') {
    return [{
      name,
      operator: null,
      value: null,
      caseInsensitive: false
    }, i + 1]
  }

  let operator = selector[i]

  if (operator === '~' || operator === '|' || operator === '^' || operator === '$' || operator === '*') {
    if (selector[i + 1] !== '=') {
      return null
    }

    operator += '='
    i += 2
  } else if (operator === '=') {
    i++
  } else {
    return null
  }

  while (i < length && isWhitespace(selector[i])) {
    i++
  }

  let value: string
  const quoted = readQuoted(selector, i)

  if (quoted) {
    value = quoted[0]
    i = quoted[1]
  } else {
    const [unquoted, next] = readIdentifier(selector, i)

    if (!unquoted) {
      return null
    }

    value = unquoted
    i = next
  }

  while (i < length && isWhitespace(selector[i])) {
    i++
  }

  let caseInsensitive = false

  if (selector[i] === 'i' || selector[i] === 'I') {
    caseInsensitive = true
    i++
  } else if (selector[i] === 's' || selector[i] === 'S') {
    i++
  }

  while (i < length && isWhitespace(selector[i])) {
    i++
  }

  if (selector[i] !== ']') {
    return null
  }

  return [{
    name,
    operator,
    value,
    caseInsensitive
  }, i + 1]
}

function parseCompoundSelector(selector: string, start: number): [ICompoundSelector, number] | null {
  const compound: ICompoundSelector = {
    type: null,
    ids: [],
    classes: [],
    attributes: [],
    pseudoClasses: [],
    pseudoElement: false
  }
  const length = selector.length
  let i = start
  let consumed = false

  while (i < length) {
    const char = selector[i]

    if (isWhitespace(char) || char === '>' || char === '+' || char === '~' || char === ',') {
      break
    }

    if (char === '*') {
      if (consumed) {
        return null
      }

      if (selector[i + 1] === '|') {
        // `*|name` - any namespace
        i += 2
        const [name, next] = readIdentifier(selector, i)

        if (!name) {
          return null
        }

        compound.type = name
        i = next
      } else {
        compound.type = '*'
        i++
      }

      consumed = true
      continue
    }

    if (char === '#') {
      const [id, next] = readIdentifier(selector, i + 1)

      if (!id) {
        return null
      }

      compound.ids.push(id)
      i = next
      consumed = true
      continue
    }

    if (char === '.') {
      const [className, next] = readIdentifier(selector, i + 1)

      if (!className) {
        return null
      }

      compound.classes.push(className)
      i = next
      consumed = true
      continue
    }

    if (char === '[') {
      const attribute = parseAttributeSelector(selector, i)

      if (!attribute) {
        return null
      }

      compound.attributes.push(attribute[0])
      i = attribute[1]
      consumed = true
      continue
    }

    if (char === ':') {
      let pseudoElement = false

      i++

      if (selector[i] === ':') {
        pseudoElement = true
        i++
      }

      const [name, next] = readIdentifier(selector, i)

      if (!name) {
        return null
      }

      i = next

      if (pseudoElement) {
        compound.pseudoElement = true

        if (selector[i] === '(') {
          const balanced = readBalanced(selector, i)

          if (!balanced) {
            return null
          }

          i = balanced[1]
        }

        consumed = true
        continue
      }

      let argument: string | null = null

      if (selector[i] === '(') {
        const balanced = readBalanced(selector, i)

        if (!balanced) {
          return null
        }

        argument = balanced[0]
        i = balanced[1]
      }

      compound.pseudoClasses.push({
        name: name.toLowerCase(),
        argument
      })
      consumed = true
      continue
    }

    if (!consumed) {
      // type selector, optionally namespaced
      if (char === '|') {
        i++
        const [name, next] = readIdentifier(selector, i)

        if (!name) {
          return null
        }

        compound.type = name
        i = next
        consumed = true
        continue
      }

      const [prefix, next] = readIdentifier(selector, i)

      if (!prefix) {
        return null
      }

      if (selector[next] === '|' && selector[next + 1] !== '=') {
        i = next + 1
        const [name, afterName] = readIdentifier(selector, i)

        if (!name) {
          return null
        }

        compound.type = name
        i = afterName
      } else {
        compound.type = prefix
        i = next
      }

      consumed = true
      continue
    }

    return null
  }

  if (!consumed) {
    return null
  }

  return [compound, i]
}

function parseComplexSelector(selector: string): IComplexSelector | null {
  const compounds: ICompoundSelector[] = []
  const combinators: string[] = []
  const length = selector.length
  let i = 0

  while (i < length) {
    let sawSpace = false

    while (i < length && isWhitespace(selector[i])) {
      sawSpace = true
      i++
    }

    if (i >= length) {
      break
    }

    let combinator: string | null = null

    if (selector[i] === '>' || selector[i] === '+' || selector[i] === '~') {
      combinator = selector[i]
      i++

      while (i < length && isWhitespace(selector[i])) {
        i++
      }

      if (!compounds.length) {
        return null
      }
    } else if (compounds.length) {
      if (!sawSpace) {
        return null
      }

      combinator = ' '
    }

    const parsed = parseCompoundSelector(selector, i)

    if (!parsed) {
      return null
    }

    if (combinator !== null) {
      combinators.push(combinator)
    }

    compounds.push(parsed[0])
    i = parsed[1]
  }

  if (!compounds.length || combinators.length !== compounds.length - 1) {
    return null
  }

  return {
    compounds,
    combinators
  }
}

function getComplexSelector(selector: string) {
  if (selectorCache.has(selector)) {
    return selectorCache.get(selector)
  }

  const parsed = parseComplexSelector(selector.trim())

  selectorCache.set(selector, parsed)

  return parsed
}

function splitSelectorList(selector: string) {
  const selectors: string[] = []
  let depth = 0
  let start = 0

  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]

    if (char === '(' || char === '[') {
      depth++
    } else if (char === ')' || char === ']') {
      depth--
    } else if (char === ',' && depth === 0) {
      selectors.push(selector.slice(start, i).trim())
      start = i + 1
    }
  }

  selectors.push(selector.slice(start).trim())

  return selectors.filter(_ => _)
}

function getLocalName(node: any) {
  const name: string = node.localName || node.nodeName || ''

  return name.replace(/^[^:]+:/, '')
}

function getParentElement(node: any) {
  const parent = node.parentNode

  return parent && parent.nodeType === 1
    ? parent
    : null
}

function getElementSiblings(node: any) {
  const parent = node.parentNode

  if (!parent || !parent.childNodes) {
    return [node]
  }

  return Array.from(parent.childNodes as ArrayLike<any>)
    .filter(child => child.nodeType === 1)
}

function getElementIndex(node: any) {
  return getElementSiblings(node).indexOf(node)
}

function getPreviousElementSibling(node: any) {
  const siblings = getElementSiblings(node)
  const index = siblings.indexOf(node)

  return index > 0
    ? siblings[index - 1]
    : null
}

function getSiblingsOfSameType(node: any) {
  const name = getLocalName(node)

  return getElementSiblings(node)
    .filter(sibling => getLocalName(sibling) === name)
}

function getAttribute(node: any, name: string): string | null {
  if (typeof node.hasAttribute === 'function') {
    return node.hasAttribute(name)
      ? node.getAttribute(name)
      : null
  }

  if (typeof node.getAttribute !== 'function') {
    // not a real DOM element (e.g. canvg's internal fake nodes)
    return null
  }

  const value = node.getAttribute(name)

  return value === null || typeof value === 'undefined'
    ? null
    : value
}

function getClassList(node: any) {
  const value = getAttribute(node, 'class')

  return value
    ? value.split(/\s+/).filter(_ => _)
    : []
}

function matchesAttribute(node: any, attribute: IAttributeSelector) {
  const value = getAttribute(node, attribute.name)

  if (value === null) {
    return false
  }

  if (!attribute.operator) {
    return true
  }

  const expected = attribute.caseInsensitive
    ? (attribute.value || '').toLowerCase()
    : attribute.value || ''
  const actual = attribute.caseInsensitive
    ? value.toLowerCase()
    : value

  switch (attribute.operator) {
    case '=':
      return actual === expected

    case '~=':
      return expected !== '' && actual.split(/\s+/).includes(expected)

    case '|=':
      return actual === expected || actual.startsWith(`${expected}-`)

    case '^=':
      return expected !== '' && actual.startsWith(expected)

    case '$=':
      return expected !== '' && actual.endsWith(expected)

    case '*=':
      return expected !== '' && actual.includes(expected)

    default:
      return false
  }
}

function parseNth(argument: string | null): [number, number] | null {
  if (argument === null) {
    return null
  }

  const value = argument.replace(/\s+/g, '').toLowerCase()

  if (value === 'odd') {
    return [2, 1]
  }

  if (value === 'even') {
    return [2, 0]
  }

  if (/^[+-]?\d+$/.test(value)) {
    return [0, parseInt(value, 10)]
  }

  const match = /^([+-]?\d*)n([+-]\d+)?$/.exec(value)

  if (!match) {
    return null
  }

  let a = 1

  if (match[1] === '-') {
    a = -1
  } else if (match[1] && match[1] !== '+') {
    a = parseInt(match[1], 10)
  }

  const b = match[2]
    ? parseInt(match[2], 10)
    : 0

  return [a, b]
}

function matchesNth(index: number, argument: string | null) {
  const nth = parseNth(argument)

  if (!nth) {
    return false
  }

  // index is 0-based here, `an+b` is 1-based
  const position = index + 1
  const [a, b] = nth

  if (a === 0) {
    return position === b
  }

  const n = (position - b) / a

  return Number.isInteger(n) && n >= 0
}

function matchesSelectorList(node: any, selector: string) {
  return splitSelectorList(selector).some(_ => matchesSelector(node, _))
}

function matchesPseudoClass(node: any, pseudo: IPseudoClassSelector) {
  switch (pseudo.name) {
    case 'root':
      return node.ownerDocument
        ? node.ownerDocument.documentElement === node
        : !node.parentNode

    case 'first-child':
      return getElementIndex(node) === 0

    case 'last-child': {
      const siblings = getElementSiblings(node)

      return siblings.indexOf(node) === siblings.length - 1
    }

    case 'only-child':
      return getElementSiblings(node).length === 1

    case 'nth-child':
      return matchesNth(getElementIndex(node), pseudo.argument)

    case 'nth-last-child': {
      const siblings = getElementSiblings(node)

      return matchesNth(siblings.length - 1 - siblings.indexOf(node), pseudo.argument)
    }

    case 'first-of-type':
      return getSiblingsOfSameType(node).indexOf(node) === 0

    case 'last-of-type': {
      const siblings = getSiblingsOfSameType(node)

      return siblings.indexOf(node) === siblings.length - 1
    }

    case 'only-of-type':
      return getSiblingsOfSameType(node).length === 1

    case 'nth-of-type':
      return matchesNth(getSiblingsOfSameType(node).indexOf(node), pseudo.argument)

    case 'nth-last-of-type': {
      const siblings = getSiblingsOfSameType(node)

      return matchesNth(siblings.length - 1 - siblings.indexOf(node), pseudo.argument)
    }

    case 'not':
      return pseudo.argument !== null && !matchesSelectorList(node, pseudo.argument)

    case 'is':
    case 'matches':
    case 'where':
      return pseudo.argument !== null && matchesSelectorList(node, pseudo.argument)

    default:
      // dynamic pseudo-classes (`:hover`, `:focus`, ...) never match static content
      return false
  }
}

function matchesCompoundSelector(node: any, compound: ICompoundSelector) {
  if (compound.pseudoElement) {
    return false
  }

  if (compound.type && compound.type !== '*') {
    const nodeName = getLocalName(node)

    if (nodeName !== compound.type && nodeName.toLowerCase() !== compound.type.toLowerCase()) {
      return false
    }
  }

  if (compound.ids.length) {
    const id = getAttribute(node, 'id')

    if (id === null || !compound.ids.every(_ => _ === id)) {
      return false
    }
  }

  if (compound.classes.length) {
    const classList = getClassList(node)

    if (!compound.classes.every(className => classList.includes(className))) {
      return false
    }
  }

  if (!compound.attributes.every(attribute => matchesAttribute(node, attribute))) {
    return false
  }

  return compound.pseudoClasses.every(pseudo => matchesPseudoClass(node, pseudo))
}

function matchesAt(node: any, index: number, selector: IComplexSelector): boolean {
  if (!matchesCompoundSelector(node, selector.compounds[index])) {
    return false
  }

  if (index === 0) {
    return true
  }

  switch (selector.combinators[index - 1]) {
    case '>': {
      const parent = getParentElement(node)

      return parent !== null && matchesAt(parent, index - 1, selector)
    }

    case ' ': {
      let parent = getParentElement(node)

      while (parent) {
        if (matchesAt(parent, index - 1, selector)) {
          return true
        }

        parent = getParentElement(parent)
      }

      return false
    }

    case '+': {
      const sibling = getPreviousElementSibling(node)

      return sibling !== null && matchesAt(sibling, index - 1, selector)
    }

    case '~': {
      let sibling = getPreviousElementSibling(node)

      while (sibling) {
        if (matchesAt(sibling, index - 1, selector)) {
          return true
        }

        sibling = getPreviousElementSibling(sibling)
      }

      return false
    }

    default:
      return false
  }
}

/**
 * Check whether a DOM node matches a CSS selector.
 * @param node - DOM node to check.
 * @param selector - CSS selector.
 * @returns Whether the node matches.
 */
export function matchesSelector(node: any, selector: string) {
  if (!node || node.nodeType !== 1) {
    return false
  }

  const parsed = getComplexSelector(selector)

  if (!parsed) {
    return false
  }

  return matchesAt(node, parsed.compounds.length - 1, parsed)
}
