export type FromDirective = {
  type: "FROM"
  image: string
  tag?: string
  digest?: string
  alias?: string
  lineNumber: number
}

export type RunDirective = {
  type: "RUN"
  command: string
  lineNumber: number
}

export type CopyDirective = {
  type: "COPY" | "ADD"
  src: string
  dest: string
  from?: string
  lineNumber: number
}

export type EnvDirective = {
  type: "ENV"
  key: string
  value: string
  lineNumber: number
}

export type LabelDirective = {
  type: "LABEL"
  key: string
  value: string
  lineNumber: number
}

export type UserDirective = {
  type: "USER"
  user: string
  lineNumber: number
}

export type ExposeDirective = {
  type: "EXPOSE"
  port: number
  protocol?: string
  lineNumber: number
}

export type ArgDirective = {
  type: "ARG"
  name: string
  defaultValue?: string
  lineNumber: number
}

type OtherType = "WORKDIR" | "ENTRYPOINT" | "CMD" | "HEALTHCHECK" | "VOLUME" | "STOPSIGNAL" | "SHELL" | "ONBUILD"

export type OtherDirective = { type: OtherType; value: string; lineNumber: number }

export type ContainerfileInstruction =
  | FromDirective | RunDirective | CopyDirective | EnvDirective
  | LabelDirective | UserDirective | ExposeDirective | ArgDirective
  | OtherDirective

export type Stage = { from: FromDirective; instructions: ContainerfileInstruction[] }
export type ParsedContainerfile = { stages: Stage[]; globalArgs: ArgDirective[] }
export type Dependency = { name: string; version?: string; source: "pip" | "npm" | "dnf" | "maven" | "go" }

const OTHER_DIRECTIVES = new Set<string>([
  "WORKDIR", "ENTRYPOINT", "CMD", "HEALTHCHECK", "VOLUME", "STOPSIGNAL", "SHELL", "ONBUILD",
])

function mergeLines(rawLines: readonly string[]): Array<{ text: string; lineNumber: number }> {
  const merged: Array<{ text: string; lineNumber: number }> = []
  let current = ""
  let startLine = 0
  let inHeredoc = false
  let heredocMarker = ""

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!

    if (inHeredoc) {
      current += "\n" + line
      if (line.trim() === heredocMarker) {
        inHeredoc = false
        merged.push({ text: current, lineNumber: startLine })
        current = ""
      }
      continue
    }

    if (current === "") {
      startLine = i + 1
      current = line
    } else {
      current += " " + line.trim()
    }

    const heredocMatch = current.match(/<<-?\s*['"]?(\w+)['"]?/)
    if (heredocMatch) {
      inHeredoc = true
      heredocMarker = heredocMatch[1]!
      continue
    }

    if (current.endsWith("\\")) {
      current = current.slice(0, -1).trimEnd()
      continue
    }

    merged.push({ text: current, lineNumber: startLine })
    current = ""
  }

  if (current !== "") {
    merged.push({ text: current, lineNumber: startLine })
  }

  return merged
}

function parseFrom(args: string, lineNumber: number): FromDirective {
  const parts = args.trim().split(/\s+/)
  const imageRef = parts[0] ?? ""
  let alias: string | undefined

  if (parts.length >= 3 && parts[1]?.toUpperCase() === "AS") {
    alias = parts[2]
  }

  const digestIdx = imageRef.indexOf("@")
  if (digestIdx !== -1) {
    return { type: "FROM", image: imageRef.slice(0, digestIdx), digest: imageRef.slice(digestIdx + 1), alias, lineNumber }
  }

  const tagIdx = imageRef.indexOf(":")
  if (tagIdx !== -1) {
    return { type: "FROM", image: imageRef.slice(0, tagIdx), tag: imageRef.slice(tagIdx + 1), alias, lineNumber }
  }

  return { type: "FROM", image: imageRef, alias, lineNumber }
}

function parseCopyAdd(
  directive: "COPY" | "ADD",
  args: string,
  lineNumber: number,
): CopyDirective {
  let from: string | undefined
  let rest = args.trim()

  const fromMatch = rest.match(/^--from=(\S+)\s+/)
  if (fromMatch) {
    from = fromMatch[1]
    rest = rest.slice(fromMatch[0].length)
  }

  const parts = rest.split(/\s+/)
  const dest = parts.pop() ?? ""
  const src = parts.join(" ")

  return { type: directive, src, dest, from, lineNumber }
}

function parseEnv(args: string, lineNumber: number): EnvDirective {
  const eqIdx = args.indexOf("=")
  if (eqIdx !== -1) {
    const key = args.slice(0, eqIdx).trim()
    const value = args.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    return { type: "ENV", key, value, lineNumber }
  }

  const spaceIdx = args.indexOf(" ")
  if (spaceIdx !== -1) {
    return {
      type: "ENV",
      key: args.slice(0, spaceIdx).trim(),
      value: args.slice(spaceIdx + 1).trim(),
      lineNumber,
    }
  }

  return { type: "ENV", key: args.trim(), value: "", lineNumber }
}

function parseLabel(args: string, lineNumber: number): LabelDirective {
  const eqIdx = args.indexOf("=")
  if (eqIdx !== -1) {
    const key = args.slice(0, eqIdx).trim()
    const value = args.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    return { type: "LABEL", key, value, lineNumber }
  }

  return { type: "LABEL", key: args.trim(), value: "", lineNumber }
}

function parseExpose(args: string, lineNumber: number): ExposeDirective {
  const parts = args.trim().split("/")
  const port = parseInt(parts[0]!, 10)
  const protocol = parts[1]

  return { type: "EXPOSE", port, protocol, lineNumber }
}

function parseArg(args: string, lineNumber: number): ArgDirective {
  const eqIdx = args.indexOf("=")
  if (eqIdx !== -1) {
    return {
      type: "ARG",
      name: args.slice(0, eqIdx).trim(),
      defaultValue: args.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, ""),
      lineNumber,
    }
  }

  return { type: "ARG", name: args.trim(), lineNumber }
}

