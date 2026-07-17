import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ImageFile } from "./tauri-api";

type BinaryOperator = "and" | "or";

type SearchNode =
  | { kind: "condition"; condition: SearchCondition }
  | { kind: "not"; node: SearchNode }
  | { kind: "binary"; operator: BinaryOperator; left: SearchNode; right: SearchNode };

type SearchCondition =
  | { kind: "filename"; value: string }
  | { kind: "tag"; value: string }
  | { kind: "class"; value: string }
  | { kind: "size"; expression: SizeExpression };

interface SizeExpression {
  operator: "<" | "<=" | ">" | ">=" | "=";
  bytes: number;
}

interface WordToken {
  type: "word";
  value: string;
}

interface OperatorToken {
  type: "operator";
  value: "and" | "or" | "not";
}

interface ParenToken {
  type: "paren";
  value: "(" | ")";
}

type QueryToken = WordToken | OperatorToken | ParenToken;

export interface SearchIndex {
  labelById: Map<string, LabelConfig>;
  classIndexByLabelId: Map<string, number>;
  annotationsByImage: Record<string, AnnotationShape[]>;
}

export interface CompletionSuggestion {
  value: string;
  label: string;
  replacementStart: number;
  replacementEnd: number;
}

export interface HighlightToken {
  text: string;
  kind: "operator" | "qualifier" | "value" | "paren" | "text";
}

const QUALIFIERS = ["filename", "tag", "class", "size"] as const;

export function searchImages(images: ImageFile[], query: string, index: SearchIndex): ImageFile[] {
  const ast = parseSearchQuery(query);
  if (!ast) {
    return images;
  }
  return images.filter((image) => evaluateSearch(ast, image, index));
}

export function parseSearchQuery(query: string): SearchNode | null {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return null;
  }
  const parser = new SearchParser(tokens);
  return parser.parse();
}

export function getSearchCompletions(
  query: string,
  cursorIndex: number,
  labels: LabelConfig[],
): CompletionSuggestion[] {
  const beforeCursor = query.slice(0, cursorIndex);
  const qualifierMatch = /@([a-z]*)$/i.exec(beforeCursor);
  if (qualifierMatch) {
    const prefix = qualifierMatch[1].toLowerCase();
    return QUALIFIERS.filter((qualifier) => qualifier.startsWith(prefix)).map((qualifier) => ({
      value: `@${qualifier}(`,
      label: qualifier,
      replacementStart: cursorIndex - qualifierMatch[0].length,
      replacementEnd: cursorIndex,
    }));
  }

  return completionForQualifierValue(query, cursorIndex, labels);
}

