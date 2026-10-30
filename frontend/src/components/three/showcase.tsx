"use client";

import { DragonEgg, IronCoin, IronThrone, Raven, SevenPointedStar, ValyrianBlade, Weirwood } from "./artifacts";
import { ArtifactStage } from "./stage";

export type ArtifactKind = "star" | "coin" | "blade" | "egg" | "throne" | "weirwood" | "raven";

export const ARTIFACT_INFO: Record<ArtifactKind, { name: string; lore: string; mechanic: string }> = {
  star: { name: "The Seven-Pointed Star", lore: "The holy symbol of the Faith of the Seven: Father, Mother, Warrior, Smith, Maiden, Crone and Stranger.", mechanic: "Decides persuasion, charm and recalling lore." },
  coin: { name: "An Iron Coin of Braavos", lore: "\"Valar morghulis.\" The token of the Faceless Men, given by Jaqen H'ghar to Arya.", mechanic: "Decides deception and reading hidden intentions." },
  blade: { name: "Valyrian Steel", lore: "Forged with spells in the Freehold before the Doom; rippled, light and unbreakable.", mechanic: "Decides duels and intimidation." },
  egg: { name: "Dragon Eggs", lore: "Petrified gifts from Illyrio to Daenerys — black-and-red, green-and-bronze, cream-and-gold.", mechanic: "Pulse with life; symbols of Targaryen rebirth." },
  throne: { name: "The Iron Throne", lore: "Forged by Aegon's dragon Balerion from a thousand swords of his surrendered enemies.", mechanic: "The prize every faction is fighting for." },
  weirwood: { name: "A Weirwood Heart Tree", lore: "White bark, red leaves and a weeping face — the eyes of the old gods and the greenseers.", mechanic: "Guardian of memory: every character's memories live here." },
  raven: { name: "A Messenger Raven", lore: "Maesters' ravens carry letters across the Seven Kingdoms.", mechanic: "Send letters to characters who are not with you." },
};

const CAMERA: Partial<Record<ArtifactKind, [number, number, number]>> = {
  blade: [0, 0.4, 3.6], throne: [0, 1.6, 4.4], weirwood: [0, 0.8, 4.4], raven: [0, 0.4, 2.6], egg: [0, 0.2, 3.6],
};

export default function ArtifactShowcase({ kind, className, interactive = true, spin = 0.4 }: { kind: ArtifactKind; className?: string; interactive?: boolean; spin?: number }) {
  return (
    <ArtifactStage className={className} interactive={interactive} spin={spin} camera={CAMERA[kind] ?? [0, 0.3, 3.4]}>
      {kind === "star" && <SevenPointedStar />}
      {kind === "coin" && <IronCoin rotation={[0.3, 0, 0]} />}
      {kind === "blade" && <ValyrianBlade position={[0, -0.9, 0]} />}
      {kind === "egg" && <DragonEgg variant="drogon" scale={0.9} />}
      {kind === "throne" && <IronThrone position={[0, -0.6, 0]} scale={1.1} />}
      {kind === "weirwood" && <Weirwood position={[0, -0.9, 0]} scale={0.95} />}
      {kind === "raven" && <Raven rotation={[0, 0.6, 0]} scale={1.4} />}
    </ArtifactStage>
  );
}
