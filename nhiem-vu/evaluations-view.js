import { renderKpiWorkflow } from "./modules/kpi/kpi-workflow.js?v=20260904.V1_22_7";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
