import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.graceylam.familytrip",
  appName: "Zora",
  webDir: "pages-dist",
  ios: {
    contentInset: "never",
    preferredContentMode: "mobile",
  },
};

export default config;
