import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260824.V1_13_0";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
