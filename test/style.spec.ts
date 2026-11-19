import { DOMParser } from '@xmldom/xmldom'
import * as canvas from 'canvas'
import fetch from 'node-fetch'
import {
  Canvg,
  presets
} from '../src'
import {
  getSelectorSpecificityParts,
  toSpecificityWeight
} from '../src/util'

const preset = presets.node({
  DOMParser,
  canvas,
  fetch
})

async function render(svg: string) {
  const c = preset.createCanvas(100, 100) as canvas.Canvas
  const ctx = c.getContext('2d')
  const v = Canvg.fromString(ctx, svg, preset)

  await v.render()

  return c
}

function centerPixel(c: canvas.Canvas) {
  const { data } = c.getContext('2d').getImageData(50, 50, 1, 1)

  return [data[0], data[1], data[2], data[3]]
}

const MAGENTA = [255, 0, 255, 255]
const BLUE = [0, 0, 255, 255]
const GREEN = [0, 255, 0, 255]
const RED = [255, 0, 0, 255]
const YELLOW = [255, 255, 0, 255]

function svg(body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${body}</svg>`
}

describe('style sheets', () => {
  // 1. type selector
  it('should match type selectors', async () => {
    expect(centerPixel(await render(svg(
      '<style>rect { fill: #ff00ff }</style><rect width="100" height="100"/>'
    )))).toEqual(MAGENTA)
  })

  // 2. id selector
  it('should match id selectors', async () => {
    expect(centerPixel(await render(svg(
      '<style>#t1 { fill: #ff00ff }</style><rect id="t1" width="100" height="100"/>'
    )))).toEqual(MAGENTA)
  })

  // 3. attribute selector
  it('should match attribute selectors', async () => {
    expect(centerPixel(await render(svg(
      '<style>[data-x] { fill: #ff00ff }</style><rect data-x="1" width="100" height="100"/>'
    )))).toEqual(MAGENTA)
  })

  // 4. descendant selector
  it('should match descendant selectors', async () => {
    expect(centerPixel(await render(svg(
      '<style>svg rect { fill: #ff00ff }</style><rect width="100" height="100"/>'
    )))).toEqual(MAGENTA)
  })

  // 5. compound selector
  it('should match compound selectors', async () => {
    expect(centerPixel(await render(svg(
      '<style>rect.k2 { fill: #ff00ff }</style><rect class="k2" width="100" height="100"/>'
    )))).toEqual(MAGENTA)
  })

  // 6. specificity is compared numerically by id/class/element counts
  it('should compare specificity by occurrence counts, ten classes beat one', async () => {
    const tenClasses = '.c1.c2.c3.c4.c5.c6.c7.c8.c9.c10'
    const classes = 'class="k c1 c2 c3 c4 c5 c6 c7 c8 c9 c10"'

    // stronger rule first
    expect(centerPixel(await render(svg(
      `<style>${tenClasses} { fill: #00ff00 } .k { fill: #ff00ff }</style><rect ${classes} width="100" height="100"/>`
    )))).toEqual(GREEN)
    // stronger rule last
    expect(centerPixel(await render(svg(
      `<style>.k { fill: #ff00ff } ${tenClasses} { fill: #00ff00 }</style><rect ${classes} width="100" height="100"/>`
    )))).toEqual(GREEN)
  })

  // 7. id beats class in any order; equal specificity: the later rule wins
  it('should let higher specificity win regardless of order and later rule win ties', async () => {
    // id before class
    expect(centerPixel(await render(svg(
      '<style>#t1 { fill: #0000ff } .k { fill: #ff00ff }</style><rect id="t1" class="k" width="100" height="100"/>'
    )))).toEqual(BLUE)
    // id after class
    expect(centerPixel(await render(svg(
      '<style>.k { fill: #ff00ff } #t1 { fill: #0000ff }</style><rect id="t1" class="k" width="100" height="100"/>'
    )))).toEqual(BLUE)
    // equal specificity: later rule wins
    expect(centerPixel(await render(svg(
      '<style>.a { fill: #ff0000 } .b { fill: #0000ff }</style><rect class="a b" width="100" height="100"/>'
    )))).toEqual(BLUE)
    // equal specificity, reversed declaration order
    expect(centerPixel(await render(svg(
      '<style>.b { fill: #0000ff } .a { fill: #ff0000 }</style><rect class="a b" width="100" height="100"/>'
    )))).toEqual(RED)
  })

  // 8. the position of the <style> element doesn't matter
  it('should apply style sheets declared after the element', async () => {
    expect(centerPixel(await render(svg(
      '<rect class="k" width="100" height="100"/><style>.k { fill: #ff00ff }</style>'
    )))).toEqual(MAGENTA)
  })

  describe('cascade order', () => {
    it('should let rules win over presentation attributes', async () => {
      expect(centerPixel(await render(svg(
        '<style>.k { fill: #ff00ff }</style><rect class="k" fill="#ffff00" width="100" height="100"/>'
      )))).toEqual(MAGENTA)
    })

    it('should let inline styles win over rules', async () => {
      expect(centerPixel(await render(svg(
        '<style>.k { fill: #ff00ff }</style><rect class="k" style="fill: #0000ff" width="100" height="100"/>'
      )))).toEqual(BLUE)
    })

    it('should keep presentation attributes when no rule matches', async () => {
      expect(centerPixel(await render(svg(
        '<style>.nope { fill: #ff00ff }</style><rect fill="#ffff00" width="100" height="100"/>'
      )))).toEqual(YELLOW)
    })
  })

  describe('host DOM integration', () => {
    it('should use the native matches() when the host provides it', async () => {
      const proto = (new DOMParser()
        .parseFromString('<svg/>', 'image/svg+xml')
        .documentElement.constructor as any).prototype
      const calls: string[] = []

      proto.matches = function (selector: string) {
        calls.push(selector)

        return selector === '#native-only'
      }

      try {
        const c = await render(svg(
          '<style>#native-only { fill: #ff00ff } .k { fill: #0000ff }</style><rect class="k" width="100" height="100"/>'
        ))

        expect(calls.length).toBeGreaterThan(0)
        expect(centerPixel(c)).toEqual(MAGENTA)
      } finally {
        delete proto.matches
      }
    })
  })

  describe('specificity', () => {
    it('should count ids, classes and elements separately', () => {
      expect(getSelectorSpecificityParts('#t1')).toEqual([1, 0, 0])
      expect(getSelectorSpecificityParts('.k')).toEqual([0, 1, 0])
      expect(getSelectorSpecificityParts('rect')).toEqual([0, 0, 1])
      expect(getSelectorSpecificityParts('[data-x]')).toEqual([0, 1, 0])
      expect(getSelectorSpecificityParts('svg rect')).toEqual([0, 0, 2])
      expect(getSelectorSpecificityParts('rect.k2')).toEqual([0, 1, 1])
      expect(getSelectorSpecificityParts('.c1.c2.c3.c4.c5.c6.c7.c8.c9.c10')).toEqual([0, 10, 0])
    })

    it('should compare weights numerically per count', () => {
      const weight = (selector: string) => toSpecificityWeight(getSelectorSpecificityParts(selector))

      expect(weight('#t1') > weight('.k')).toBe(true)
      expect(weight('.c1.c2.c3.c4.c5.c6.c7.c8.c9.c10') > weight('.k')).toBe(true)
      expect(weight('.k') > weight('rect')).toBe(true)
      expect(weight('svg rect') > weight('rect')).toBe(true)
      expect(weight('rect.k2') > weight('rect')).toBe(true)
      expect(weight('.a') === weight('.b')).toBe(true)
    })
  })
})
