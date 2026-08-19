import { isRoutingLabel, type RoutingLabel, ROUTING_LABELS } from "./catalog.js";

export type RoutingDecision =
  | { readonly kind: "skip"; readonly reason: "none" | "ambiguous" }
  | { readonly kind: RoutingLabel };

export function classifyRouting(
  labels: readonly string[],
): RoutingDecision {
  const hits = ROUTING_LABELS.filter((name) => labels.includes(name));
  if (hits.length === 0) {
    return { kind: "skip", reason: "none" };
  }
  const first = hits[0];
  if (hits.length > 1 || first === undefined) {
    return { kind: "skip", reason: "ambiguous" };
  }
  return { kind: first };
}

export function stripRoutingLabels(labels: readonly string[]): string[] {
  return labels.filter((label) => !isRoutingLabel(label));
}
