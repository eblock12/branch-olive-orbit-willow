/// <reference lib="webworker" />
import { generateChunkBlocks } from "./chunkGen";

export type ChunkWorkerRequest = {
  id: number;
  cx: number;
  cz: number;
  seed: number;
};

export type ChunkWorkerResponse = {
  id: number;
  cx: number;
  cz: number;
  seed: number;
  blocks: Uint8Array;
};

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<ChunkWorkerRequest>) => {
  const { id, cx, cz, seed } = ev.data;
  const blocks = generateChunkBlocks(cx, cz, seed);
  const res: ChunkWorkerResponse = { id, cx, cz, seed, blocks };
  ctx.postMessage(res, [blocks.buffer]);
};
