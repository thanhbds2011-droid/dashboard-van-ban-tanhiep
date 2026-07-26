import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.PRODUCTION";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports", openReport: true });
}
