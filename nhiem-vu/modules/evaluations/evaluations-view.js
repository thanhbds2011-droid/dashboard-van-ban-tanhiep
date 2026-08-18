import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260818.V1_11_4";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
