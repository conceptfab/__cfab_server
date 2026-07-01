import { badRequest } from "@/lib/http/error";

export interface JsonStructureLimits {
  maxArrayItems: number;
  maxObjectKeys: number;
  maxDepth: number;
}

interface StackFrame {
  node: unknown;
  depth: number;
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

/**
 * Waliduje sparsowaną wartość JSON wobec limitów strukturalnych
 * (maxArrayItems / maxObjectKeys / maxDepth). Zapobiega DoS przez ogromne
 * tablice lub głębokie zagnieżdżenia mieszczące się w budżecie bajtów.
 *
 * Obchód iteracyjny (jawny stos) — bez rekurencji, by wrogie głębokie wejście
 * nie przepełniło stosu wywołań. Rzuca AppError (400 payload_structure_exceeded)
 * przy pierwszym naruszeniu. Nie modyfikuje `value`.
 */
export function assertJsonStructure(
  value: unknown,
  limits: JsonStructureLimits,
): void {
  const stack: StackFrame[] = [{ node: value, depth: 1 }];

  while (stack.length > 0) {
    const { node, depth } = stack.pop() as StackFrame;

    if (depth > limits.maxDepth) {
      throw badRequest(
        `JSON zbyt głęboki (> ${limits.maxDepth})`,
        "payload_structure_exceeded",
      );
    }

    if (Array.isArray(node)) {
      if (node.length > limits.maxArrayItems) {
        throw badRequest(
          `Tablica przekracza limit (${node.length} > ${limits.maxArrayItems})`,
          "payload_structure_exceeded",
        );
      }
      for (const child of node) {
        if (isContainer(child)) {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
    } else if (isContainer(node)) {
      const keys = Object.keys(node);
      if (keys.length > limits.maxObjectKeys) {
        throw badRequest(
          `Obiekt przekracza limit kluczy (${keys.length} > ${limits.maxObjectKeys})`,
          "payload_structure_exceeded",
        );
      }
      for (const key of keys) {
        const child = (node as Record<string, unknown>)[key];
        if (isContainer(child)) {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
    }
    // wartości skalarne (string/number/bool/null) nie wymagają walidacji
  }
}
