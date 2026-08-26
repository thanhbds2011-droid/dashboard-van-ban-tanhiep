/** Release marker V1.18.5 - Owner write / Firestore Rules runtime hotfix. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260826.V1_18_6";
export const RELEASE_V1_18_5 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.18.5 – Owner Write Runtime Hotfix",
  features: [
    "OWNER_TASK_UPDATE_RULE_EVALUATED_FIRST",
    "SYSTEM_PROGRESS_MANAGER_BRANCH_FAIL_FAST",
    "COUNCIL_RULE_FAIL_FAST",
    "REVIEWER_RULE_FAIL_FAST",
    "V1_18_4_RULESET_PUBLISH_FIX_PRESERVED",
    "V1_18_3_MILESTONE_MIGRATION_PRESERVED",
    "PWA_CACHE_BUST_V1_18_5"
  ]
});
