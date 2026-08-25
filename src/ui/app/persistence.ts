import { serializeSave, type GameState } from "../../game";
import { bitRougePersistence } from "../../platform";

/**
 * Storage slot, NOT the save format version — `SAVE_VERSION` lives inside the
 * envelope (src/game/save.ts) and `deserializeSave` migrates v1/v2 payloads
 * (old credits → Silicon per redesign-v3 §3). Renaming this key would orphan
 * existing saves and silently skip that migration, so it stays "save-v1".
 */
export const SAVE_KEY = "save-v1";

export const getSavedGame = () => bitRougePersistence.get<string>(SAVE_KEY);

/**
 * The memory driver only engages when real storage is unavailable, so a
 * "successful" write there does not survive a reload.
 */
export const isGameSaveDurable = () => bitRougePersistence.driver !== "memory";

export const saveGameState = (
  state: GameState,
  savedAtMs: number = Date.now(),
) => bitRougePersistence.set(SAVE_KEY, serializeSave(state, savedAtMs));

export const saveGameStateImmediate = (
  state: GameState,
  savedAtMs: number = Date.now(),
) => bitRougePersistence.setImmediate(SAVE_KEY, serializeSave(state, savedAtMs));
