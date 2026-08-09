import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260809.V1_10_2";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
