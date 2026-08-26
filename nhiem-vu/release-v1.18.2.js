/** Release marker V1.18.2 - KPI report fidelity, legacy milestone repair, event-driven write recovery. */
import { APP_VERSION, BUILD_VERSION } from "./core/app-version.js?v=20260826.V1_18_2";
export const RELEASE_V1_18_2 = Object.freeze({
  version: APP_VERSION,
  build: BUILD_VERSION,
  name: "V1.18.2 – Report Fidelity & Production Write Reliability",
  features: [
    "M01_EXCEL_FIDELITY_8_COLUMNS",
    "M01_DYNAMIC_TASKS_AND_PENDING_BONUS",
    "M01_TOTAL_B_USES_PLAN_SCORE",
    "LEGACY_RECURRING_MILESTONE_MIGRATION",
    "EVENT_DRIVEN_WRITE_TIMEOUT_RECOVERY",
    "FIRESTORE_RULES_INDEXES_SOURCE_SYNC"
  ]
});
