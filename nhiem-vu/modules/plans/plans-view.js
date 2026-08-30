import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260830.V1_21_0";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
