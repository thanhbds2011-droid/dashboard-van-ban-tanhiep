import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260804.V1_7_2_2";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
