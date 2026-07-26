import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.PRODUCTION11_FINAL_STABLE";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
