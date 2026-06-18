export { ConfigSchema, type SplashConfig } from "./schema.js";
export { loadConfig, type SplashConfigOverrides } from "./loader.js";
export {
  readGlobalConfig,
  writeGlobalConfig,
  setGlobalValue,
  setApiKey,
  setBotCredential,
  applyPreset,
  globalConfigPath,
  globalConfigDir,
  legacyConfigDir,
  runsDir,
  logsDir,
  type GlobalConfigShape,
} from "./global-store.js";
