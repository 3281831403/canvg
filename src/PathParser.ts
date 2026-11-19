import {
  SVGCommand,
  CommandM,
  CommandL,
  CommandH,
  CommandV,
  CommandZ,
  CommandQ,
  CommandT,
  CommandC,
  CommandS,
  CommandA
} from 'svg-pathdata/lib/types'
import { SVGPathData } from 'svg-pathdata'
import { Point } from './Point'

export type CommandType = SVGCommand['type']
export type Command = { type: CommandType }
  & Omit<CommandM, 'type'>
  & Omit<CommandL, 'type'>
  & Omit<CommandH, 'type'>
  & Omit<CommandV, 'type'>
  & Omit<CommandZ, 'type'>
  & Omit<CommandQ, 'type'>
  & Omit<CommandT, 'type'>
  & Omit<CommandC, 'type'>
  & Omit<CommandS, 'type'>
  & Omit<CommandA, 'type'>

const COMMAND_LETTERS = 'MmZzLlHhVvCcSsQqTtAa'
const COMMAND_PARAMS_COUNT: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0
}
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/

function isCommandLetter(token: string) {
  return token.length === 1 && COMMAND_LETTERS.includes(token)
}

/**
 * Split path data into command/number tokens, stopping at the first
 * character that can't start a valid token (the rest of the path data
 * is invalid per spec and must be dropped).
 * @param path
 */
function tokenizePathData(path: string) {
  const tokens: string[] = []
  const { length } = path
  let i = 0
  // position within the current arc command params group (-1 = not in an arc);
  // arc flags are single `0`/`1` characters, not regular numbers
  let arcParamIndex = -1

  while (i < length) {
    const char = path[i]

    // separators
    if (char === ',' || char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f') {
      i++
      continue
    }

    if (COMMAND_LETTERS.includes(char)) {
      tokens.push(char)
      i++
      arcParamIndex = char === 'A' || char === 'a'
        ? 0
        : -1
      continue
    }

    if (arcParamIndex === 3 || arcParamIndex === 4) {
      // arc flag
      if (char !== '0' && char !== '1') {
        // invalid flag: drop it and everything after it
        break
      }

      tokens.push(char)
      i++
      arcParamIndex = (arcParamIndex + 1) % COMMAND_PARAMS_COUNT.A
      continue
    }

    const numberMatch = NUMBER_PATTERN.exec(path.slice(i))

    if (!numberMatch) {
      // invalid character: drop it and everything after it
      break
    }

    tokens.push(numberMatch[0])
    i += numberMatch[0].length

    if (arcParamIndex !== -1) {
      arcParamIndex = (arcParamIndex + 1) % COMMAND_PARAMS_COUNT.A
    }
  }

  return tokens
}

/**
 * Drop tokens that don't belong to a complete command, so the result
 * always ends at the last complete command.
 * @param tokens
 */
function truncateToLastCompleteCommand(tokens: string[]) {
  const result: string[] = []
  const { length } = tokens
  let i = 0

  while (i < length) {
    const command = tokens[i]

    if (!isCommandLetter(command)) {
      // numbers without a preceding command: invalid, drop the rest
      break
    }

    i++

    const paramsCount = COMMAND_PARAMS_COUNT[command.toUpperCase()]

    if (paramsCount === 0) {
      result.push(command)
      continue
    }

    const params: string[] = []

    while (i < length && !isCommandLetter(tokens[i])) {
      params.push(tokens[i])
      i++
    }

    const completeCount = Math.floor(params.length / paramsCount) * paramsCount

    if (completeCount === 0) {
      // command without a single complete params group: drop it and the rest
      break
    }

    result.push(command, ...params.slice(0, completeCount))

    if (completeCount < params.length) {
      // incomplete trailing group: drop it and the rest
      break
    }
  }

  return result
}

/**
 * Sanitize path data so it can always be parsed:
 * - fix spaces after signs;
 * - cut the data at the first invalid character (token-wise);
 * - fall back to the last complete command.
 * @param path
 */
