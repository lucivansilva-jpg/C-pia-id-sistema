// Read-only presentation helpers. All amounts remain integer cents from the authorized API.
(function(root){
 const day=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now||new Date());
 const addDays=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 function period(key,today=day()){let from=today;if(key==='week'){const weekday=new Date(today+'T12:00:00Z').getUTCDay();from=addDays(today,-((weekday+6)%7))}if(key==='month')from=today.slice(0,7)+'-01';return {from,to:today}}
 function validRange(from,to){const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;return valid(from)&&valid(to)&&from<=to&&(Date.parse(to)-Date.parse(from))/86400000<367}
 function summarize(data,today=day()){
  const summary=data.report?.summary||null,orders=data.orders?.orders||null,tables=data.tables?.tables||null,finance=data.finance||null,cash=data.cash||null;
  const open=orders?.filter(o=>o.state==='open')||null,delivery=orders?.filter(o=>o.state!=='cancelled'&&o.fulfillment!=='delivered')||null;
  const occupied=tables?.filter(t=>t.active!==false&&t.active!==0&&t.order&&t.order.state!=='cancelled'&&(t.order.state==='open'||t.order.fulfillment!=='delivered'))||null;
  const due=finance?.open_orders_due?.amount_cents??(open?open.reduce((n,o)=>n+(o.balance_due_cents??Math.max(0,o.total_cents-(o.paid_cents||0))),0):null);
  const accounts=finance?.accounts?.filter(a=>a.state==='pending')||[],end=addDays(today,7);
  const overdue=accounts.filter(a=>a.kind==='payable'&&a.due_date<today),upcoming=accounts.filter(a=>a.kind==='payable'&&a.due_date>=today&&a.due_date<=end),receivables=accounts.filter(a=>a.kind==='receivable'&&a.due_date<today);
  const stock=data.inventory?.items?.filter(i=>i.active!==false&&i.active!==0&&i.stock_milli<i.minimum_milli)||[];
  const lastClosed=cash?.history?.find(s=>s.state==='closed')||null;
  const waitingDrafts=Array.isArray(data.drafts?.drafts)?data.drafts.drafts.length:null;
  return {summary,openCount:open?.length??null,deliveryCount:delivery?.length??null,occupiedCount:occupied?.length??null,tableCount:tables?.filter(t=>t.active!==false&&t.active!==0).length??null,dueCents:due,waitingDrafts,cashSession:cash?.session||null,cashAvailable:!!cash,lastClosed,overdue,upcoming,receivables,lowStock:stock,limitedOrders:(orders?.length||0)>=150,limitedAccounts:(finance?.accounts?.length||0)>=300,resultIncomplete:!!summary&&(summary.estimated_result_cents==null||summary.missing_cost_quantity>0||summary.unclassified_expenses>0)};
 }
 root.OwnerOverview=Object.freeze({day,addDays,period,validRange,summarize});
})(globalThis);
