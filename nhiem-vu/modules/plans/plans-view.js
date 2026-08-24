import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260824.V1_14_1";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
