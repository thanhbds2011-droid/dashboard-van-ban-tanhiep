import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260727.V1_1_0";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
