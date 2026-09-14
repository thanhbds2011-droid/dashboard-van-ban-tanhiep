import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260914.V1_24_2";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
