
// slightly modified version of https://github.com/keeganstreet/specificity/blob/master/specificity.js
const attributeRegex = /(\[[^\]]+\])/g
const idRegex = /(#[^\s+>~.[:]+)/g
const classRegex = /(\.[^\s+>~.[:]+)/g
const pseudoElementRegex = /(::[^\s+>~.[:]+|:first-line|:first-letter|:before|:after)/gi
const pseudoClassWithBracketsRegex = /(:[\w-]+\([^)]*\))/gi
const pseudoClassRegex = /(:[^\s+>~.[:]+)/g
const elementRegex = /([^\s+>~.[:]+)/g

function findSelectorMatch(selector: string, regex: RegExp): [string, number] {
  // `RegExp.exec` returns at most one match (and `matches.length` counts groups,
  // not occurrences), so occurrences have to be counted via `String.match`
  const matches = selector.match(regex)

  if (!matches) {
    return [selector, 0]
  }

  return [selector.replace(regex, ' '), matches.length]
}

/**
 * Selector specificity split into id, class and element counts.
 */
export type Specificity = [number, number, number]

/**
 * Measure selector specificity as id, class and element counts.
 * @param selector - Selector to measure.
 * @returns Specificity parts.
 */
export function getSelectorSpecificityParts(selector: string): Specificity {
  const specificity: Specificity = [
    0,
    0,
    0
  ]
  let currentSelector = selector
    // `:not()` has no specificity of its own, only its argument does
    .replace(/:not\(([^)]*)\)/g, '     $1 ')
    .replace(/{[\s\S]*/gm, ' ')
  let delta = 0;

  [currentSelector, delta] = findSelectorMatch(currentSelector, attributeRegex)
  specificity[1] += delta;

  [currentSelector, delta] = findSelectorMatch(currentSelector, idRegex)
  specificity[0] += delta;

  [currentSelector, delta] = findSelectorMatch(currentSelector, classRegex)
  specificity[1] += delta;

  [currentSelector, delta] = findSelectorMatch(currentSelector, pseudoElementRegex)
  specificity[2] += delta;

  [currentSelector, delta] = findSelectorMatch(currentSelector, pseudoClassWithBracketsRegex)
  specificity[1] += delta;

  [currentSelector, delta] = findSelectorMatch(currentSelector, pseudoClassRegex)
  specificity[1] += delta

  currentSelector = currentSelector
    .replace(/[*\s+>~]/g, ' ')
    .replace(/[#.]/g, ' ');

  [currentSelector, delta] = findSelectorMatch(currentSelector, elementRegex) // lgtm [js/useless-assignment-to-local]
  specificity[2] += delta

  return specificity
}

/**
 * Measure selector specificity.
 * @param selector - Selector to measure.
 * @returns Specificity.
 */
export function getSelectorSpecificity(selector: string) {
  return getSelectorSpecificityParts(selector).join('')
}

const SPECIFICITY_PART_WIDTH = 6

/**
 * Convert specificity parts into a fixed-width string so that plain string
 * comparison yields the same result as comparing the id, class and element
 * counts numerically.
 * @param specificity - Specificity parts.
 * @returns Comparable specificity weight.
 */
export function toSpecificityWeight(specificity: Specificity) {
  return specificity
    .map(part => String(part).padStart(SPECIFICITY_PART_WIDTH, '0'))
    .join('')
}

/**
 * Cascade tier of regular style sheet rules.
 */
export const RULE_SPECIFICITY_TIER = '1'

/**
 * Cascade tier of `!important` style sheet rules.
 */
export const IMPORTANT_RULE_SPECIFICITY_TIER = '3'

/**
 * Specificity weight of inline styles, which always win over regular
 * style sheet rules.
 */
export const INLINE_STYLES_SPECIFICITY_WEIGHT = `2${'9'.repeat(SPECIFICITY_PART_WIDTH * 3)}`

/**
 * Specificity weight of `!important` inline styles, which win over everything.
 */
export const INLINE_IMPORTANT_STYLES_SPECIFICITY_WEIGHT = `4${'9'.repeat(SPECIFICITY_PART_WIDTH * 3)}`
