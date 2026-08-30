import { renderKpiWorkflow } from "./modules/kpi/kpi-workflow.js?v=20260830.V1_21_0";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
