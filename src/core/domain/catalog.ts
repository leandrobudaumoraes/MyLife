import type {
  CalendarPrefix,
  FrontId,
  GtdList,
  GtdProject,
  SpecialistAgentId,
} from "./schemas.js";
import type { IntegrationError } from "./schemas.js";

export const PROTECTED_SERIES_IDS: readonly string[] = [
  "4shfgjsrs1t9t6pljm8ake8ng0",
  "u9bgqekrb6isudq7ntug21034g",
  "kms19pgudaa844m142nfs36d8s",
  "l4mmbnoiapdusv4a81ifma3a44",
  "l1t5pkkdj6avk10s02cdc14to4",
  "c2npfh9t7f1s8nq2bbmmuje9no",
  "u7bka3nff46blrfphjc52pfiq0",
  "eg997v16e5ersn8b45gkpkcjn4",
  "0em2de2hu11j5e4qnvafsobioo",
  "aedkngskr8pvsik5qm3a8a2k9o",
  "o46atol4gaj6efqrvep3282u2o",
  "81hfsp06qj4s52nkr2r1lpj5nk",
  "jrpcc165gkfi6nqnbb6gsob4uo",
];

export const PROTECTED_SERIES_PREFIX: Readonly<
  Record<string, CalendarPrefix>
> = {
  "4shfgjsrs1t9t6pljm8ake8ng0": "SAUDE",
  u9bgqekrb6isudq7ntug21034g: "FAMILIA",
  kms19pgudaa844m142nfs36d8s: "FAMILIA",
  l4mmbnoiapdusv4a81ifma3a44: "SAUDE",
  l1t5pkkdj6avk10s02cdc14to4: "SAUDE",
  c2npfh9t7f1s8nq2bbmmuje9no: "SAUDE",
  u7bka3nff46blrfphjc52pfiq0: "SAUDE",
  eg997v16e5ersn8b45gkpkcjn4: "ENGENHARIA",
  "0em2de2hu11j5e4qnvafsobioo": "ENGENHARIA",
  aedkngskr8pvsik5qm3a8a2k9o: "SAUDE",
  o46atol4gaj6efqrvep3282u2o: "FAMILIA",
  "81hfsp06qj4s52nkr2r1lpj5nk": "LOJA",
  jrpcc165gkfi6nqnbb6gsob4uo: "INSTITUTO",
};

export const FRONT_CATALOG: Record<
  FrontId,
  {
    readonly agentId: SpecialistAgentId;
    readonly prefix: CalendarPrefix;
    readonly gtdProject: GtdProject | null;
    readonly colorId: "10" | "6" | "3" | "5" | "4";
    readonly hubPageId: string;
    readonly hubUrl: string;
  }
> = {
  mim: {
    agentId: "pessoal",
    prefix: "SAUDE",
    gtdProject: "vitalidade",
    colorId: "10",
    hubPageId: "3bef94d816108193bc0fffd4b33c6107",
    hubUrl: "https://app.notion.com/p/3bef94d816108193bc0fffd4b33c6107",
  },
  casa: {
    agentId: "infraestrutura_casa",
    prefix: "LAR",
    gtdProject: "lar",
    colorId: "6",
    hubPageId: "3bef94d81610812ba553f3833971006f",
    hubUrl: "https://app.notion.com/p/3bef94d81610812ba553f3833971006f",
  },
  instituto: {
    agentId: "profissional_instituto",
    prefix: "INSTITUTO",
    gtdProject: "instituto",
    colorId: "3",
    hubPageId: "3bef94d816108174811ee64c4ae57fd8",
    hubUrl: "https://app.notion.com/p/3bef94d816108174811ee64c4ae57fd8",
  },
  loja_lua_branca: {
    agentId: "operacoes_loja_lua_branca",
    prefix: "LOJA",
    gtdProject: null,
    colorId: "5",
    hubPageId: "3bef94d816108148851bc1d07a2c1c8d",
    hubUrl: "https://app.notion.com/p/3bef94d816108148851bc1d07a2c1c8d",
  },
  familia: {
    agentId: "logistica_familiar",
    prefix: "FAMILIA",
    gtdProject: "familia",
    colorId: "4",
    hubPageId: "3bef94d816108192988ffcc41260455a",
    hubUrl: "https://app.notion.com/p/3bef94d816108192988ffcc41260455a",
  },
};

export const GTD_PROJECT_NAMES: Record<GtdProject, string> = {
  vitalidade: "🩺 Vitalidade",
  lar: "🏠 Lar",
  familia: "👨 Família",
  instituto: "🕍 Instituto",
};

export const GTD_PROJECT_TO_FRONT: Record<GtdProject, FrontId> = {
  vitalidade: "mim",
  lar: "casa",
  familia: "familia",
  instituto: "instituto",
};

export const GTD_LIST_NAMES: Record<GtdList, string> = {
  proximas_acoes: "⏩ Próximas ações",
  encubar: "💤 Encubar",
  arquivar: "📌 Arquivar",
  projetos: "📁 Projetos",
};

/** Pilar do banco Specs da Agenda → frente (Engenharia não é frente). */
export const PILAR_TO_FRONT: Readonly<Record<string, FrontId>> = {
  "Vitalidade e Longevidade": "mim",
  "Lar e Prosperidade": "casa",
  "Instituto Metatron": "instituto",
  "Loja da Caroline": "loja_lua_branca",
  "Pai e Esposo": "familia",
};

export interface ProtectedSeriesCatalog {
  isProtectedSeries(seriesId: string): boolean;
  prefixOf(seriesId: string): CalendarPrefix | null;
}

export function assertNotProtectedWrite(seriesId: string | null): void {
  if (seriesId && PROTECTED_SERIES_IDS.includes(seriesId)) {
    throw Object.freeze({
      provider: "google_calendar",
      code: "forbidden_write",
      message: `Write em série protegida ${seriesId} é proibido`,
      retryable: false,
      retryAfterMs: null,
      cause: null,
    } satisfies IntegrationError);
  }
}