export function getSearchHighlights(query: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let index = 0;
  while (index < query.length) {
    const char = query[index];
    if (char === "(" || char === ")") {
      tokens.push({ text: char, kind: "paren" });
      index += 1;
      continue;
    }
    if (char === "-") {
      tokens.push({ text: char, kind: "operator" });
      index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      tokens.push({ text: char, kind: "text" });
      index += 1;
      continue;
    }

    const qualifier = /^@([a-z]+)\(/i.exec(query.slice(index));
    if (qualifier) {
      const start = index + qualifier[0].length;
      const end = query.indexOf(")", start);
      tokens.push({ text: qualifier[0].slice(0, -1), kind: "qualifier" });
      tokens.push({ text: "(", kind: "paren" });
      if (end === -1) {
        tokens.push({ text: query.slice(start), kind: "value" });
        return tokens;
      }
      tokens.push({ text: query.slice(start, end), kind: "value" });
      tokens.push({ text: ")", kind: "paren" });
      index = end + 1;
      continue;
    }

    const word = /^[^\s()]+/.exec(query.slice(index));
    if (!word) {
      tokens.push({ text: char, kind: "text" });
      index += 1;
      continue;
    }
    const kind = /^(and|or|not)$/i.test(word[0]) || word[0] === "-" ? "operator" : "text";
    tokens.push({ text: word[0], kind });
    index += word[0].length;
  }
  return tokens;
}

function tokenizeQuery(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let index = 0;
  while (index < query.length) {
    const char = query[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }
    if (char === "-") {
      tokens.push({ type: "operator", value: "not" });
      index += 1;
      continue;
    }
    if (char === "@") {
      const token = readQualifierToken(query, index);
      tokens.push({ type: "word", value: token.value });
      index = token.end;
      continue;
    }

    const match = /^[^\s()]+/.exec(query.slice(index));
    if (!match) {
      throw new Error(`无法解析字符：${char}`);
    }
    const value = match[0];
    const operator = value.toLowerCase();
    if (operator === "and" || operator === "or" || operator === "not") {
      tokens.push({ type: "operator", value: operator });
    } else {
      tokens.push({ type: "word", value });
    }
    index += value.length;
  }
  return tokens;
}

function readQualifierToken(query: string, start: number): { value: string; end: number } {
  const match = /^@[a-z]+\(/i.exec(query.slice(start));
  if (!match) {
    throw new Error("限定符格式应为 @name(value)");
  }
  const valueStart = start + match[0].length;
  const valueEnd = query.indexOf(")", valueStart);
  if (valueEnd === -1) {
    throw new Error("限定符缺少右括号");
  }
  return { value: query.slice(start, valueEnd + 1), end: valueEnd + 1 };
}

class SearchParser {
  private index = 0;

  constructor(private readonly tokens: QueryToken[]) {}

  parse(): SearchNode {
    const expression = this.parseExpression();
    if (this.peek()) {
      throw new Error("括号不匹配或表达式多余");
    }
    return expression;
  }

  private parseExpression(): SearchNode {
    let left = this.parseFactor();

    while (this.peek() && !this.isRightParen()) {
      const next = this.peek();
      const operator =
        next?.type === "operator" && (next.value === "and" || next.value === "or")
          ? next.value
          : "and";
      if (next?.type === "operator" && (next.value === "and" || next.value === "or")) {
        this.index += 1;
      }
      const right = this.parseFactor();
      left = { kind: "binary", operator, left, right };
    }

    return left;
  }

  private parseFactor(): SearchNode {
    const token = this.peek();
    if (!token) {
      throw new Error("表达式不完整");
    }
    if (token.type === "operator") {
      if (token.value !== "not") {
        throw new Error(`运算符 ${token.value} 缺少左侧条件`);
      }
      this.index += 1;
      return { kind: "not", node: this.parseFactor() };
    }
    if (token.type === "paren") {
      if (token.value === ")") {
        throw new Error("右括号缺少左括号");
      }
      this.index += 1;
      const expression = this.parseExpression();
      if (!this.isRightParen()) {
        throw new Error("左括号缺少右括号");
      }
      this.index += 1;
      return expression;
    }

    this.index += 1;
    return { kind: "condition", condition: parseCondition(token.value) };
  }

  private peek(): QueryToken | undefined {
    return this.tokens[this.index];
  }

  private isRightParen(): boolean {
    const token = this.peek();
    return token?.type === "paren" && token.value === ")";
  }
}

function parseCondition(value: string): SearchCondition {
  if (!value.startsWith("@")) {
    return { kind: "filename", value };
  }

  const match = /^@([a-z]+)\((.*)\)$/i.exec(value);
  if (!match) {
    throw new Error("限定符格式应为 @name(value)");
  }
  const qualifier = match[1].toLowerCase();
  const qualifierValue = match[2].trim();
  if (qualifier === "filename" || qualifier === "tag" || qualifier === "class") {
    return { kind: qualifier, value: qualifierValue };
  }
  if (qualifier === "size") {
    return { kind: "size", expression: parseSizeExpression(qualifierValue) };
  }
  throw new Error(`未知限定符：${qualifier}`);
}

function parseSizeExpression(value: string): SizeExpression {
  const match = /^(<=|>=|<|>|=)?\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(value);
  if (!match) {
    throw new Error(`文件大小表达式无效：${value}`);
  }
  const unit = (match[3] ?? "b").toLowerCase();
  const factor = unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  return {
    operator: (match[1] as SizeExpression["operator"] | undefined) ?? "=",
    bytes: Math.round(Number(match[2]) * factor),
  };
}

function evaluateSearch(node: SearchNode, image: ImageFile, index: SearchIndex): boolean {
  if (node.kind === "not") {
    return !evaluateSearch(node.node, image, index);
  }
  if (node.kind === "binary") {
    const left = evaluateSearch(node.left, image, index);
    return node.operator === "and"
      ? left && evaluateSearch(node.right, image, index)
      : left || evaluateSearch(node.right, image, index);
  }
  return matchesCondition(node.condition, image, index);
}

function matchesCondition(
  condition: SearchCondition,
  image: ImageFile,
  index: SearchIndex,
): boolean {
  if (condition.kind === "filename") {
    return image.name.toLowerCase().includes(condition.value.toLowerCase());
  }

  if (condition.kind === "size") {
    if (image.size === undefined) {
      return false;
    }
    const { operator, bytes } = condition.expression;
    if (operator === "<") return image.size < bytes;
    if (operator === "<=") return image.size <= bytes;
    if (operator === ">") return image.size > bytes;
    if (operator === ">=") return image.size >= bytes;
    return image.size === bytes;
  }

  const annotations = index.annotationsByImage[image.path] ?? [];
  if (condition.kind === "tag") {
    const tag = condition.value.toLowerCase();
    return annotations.some((annotation) =>
      (index.labelById.get(annotation.labelId)?.name ?? "").toLowerCase().includes(tag),
    );
  }

  return annotations.some((annotation) => {
    const classIndex = index.classIndexByLabelId.get(annotation.labelId);
    return classIndex !== undefined && String(classIndex) === condition.value;
  });
}

function completionForQualifierValue(
  query: string,
  cursorIndex: number,
  labels: LabelConfig[],
): CompletionSuggestion[] {
  const beforeCursor = query.slice(0, cursorIndex);
  const match = /@(tag|class)\(([^)]*)$/i.exec(beforeCursor);
  if (!match) {
    return [];
  }

  const qualifier = match[1].toLowerCase();
  const prefix = match[2].toLowerCase();
  const replacementStart = cursorIndex - match[0].length;
  return labels
    .map((label, index) => ({ label, index }))
    .filter(({ label, index }) =>
      qualifier === "tag"
        ? label.name.toLowerCase().includes(prefix)
        : String(index).startsWith(prefix),
    )
    .slice(0, 8)
    .map(({ label, index }) => ({
      value: qualifier === "tag" ? `@tag(${label.name})` : `@class(${index})`,
      label: qualifier === "tag" ? label.name : `${index} ${label.name}`,
      replacementStart,
      replacementEnd: cursorIndex,
    }));
}
