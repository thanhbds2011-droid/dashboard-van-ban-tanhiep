import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260724.FINAL2";
export async function renderReportsView(outlet){ await renderKpiWorkflow(outlet,{openReport:true}); }
