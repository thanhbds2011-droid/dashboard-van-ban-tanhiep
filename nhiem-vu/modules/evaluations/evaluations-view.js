import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260801.V1_3_1";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
