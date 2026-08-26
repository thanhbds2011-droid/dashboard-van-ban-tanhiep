import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260825.V1_18_0";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
