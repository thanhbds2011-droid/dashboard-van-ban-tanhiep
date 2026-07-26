import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.PRODUCTION6_FONT_LAYOUT_CACHEFIX";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
