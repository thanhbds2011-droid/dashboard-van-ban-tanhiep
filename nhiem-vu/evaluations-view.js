import { renderKpiWorkflow } from "./modules/kpi/kpi-workflow.js?v=20260914.V1_24_4";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
