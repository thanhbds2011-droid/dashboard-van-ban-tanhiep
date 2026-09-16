import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260916.V1_24_7";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
