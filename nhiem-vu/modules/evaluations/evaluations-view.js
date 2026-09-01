import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260901.V1_21_1";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
