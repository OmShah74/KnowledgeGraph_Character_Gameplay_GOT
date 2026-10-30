export type Dims = { trust: number; affection: number; respect: number; fear: number; familiarity: number };

export type Player = {
  id: string;
  name: string;
  background: string;
  background_name: string;
  allegiance: string | null;
  bio: string;
  ord: number;
  label: string;
  season: number;
  episode: number;
  location_id: string;
  location_name?: string;
  day: number;
  gold: number;
  health: number;
  max_health: number;
  renown: number;
  skills: Record<string, number>;
  reputation: Record<string, number>;
  inventory: string[];
  threads?: number;
  updated_at?: string;
};

export type PresentCharacter = {
  id: string;
  name: string;
  gender?: string;
  culture?: string;
  stats?: Record<string, number>;
  house: string | null;
  tier: string;
  titles: string[];
  mood: string;
  relationship: Dims;
  stance: string;
  disposition: "friendly" | "neutral" | "hostile";
  storyline: string | null;
};

export type TravelOption = {
  id: string;
  name: string;
  region: string;
  x: number;
  y: number;
  days: number;
  gold: number;
  sea_crossing: boolean;
  distance: number;
};

export type GameEvent = {
  id: number;
  kind: string;
  title: string;
  description: string;
  participants: string[];
  ord: number;
  label?: string;
  canon: number;
  created_at: string;
};

export type Quest = {
  id: string;
  title: string;
  description: string;
  giver_id: string | null;
  status: string;
  objectives: { type: string; target: string; text: string; done: boolean }[];
  reward: { gold?: number; renown?: number };
};

export type PlotStage = { name: string; description: string; kind: string };
export type Plot = {
  id: string;
  title: string;
  premise: string;
  stakes: string;
  origin: string;
  characters: string[];
  character_names?: string[];
  factions: string[];
  stages: PlotStage[];
  stage: number;
  tension: number;
  status: string;
  player_involved: number;
  log: { ord: number; label: string; text: string }[];
  linked_threads?: string[];
};

export type Faction = {
  faction_id: string;
  name: string;
  power: number;
  wealth: number;
  influence: number;
  stability: number;
  leader_id: string | null;
  stances: Record<string, string>;
};

export type ThreadSummary = {
  id: string;
  player_id: string;
  kind: "chat" | "scene" | "raven";
  title: string;
  character_ids: string[];
  characters?: { id: string; name: string }[];
  location_id: string;
  ord: number;
  summary: string;
  message_count: number;
  updated_at: string;
  last_message?: string;
  link_count?: number;
};

export type Check = {
  intent: string;
  skill: string;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  margin: number;
  outcome: "critical_failure" | "failure" | "partial" | "success" | "critical_success";
  label: string;
};

export type MessageMeta = {
  canon?: boolean;
  scene_id?: string;
  intent?: string;
  action?: string;
  thought?: string;
  thought_revealed?: boolean;
  emotion?: string;
  check?: Check | null;
  duel?: { player_total: number; character_total: number; winner: string; damage: number } | null;
  delta?: Partial<Dims>;
  stance?: string;
  previous_stance?: string;
  learned?: string[];
  quest?: string;
  gold?: number;
  llm?: { fallback?: boolean; provider?: string; model?: string; key?: string; latency_ms?: number; attempts?: number; reason?: string };
};

export type Message = {
  id: number;
  thread_id: string;
  role: "player" | "character" | "narrator" | "system";
  speaker_id: string | null;
  speaker_name: string | null;
  content: string;
  meta: MessageMeta;
  created_at: string;
};

export type ThreadLink = { id: number; from_thread: string; to_kind: string; to_id: string; relation: string; note: string };

export type Thread = ThreadSummary & {
  characters: { id: string; name: string }[];
  messages: Message[];
  links: ThreadLink[];
  relationships: Record<string, Dims & { stance: string; disposition: string; mood: string; affect: Affect }>;
};

export type Affect = { p?: number; a?: number; d?: number; label?: string; base?: { p: number; a: number; d: number } };

