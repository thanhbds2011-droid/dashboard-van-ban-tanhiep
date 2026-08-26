/** Release marker V1.18.3 - bounded task writes, full legacy milestone repair, M01 header fidelity. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260826.V1_18_3";
export const RELEASE_V1_18_3 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.18.3 – End-user Write Recovery & Milestone Compatibility",
  features: [
    "TASK_UPDATE_BOUNDED_WRITE_CONFIRMATION",
    "MILESTONE_TRANSACTION_SERVER_RECOVERY",
    "LEGACY_MILESTONE_CHILD_AND_PARENT_MIGRATION",
    "STRICT_FIRESTORE_RULES_PRESERVED",
    "M01_PART_C_HEADER_WITHOUT_SCORE_VALUE",
    "ROLE_REVIEW_MATRIX_REGRESSION_LOCK",
    "PWA_SESSION_CACHE_COMPATIBILITY"
  ]
});