function parseInstruction(
  text: string,
  lineNumber: number,
): ContainerfileInstruction | null {
  const match = text.match(/^(\S+)\s*(.*)$/s)
  if (!match) return null

  const directive = match[1]!.toUpperCase()
  const args = match[2] ?? ""

  switch (directive) {
    case "FROM":
      return parseFrom(args, lineNumber)
    case "RUN":
      return { type: "RUN", command: args.trim(), lineNumber }
    case "COPY":
      return parseCopyAdd("COPY", args, lineNumber)
    case "ADD":
      return parseCopyAdd("ADD", args, lineNumber)
    case "ENV":
      return parseEnv(args, lineNumber)
    case "LABEL":
      return parseLabel(args, lineNumber)
    case "USER":
      return { type: "USER", user: args.trim(), lineNumber }
    case "EXPOSE":
      return parseExpose(args, lineNumber)
    case "ARG":
      return parseArg(args, lineNumber)
    default:
      if (OTHER_DIRECTIVES.has(directive)) {
        return {
          type: directive as OtherDirective["type"],
          value: args.trim(),
          lineNumber,
        }
      }
      return null
  }
}

export function parseContainerfile(content: string): ParsedContainerfile {
  const rawLines = content.split("\n")
  const merged = mergeLines(rawLines)
  const stages: Stage[] = []
  const globalArgs: ArgDirective[] = []
  let currentStage: Stage | null = null

  for (const { text, lineNumber } of merged) {
    const trimmed = text.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue

    const instruction = parseInstruction(trimmed, lineNumber)
    if (!instruction) continue

    if (instruction.type === "FROM") {
      currentStage = { from: instruction, instructions: [instruction] }
      stages.push(currentStage)
    } else if (currentStage === null) {
      if (instruction.type === "ARG") {
        globalArgs.push(instruction)
      }
    } else {
      currentStage.instructions.push(instruction)
    }
  }

  return { stages, globalArgs }
}

export function extractDependencies(parsed: ParsedContainerfile): Dependency[] {
  const deps: Dependency[] = []

  for (const stage of parsed.stages) {
    for (const instr of stage.instructions) {
      if (instr.type !== "RUN") continue
      extractFromCommand(instr.command, deps)
    }
  }

  return deps
}

function extractFromCommand(command: string, deps: Dependency[]): void {
  extractPipDeps(command, deps)
  extractNpmDeps(command, deps)
  extractDnfDeps(command, deps)
  extractMavenDeps(command, deps)
  extractGoDeps(command, deps)
}

function extractPipDeps(command: string, deps: Dependency[]): void {
  const match = command.match(/pip3?\s+install\s+(.+?)(?:\s*&&|$)/s)
  if (!match) return

  const args = match[1]!
  const tokens = args.split(/\s+/)

  for (const token of tokens) {
    if (token.startsWith("-")) continue
    if (token.includes("requirements") || token.includes(".txt")) continue

    const eqSplit = token.split("==")
    if (eqSplit.length === 2) {
      deps.push({ name: eqSplit[0]!, version: eqSplit[1], source: "pip" })
    } else {
      const geqSplit = token.split(">=")
      if (geqSplit.length === 2) {
        deps.push({ name: geqSplit[0]!, version: ">=" + geqSplit[1]!, source: "pip" })
      } else {
        deps.push({ name: token, source: "pip" })
      }
    }
  }
}

function extractNpmDeps(command: string, deps: Dependency[]): void {
  const match = command.match(/npm\s+install\s+(.+?)(?:\s*&&|$)/s)
  if (!match) return

  const args = match[1]!
  const tokens = args.split(/\s+/)

  for (const token of tokens) {
    if (token.startsWith("-")) continue

    const atIdx = token.lastIndexOf("@")
    if (atIdx > 0) {
      deps.push({ name: token.slice(0, atIdx), version: token.slice(atIdx + 1), source: "npm" })
    } else {
      deps.push({ name: token, source: "npm" })
    }
  }
}

function extractDnfDeps(command: string, deps: Dependency[]): void {
  const match = command.match(/(?:dnf|yum)\s+install\s+(?:-y\s+)?(.+?)(?:\s*&&|$)/s)
  if (!match) return

  const args = match[1]!
  const tokens = args.split(/\s+/)

  for (const token of tokens) {
    if (token.startsWith("-")) continue
    deps.push({ name: token, source: "dnf" })
  }
}

function extractMavenDeps(command: string, deps: Dependency[]): void {
  const match = command.match(/mvn\s+.*dependency:resolve/s)
  if (match) {
    deps.push({ name: "maven-dependencies", source: "maven" })
  }
}

function extractGoDeps(command: string, deps: Dependency[]): void {
  const match = command.match(/go\s+(?:get|mod\s+download)\s+(.+?)(?:\s*&&|$)/s)
  if (!match) return

  const args = match[1]!
  const tokens = args.split(/\s+/)

  for (const token of tokens) {
    if (token.startsWith("-")) continue

    const atIdx = token.lastIndexOf("@")
    if (atIdx > 0) {
      deps.push({ name: token.slice(0, atIdx), version: token.slice(atIdx + 1), source: "go" })
    } else {
      deps.push({ name: token, source: "go" })
    }
  }
}