export type PlayerState = {
  player: Player;
  episode_title: string;
  max_ord: number;
  location: { id: string; name: string; description: string; region: string; region_name: string; kind: string };
  present: PresentCharacter[];
  travel: TravelOption[];
  quests: Quest[];
  events: GameEvent[];
  threads: ThreadSummary[];
  plots: Plot[];
  factions: Faction[];
  divergences: number;
  intents: { id: string; label: string; description: string; skill: string | null }[];
};

export type CharacterListItem = {
  id: string;
  name: string;
  house: string | null;
  tier: string;
  titles: string[];
  summary: string;
  line_count: number;
  canon: boolean;
  death_ord: number | null;
  alive: boolean;
  location_id: string | null;
  location_name: string | null;
  storyline: string | null;
  has_persona: boolean;
  mood: string | null;
};

export type NetworkEntry = Dims & { id: string; name: string; stance: string; disposition: string; reasons: string[] };

export type BehaviourProfile = {
  prior: Record<string, number>;
  effective: Record<string, number>;
  drift: Record<string, number>;
  affect: Affect;
  mood: string;
  stress: number;
  goals: { goal: string; priority: number; source?: string }[];
  beliefs: { belief: string; confidence: number; about: string | null; ord: number }[];
  learned: { rule: string; source: string; ord: number; strength: number; about?: string | null }[];
  counters: Record<string, number>;
};

export type CharacterDetail = {
  id: string;
  name: string;
  house: string | null;
  gender: string;
  culture: string;
  religion: string;
  titles: string[];
  tier: string;
  summary: string;
  traits: string[];
  stats: Record<string, number>;
  personality: Record<string, number>;
  drives: { goal: string; priority: number }[];
  death_ord: number | null;
  death_note: string | null;
  killer_id: string | null;
  first_ord: number | null;
  last_ord: number | null;
  line_count: number;
  voice: {
    line_count?: number;
    avg_words?: number;
    catchphrases?: string[];
    top_words?: string[];
    signature_lines?: { ord: number; label: string; text: string }[];
    top_partners?: { id: string; name: string; weight: number }[];
    lines_per_season?: Record<string, number>;
  };
  persona: { hand_written: string | null; generated: string; has_hand_written: boolean };
  profile: BehaviourProfile;
  network: NetworkEntry[];
  alive: boolean;
  location_id: string | null;
  location_name: string | null;
  storyline: string | null;
  ord: number;
  label: string;
  titles_now: string[];
  arc_complete: boolean;
  events: { label: string; title: string; text: string; witnessed: boolean; outcome: string }[];
  memory_stats: Record<string, number>;
  player_relationship?: Dims & { stance: string; disposition: string };
};

export type Memory = {
  id: number;
  character_id: string;
  character_name?: string;
  player_id: string | null;
  kind: string;
  content: string;
  importance: number;
  emotion: string | null;
  about: string[];
  counterpart_id: string | null;
  counterpart_name?: string | null;
  ord: number;
  label?: string | null;
  thread_id: string | null;
  created_at: string;
  access_count: number;
  score?: number;
};

export type GraphNode = { id: string; label: string; name: string; props: Record<string, unknown>; layer: string; player_id: string | null };
export type GraphLink = {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  valid_from: number | null;
  valid_to: number | null;
  layer: string;
  props: Record<string, unknown>;
};

export type OntologyClass = {
  name: string;
  parent: string | null;
  description: string;
  properties: Record<string, string>;
  color: string;
  builtin: number;
  instance_count: number;
};

export type OntologyRelation = {
  name: string;
  domain: string;
  range: string;
  description: string;
  symmetric: boolean;
  temporal: boolean;
  inverse: string | null;
  builtin: boolean;
  edge_count: number;
};

export type ApiKey = {
  id: string;
  name: string;
  provider: string;
  model: string;
  key_hint: string;
  base_url: string | null;
  enabled: boolean;
  priority: number;
  created_at: string;
  last_used_at: string | null;
  last_error: string | null;
  success_count: number;
  failure_count: number;
  consecutive_failures: number;
  cooling_down: boolean;
  cooldown_remaining: number;
};

export type WikiPage = {
  id: number;
  slug: string;
  scope: string;
  title: string;
  content: string;
  version: number;
  generated_by: string;
  category: string;
  updated_at: string;
  links: string[];
  backlinks: string[];
};

export type Episode = { ord: number; season: number; episode: number; title: string; release_date: string; line_count: number; label: string; events: string[] };
