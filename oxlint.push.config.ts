import { defineConfig } from "oxlint";

import config from "./oxlint.config";

export default defineConfig({
  ...config,
  options: { ...config.options, typeAware: false },
});
