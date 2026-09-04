import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260904.V1_22_6";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
