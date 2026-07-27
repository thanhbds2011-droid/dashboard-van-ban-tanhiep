import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260727.2";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports", openReport: true });
}
