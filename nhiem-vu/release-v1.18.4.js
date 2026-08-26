/** Release marker V1.18.4 - Firestore Rules publish compiler hotfix. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260826.V1_18_4";
export const RELEASE_V1_18_4 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.18.4 – Firestore Rules Publish Hotfix",
  features: [
    "FIRESTORE_RULES_UNUSED_HELPER_CLEANUP",
    "FIRESTORE_RULES_PUBLISH_PREFLIGHT",
    "V1_18_3_PERMISSION_MATRIX_PRESERVED",
    "V1_18_3_MILESTONE_MIGRATION_PRESERVED",
    "PWA_RELEASE_TRACEABILITY"
  ]
});
