export const GTD_NEXT_ACTIONS = "⏩ Próximas ações" as const;
export const GTD_INCUBATE = "💤 Encubar" as const;
export const GTD_ARCHIVE = "📌 Arquivar" as const;
export const GTD_PROJECTS_FOLDER = "📁 Projetos" as const;

export const PILLAR_PROJECTS = [
  "🩺 Saúde",
  "👨 Família",
  "🏠 Casa",
  "💰 Financeiro",
  "🤝 Amizades",
  "🕍 Instituto",
  "🌙 Loja Lua Branca",
] as const;

export type PillarProjectName = (typeof PILLAR_PROJECTS)[number];

export const ROOT_GTD_PROJECTS = [
  GTD_NEXT_ACTIONS,
  GTD_INCUBATE,
  GTD_ARCHIVE,
] as const;

export const ROUTING_LABELS = [
  "Next",
  "Maybe",
  "Archive",
  "Project",
  "Event",
] as const;

export type RoutingLabel = (typeof ROUTING_LABELS)[number];

export const STATE_LABEL_DOING = "Doing" as const;
export const STATE_LABEL_PENDING = "Pending" as const;

export const PENDING_FILTER = {
  name: "Pendentes",
  query: "@Pending",
  color: "red",
} as const;

export const FILTER_CATALOG = [PENDING_FILTER] as const;

export const NOTION_PROJECT_STATUS_IN_PROGRESS = "Em andamento" as const;

export function isNotionProjectInProgress(status: string | null): boolean {
  return status === NOTION_PROJECT_STATUS_IN_PROGRESS;
}

export const CONTEXT_LOCATIONS = [
  "Casa",
  "Rua",
  "Carro",
  "Celular",
] as const;

export const CONTEXT_ENERGIES = ["Alta", "Baixa"] as const;
export const CONTEXT_SPACE = ["Compra"] as const;

export const CONTEXT_LABELS = [
  ...CONTEXT_LOCATIONS,
  ...CONTEXT_ENERGIES,
  ...CONTEXT_SPACE,
] as const;

export type ContextLabel = (typeof CONTEXT_LABELS)[number];

export const LABEL_CATALOG = [
  { name: "Next", color: "lime_green" },
  { name: "Maybe", color: "yellow" },
  { name: "Archive", color: "grey" },
  { name: "Project", color: "blue" },
  { name: "Event", color: "teal" },
  { name: "Doing", color: "orange" },
  { name: "Pending", color: "red" },
  { name: "Casa", color: "salmon" },
  { name: "Rua", color: "salmon" },
  { name: "Carro", color: "salmon" },
  { name: "Celular", color: "salmon" },
  { name: "Alta", color: "grape" },
  { name: "Baixa", color: "grape" },
  { name: "Compra", color: "grape" },
] as const;

export const RESERVED_PROJECT_NAMES = [
  GTD_NEXT_ACTIONS,
  GTD_INCUBATE,
  GTD_ARCHIVE,
  GTD_PROJECTS_FOLDER,
  ...PILLAR_PROJECTS,
] as const;

export function isRoutingLabel(name: string): name is RoutingLabel {
  return (ROUTING_LABELS as readonly string[]).includes(name);
}

export function isContextLabel(name: string): name is ContextLabel {
  return (CONTEXT_LABELS as readonly string[]).includes(name);
}

export function isReservedProjectName(name: string): boolean {
  return (RESERVED_PROJECT_NAMES as readonly string[]).includes(name);
}
