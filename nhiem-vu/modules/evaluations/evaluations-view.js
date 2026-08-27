import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260826.V1_19_0";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
