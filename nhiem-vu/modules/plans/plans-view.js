import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260725.FIX_SCOPE1";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
