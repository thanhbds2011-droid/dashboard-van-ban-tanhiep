import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260826.V1_18_5";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