function sanitizePathData(path: string) {
  const fixedPath = path
    // Fix spaces after signs.
    .replace(/([+\-.])\s+/gm, '$1')
  let tokens = truncateToLastCompleteCommand(tokenizePathData(fixedPath))

  // Make sure the result is parseable (e.g. arc flags must be 0 or 1):
  // drop trailing command groups until it parses.
  while (tokens.length > 0) {
    const sanitized = tokens.join(' ')

    try {
      // eslint-disable-next-line no-new
      new SVGPathData(sanitized)

      return sanitized
    } catch {
      const lastCommandIndex = tokens.reduce(
        (lastIndex, token, index) => (isCommandLetter(token) ? index : lastIndex),
        -1
      )

      if (lastCommandIndex <= 0) {
        return ''
      }

      tokens = tokens.slice(0, lastCommandIndex)
    }
  }

  return ''
}

export class PathParser extends SVGPathData {
  control: Point = new Point(0, 0)
  start: Point = new Point(0, 0)
  current: Point = new Point(0, 0)
  command: Command | null = null
  override readonly commands: Command[] /* Babel fix: */ = this.commands
  private i = -1
  private previousCommand: Command | null = null
  private points: Point[] = []
  private angles: (number | null)[] = []

  constructor(path: string) {
    super(sanitizePathData(path))
  }

  reset() {
    this.i = -1
    this.command = null
    this.previousCommand = null
    this.start = new Point(0, 0)
    this.control = new Point(0, 0)
    this.current = new Point(0, 0)
    this.points = []
    this.angles = []
  }

  isEnd() {
    const {
      i,
      commands
    } = this

    return i >= commands.length - 1
  }

  next() {
    const command = this.commands[++this.i]

    this.previousCommand = this.command
    this.command = command

    return command
  }

  getPoint(xProp = 'x', yProp = 'y') {
    const point = new Point(
      this.command[xProp] as number,
      this.command[yProp] as number
    )

    return this.makeAbsolute(point)
  }

  getAsControlPoint(xProp?: string, yProp?: string) {
    const point = this.getPoint(xProp, yProp)

    this.control = point

    return point
  }

  getAsCurrentPoint(xProp?: string, yProp?: string) {
    const point = this.getPoint(xProp, yProp)

    this.current = point

    return point
  }

  getReflectedControlPoint() {
    const previousCommand = this.previousCommand.type
    const currentCommand = this.command.type
    // S reflects the control point only after C/S,
    // T reflects it only after Q/T
    const shouldReflect = currentCommand === SVGPathData.SMOOTH_CURVE_TO
      ? previousCommand === SVGPathData.CURVE_TO
        || previousCommand === SVGPathData.SMOOTH_CURVE_TO
      : previousCommand === SVGPathData.QUAD_TO
        || previousCommand === SVGPathData.SMOOTH_QUAD_TO

    if (!shouldReflect) {
      return this.current
    }

    // reflect point
    const {
      current: {
        x: cx,
        y: cy
      },
      control: {
        x: ox,
        y: oy
      }
    } = this
    const point = new Point(2 * cx - ox, 2 * cy - oy)

    return point
  }

  makeAbsolute(point: Point) {
    if (this.command.relative) {
      const {
        x,
        y
      } = this.current

      point.x += x
      point.y += y
    }

    return point
  }

  addMarker(point: Point, from?: Point, priorTo?: Point) {
    const {
      points,
      angles
    } = this

    // if the last angle isn't filled in because we didn't have this point yet ...
    if (priorTo && angles.length > 0 && !angles[angles.length - 1]) {
      angles[angles.length - 1] = points[points.length - 1].angleTo(priorTo)
    }

    this.addMarkerAngle(point, from ? from.angleTo(point) : null)
  }

  addMarkerAngle(point: Point, angle: number) {
    this.points.push(point)
    this.angles.push(angle)
  }

  getMarkerPoints() {
    return this.points
  }

  getMarkerAngles() {
    const { angles } = this
    const len = angles.length

    for (let i = 0; i < len; i++) {
      if (!angles[i]) {
        for (let j = i + 1; j < len; j++) {
          if (angles[j]) {
            angles[i] = angles[j]
            break
          }
        }
      }
    }

    return angles
  }
}
