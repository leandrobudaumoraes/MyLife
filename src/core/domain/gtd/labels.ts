import {
  CONTEXT_ENERGIES,
  CONTEXT_LOCATIONS,
  isContextLabel,
  STATE_LABEL_DOING,
  STATE_LABEL_PENDING,
} from "./catalog.js";

export function mergeContextLabels(
  existing: readonly string[],
  suggested: readonly string[],
): string[] {
  const next = [...existing];
  let hasLocation = next.some((label) =>
    (CONTEXT_LOCATIONS as readonly string[]).includes(label),
  );
  let hasEnergy = next.some((label) =>
    (CONTEXT_ENERGIES as readonly string[]).includes(label),
  );
  let hasCompra = next.includes("Compra");

  for (const raw of suggested) {
    if (!isContextLabel(raw) || next.includes(raw)) {
      continue;
    }
    if ((CONTEXT_LOCATIONS as readonly string[]).includes(raw)) {
      if (hasLocation) {
        continue;
      }
      next.push(raw);
      hasLocation = true;
      continue;
    }
    if ((CONTEXT_ENERGIES as readonly string[]).includes(raw)) {
      if (hasEnergy) {
        continue;
      }
      next.push(raw);
      hasEnergy = true;
      continue;
    }
    if (raw === "Compra") {
      if (hasCompra) {
        continue;
      }
      next.push(raw);
      hasCompra = true;
    }
  }

  return next;
}

export function withDoingLabel(labels: readonly string[]): string[] {
  return labels.includes(STATE_LABEL_DOING)
    ? [...labels]
    : [...labels, STATE_LABEL_DOING];
}

export function withoutDoingLabel(labels: readonly string[]): string[] {
  return labels.filter((label) => label !== STATE_LABEL_DOING);
}

export function withPendingLabel(labels: readonly string[]): string[] {
  return labels.includes(STATE_LABEL_PENDING)
    ? [...labels]
    : [...labels, STATE_LABEL_PENDING];
}
