import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260727.2";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
