import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "examples/cli.ts",
    "bots/discord.ts",
    "bots/slack.ts",
    "bots/messenger.ts",
    "bots/whatsapp.ts",
    "bots/telegram.ts"
  ],
  format: ["esm"],
  platform: "node",
  clean: true,
  bundle: true,
  noExternal: [
    // Bundle all internal workspace packages
    /@alpclaw\/.*/,
  ],
  external: [
    // Externalize all actual NPM node_modules
    "dotenv", "ink", "react", "@clack/prompts", "marked", "marked-terminal", "telegraf"
  ]
});
