import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260904.V1_23_0";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
