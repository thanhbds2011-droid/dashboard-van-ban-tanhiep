import { renderKpiWorkflow } from "./modules/kpi/kpi-workflow.js?v=20260903.V1_22_3";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
