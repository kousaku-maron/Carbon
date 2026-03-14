export {
  getVaultPath,
  setVaultPath,
  getVaultHistory,
  removeFromHistory,
  pickVaultFolder,
} from "./modules/store";
export { scanVault, addToTree, removeFromTree } from "./modules/note-index";
export { scanNoteIndex } from "./modules/note-catalog";
export { useVault } from "./hooks/use-vault";
