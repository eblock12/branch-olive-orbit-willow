import { Item, type ItemId } from "./items";

export type MobPunch = {
  outcome: "hurt" | "dead";
  kind: string;
  x: number;
  y: number;
  z: number;
};

function n(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function maybe(p: number, id: ItemId, lo: number, hi: number): { id: ItemId; count: number } | null {
  if (Math.random() >= p) return null;
  return { id, count: n(lo, hi) };
}

/** Items a slain mob leaves on the ground. */
export function mobLoot(kind: string): { id: ItemId; count: number }[] {
  const out: { id: ItemId; count: number }[] = [];
  const add = (row: { id: ItemId; count: number } | null) => {
    if (row && row.count > 0) out.push(row);
  };
  switch (kind) {
    case "pig":
      add({ id: Item.RAW_PORK, count: n(1, 3) });
      break;
    case "cow":
      add({ id: Item.RAW_BEEF, count: n(1, 3) });
      add(maybe(0.85, Item.LEATHER, 1, 2));
      break;
    case "sheep":
      add({ id: Item.RAW_MUTTON, count: n(1, 2) });
      add({ id: Item.WOOL, count: 1 });
      break;
    case "chicken":
      add({ id: Item.RAW_CHICKEN, count: 1 });
      add(maybe(0.8, Item.FEATHER, 1, 2));
      break;
    case "rabbit":
      add({ id: Item.RAW_RABBIT, count: 1 });
      add(maybe(0.55, Item.LEATHER, 1, 1));
      break;
    case "cat":
      add({ id: Item.STRING, count: n(1, 2) });
      break;
    case "caterpillar":
      add({ id: Item.STRING, count: n(1, 2) });
      break;
    case "shambler":
      add({ id: Item.ROTTEN_FLESH, count: n(1, 2) });
      break;
    case "crawler":
      add({ id: Item.ROTTEN_FLESH, count: 1 });
      add(maybe(0.4, Item.STRING, 1, 1));
      break;
    case "slender":
      add({ id: Item.BONE, count: n(1, 3) });
      add(maybe(0.6, Item.STRING, 1, 2));
      break;
    default:
      break;
  }
  return out;
}
