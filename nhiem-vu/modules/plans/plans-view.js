import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=1.0.0";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
