import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260803.V1_7_0";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
