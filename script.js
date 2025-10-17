/* ===================================================================
   ERP MAY MẶC – SPA Frontend (v2.1: tách hóa đơn + lưu Nợ cũ)
   =================================================================== */
const API_URL = "/.netlify/functions/gas";

/* Helpers */
const $  = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
const fmtVND = (n)=> (Number(n||0)).toLocaleString("vi-VN")+" VND";
const todayStr = ()=>{const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),dd=String(d.getDate()).padStart(2,"0"); return `${y}/${m}/${dd}`;};
const toObjects=(h,rows)=>rows.map(r=>{const o={}; h.forEach((k,i)=>o[k]=r[i]); return o;});
function renderTableArray(headers,data){
  if(!data?.length) return `<div class="muted">—</div>`;
  let html=`<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>`;
  data.forEach(r=>{ html+=`<tr>${headers.map(h=>`<td${/SL|Số lượng|Đơn giá|Thành tiền|Tổng|Nợ|Trả/i.test(h)?' class="right"':""}>${r[h]??""}</td>`).join("")}</tr>`; });
  return html+`</tbody></table>`;
}

/* API */
async function apiGet(sheet){ const r=await fetch(`${API_URL}?sheet=${encodeURIComponent(sheet)}`); return r.json(); }
async function apiPost(body){ const r=await fetch(API_URL,{method:"POST",headers:{ "Content-Type":"application/json; charset=utf-8"},body:JSON.stringify(body)}); return r.json(); }
async function getDebt(khach){ try{ const r=await apiPost({action:"getDebt",khach}); return r?.ok?Number(r.debt||0):0;}catch{return 0;} }

/* Offline queue */
const SYNC_KEY="erp_sync_queue_v2"; const getQueue=()=>JSON.parse(localStorage.getItem(SYNC_KEY)||"[]"); const setQueue=(q)=>localStorage.setItem(SYNC_KEY,JSON.stringify(q));
function toast(msg,type="info"){const t=document.createElement("div"); Object.assign(t.style,{position:"fixed",right:"16px",bottom:"16px",background:type==="error"?"#d9534f":type==="success"?"#28a745":"#111",color:"#fff",padding:"10px 12px",borderRadius:"10px",boxShadow:"0 8px 22px rgba(0,0,0,.25)",zIndex:9999,fontSize:"14px"}); t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2200);}
async function safePost(body){ try{ const r=await apiPost(body); if(!r.ok) throw new Error(r.error||"API error"); return r; }catch(e){ const q=getQueue(); q.push({body,ts:Date.now()}); setQueue(q); toast("🔌 Mất mạng – đã xếp yêu cầu vào hàng đợi"); return {ok:false,queued:true}; }}
setInterval(async()=>{const q=getQueue(); if(!q.length) return; try{const r=await apiPost(q[0].body); if(r.ok){q.shift(); setQueue(q); toast("✅ Đồng bộ thành công","success");}}catch{}},5000);

/* State */
const state={ products:[], orders:[], orderLines:[], payments:[], cacheAt:0 };
const CACHE_TTL=60*1000;
async function loadProducts(invalidate=false){
  const now=Date.now(); if(!invalidate && state.products.length && now-state.cacheAt<CACHE_TTL) return;
  const rs=await apiGet("SanPham"); const rows=rs.ok?rs.rows:[]; if(!rows?.length){state.products=[]; return;}
  const h=rows[0]; state.products=toObjects(h,rows.slice(1)).map(o=>({"Mã SP":o["Mã SP"]||o["MaSP"]||"","Tên sản phẩm":o["Tên sản phẩm"]||o["TenSP"]||"","Size":o["Size"]||"","Giá":Number(o["Giá"]||o["Gia"]||0)})); state.cacheAt=now;
}
async function loadOrders(invalidate=false){
  const now=Date.now(); if(!invalidate && state.orders.length && now-state.cacheAt<CACHE_TTL) return;
  const rs=await apiGet("DonHang"); const rows=rs.ok?rs.rows:[]; if(!rows?.length){state.orders=[]; return;}
  const h=rows[0];
  state.orders=toObjects(h,rows.slice(1)).map(o=>({
    ma:o["MaDon"]||o["Mã đơn"]||"",
    khach:o["KhachHang"]||o["Khách hàng"]||"",
    ngay:o["NgayTao"]||o["Ngày tạo"]||"",
    tong:Number(o["TongTien"]||o["Tổng tiền"]||0),
    paid:Number(o["KhachTra"]||o["Khách trả"]||0),
    nocu:Number(o["NoCu"]||o["Nợ cũ"]||0),
    debt_after:Number(o["ConNo"]||o["Còn nợ"]||0),
    note:o["GhiChu"]||o["Ghi chú"]||""
  }));
  state.cacheAt=now;
}
async function loadOrderDetails(ma){
  const rs=await apiGet("ChiTietDonHang"); const rows=rs.ok?rs.rows:[]; if(!rows?.length) return [];
  const h=rows[0];
  return toObjects(h,rows.slice(1)).map(o=>({
    ma:o["MaDon"]||o["Mã đơn"]||"",
    ten:o["TenSP"]||o["Tên sản phẩm"]||"",
    so_luong:Number(o["SL"]||o["Số lượng"]||0),
    don_gia:Number(o["DonGia"]||o["Đơn giá"]||0),
    thanh_tien:Number(o["ThanhTien"]||o["Thành tiền"]||0),
  })).filter(x=>x.ma===ma);
}
async function loadPaymentsByOrder(ma){
  const rs=await apiGet("CongNo"); const rows=rs.ok?rs.rows:[]; if(!rows?.length) return [];
  const h=rows[0]; const idx={Loai:h.indexOf("Loai")>-1?h.indexOf("Loai"):h.indexOf("Loại"), SoTien:h.indexOf("SoTien")>-1?h.indexOf("SoTien"):h.indexOf("Số tiền"), GhiChu:h.indexOf("GhiChu")>-1?h.indexOf("GhiChu"):h.indexOf("Ghi chú"), MaDon:h.indexOf("MaDon")>-1?h.indexOf("MaDon"):h.indexOf("Mã đơn")};
  return rows.slice(1).filter(r=>String(r[idx.MaDon]||"")===ma && String(r[idx.Loai]||"")==="TT")
    .map(r=>({ "Số tiền":fmtVND(r[idx.SoTien]||0), "Ghi chú":r[idx.GhiChu]||"" }));
}

/* Layout helpers */
const appEl=()=>$("#app"); const shellEl=()=>$("#dashboard-shell");
function toggleShell(show){ const sh=shellEl(),app=appEl(); if(!sh||!app) return; sh.classList.toggle("hidden",!show); app.classList.toggle("hidden",show); if(!show) window.scrollTo({top:0,behavior:"smooth"}); }

/* PAGES */
// Dashboard
async function pageOverview(){ appEl().innerHTML=""; }

/* Product */
async function pageProduct(){
  toggleShell(false);
  appEl().innerHTML=`
    <div class="card"><h2>📦 Sản phẩm</h2>
      <div class="row"><div class="col"><label>Tên</label><input id="sp-ten"></div><div class="col"><label>Size</label><input id="sp-size"></div></div>
      <div class="row"><div class="col"><label>Giá</label><input id="sp-gia" type="number" value="0"></div><div class="col" style="display:flex;align-items:flex-end"><button class="primary" id="btn-add-sp">💾 Lưu</button></div></div>
    </div>
    <div class="card"><h3>📋 Danh sách</h3><div id="sp-list">Đang tải...</div></div>`;
  $("#btn-add-sp").onclick=async()=>{const ten=$("#sp-ten").value.trim(),size=$("#sp-size").value.trim(),gia=Number($("#sp-gia").value||0); if(!ten||!size||gia<=0) return alert("Thiếu thông tin"); const rs=await safePost({action:"createProduct",data:{ten,size,gia}}); if(rs.ok){toast("Đã lưu","success"); await loadProducts(true); renderList(); $("#sp-ten").value=$("#sp-size").value=""; $("#sp-gia").value=0;}};
  await loadProducts(); function renderList(){ $("#sp-list").innerHTML=renderTableArray(["Mã SP","Tên sản phẩm","Size","Giá"],state.products);} renderList();
}

/* Order create (nhiều khoản trả + Nợ cũ hiển thị rõ) */
async function pageOrder(){
  toggleShell(false);
  appEl().innerHTML=`
    <div class="card">
      <h2>🧾 Tạo đơn hàng</h2>
      <div class="row"><div class="col"><label>Khách hàng</label><input id="dh-khach" placeholder="Tên KH"></div><div class="col"><label>Ngày</label><input id="dh-ngay" value="${todayStr()}"></div></div>

      <div class="row"><div class="col"><label>Sản phẩm</label><select id="dh-sp"></select></div><div class="col"><label>Số lượng</label><input id="dh-sl" type="number" value="1"></div></div>
      <div class="row"><div class="col"><label>Đơn giá</label><input id="dh-gia" type="number" value="0"></div><div class="col" style="display:flex;gap:8px;align-items:flex-end"><button class="primary" id="btn-add-line">➕ Thêm vào đơn</button><button class="danger" id="btn-clear-lines">🗑 Xóa</button></div></div>
    </div>

    <div class="card">
      <h3>📋 Sản phẩm trong đơn</h3>
      <div id="dh-lines">Chưa có dòng</div>

      <div class="subcard" style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3>💵 Khách trả (nhiều dòng)</h3>
          <button class="primary" id="btn-add-pay">+ Thêm dòng</button>
        </div>
        <div id="pay-rows" style="margin-top:8px"></div>
      </div>

      <div class="row" style="margin-top:10px"><div class="col"><label>Ghi chú</label><input id="dh-note" placeholder="ghi chú..."></div><div class="col"></div></div>

      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="muted">🧮 Tổng tạm tính: <b id="dh-sum">0 VND</b></div>
        <div class="muted right">📦 Nợ cũ (ghi vào HĐ): <b id="dh-old-debt">0 VND</b></div>
        <div class="muted">💵 Tổng khách trả: <b id="dh-paid-show">0 VND</b></div>
        <div class="muted right">🧾 Còn nợ sau HĐ: <b id="dh-debt-after">0 VND</b></div>
      </div>

      <div style="margin-top:10px"><button class="primary" id="btn-save-order" disabled>✅ Lưu đơn</button></div>
    </div>`;
  // products
  await loadProducts(); const sel=$("#dh-sp"); sel.innerHTML=(state.products||[]).map(p=>`<option value="${p["Tên sản phẩm"]}" data-gia="${p["Giá"]}">${p["Tên sản phẩm"]} — ${fmtVND(p["Giá"])}</option>`).join(""); const syncPrice=()=>{$("#dh-gia").value=sel.selectedOptions[0]?.getAttribute("data-gia")||0;}; syncPrice(); sel.onchange=syncPrice;

  let oldDebt=0; let sum=0; state.orderLines=[]; state.payments=[];

  async function refreshDebt(){ const kh=$("#dh-khach").value.trim(); if(!kh){oldDebt=0; updateTotals(); return;} oldDebt=await getDebt(kh); updateTotals(); }
  ["change","blur"].forEach(ev=>$("#dh-khach").addEventListener(ev,refreshDebt));

  $("#btn-add-line").onclick=()=>{const ten=$("#dh-sp").value, sl=Number($("#dh-sl").value||0), gia=Number($("#dh-gia").value||0); if(!ten||sl<=0||gia<=0) return; state.orderLines.push({"Tên":ten,"Số lượng":sl,"Đơn giá":gia,"Thành tiền":sl*gia}); renderLines();};
  $("#btn-clear-lines").onclick=()=>{state.orderLines=[]; renderLines();};
  $("#btn-add-pay").onclick=()=>{state.payments.push({amount:0,note:""}); renderPays();};

  function renderPays(){
    const wrap=$("#pay-rows");
    if(!state.payments.length){ wrap.innerHTML=`<div class="muted">Chưa có dòng thanh toán</div>`; updateTotals(); return; }
    wrap.innerHTML=state.payments.map((p,i)=>`
      <div class="row" data-pay="${i}">
        <div class="col"><input type="number" min="0" value="${p.amount}" placeholder="Số tiền (VND)"></div>
        <div class="col" style="display:flex;gap:8px">
          <input value="${p.note||""}" placeholder="Ghi chú (tiền mặt/chuyển khoản/...)">
          <button class="danger" data-del="${i}">Xóa</button>
        </div>
      </div>`).join("");
    $$("#pay-rows [data-pay]").forEach(row=>{
      const i=Number(row.dataset.pay); const [money,note]=row.querySelectorAll("input");
      money.oninput=e=>{state.payments[i].amount=Number(e.target.value||0); updateTotals();};
      note.oninput=e=>{state.payments[i].note=e.target.value||"";};
    });
    $$("#pay-rows [data-del]").forEach(b=>b.onclick=()=>{state.payments.splice(Number(b.dataset.del),1); renderPays();});
    updateTotals();
  }
  function paysSum(){ return state.payments.reduce((s,p)=>s+Number(p.amount||0),0); }

  $("#btn-save-order").onclick=async()=>{
    const khach=$("#dh-khach").value.trim(); const ngay=$("#dh-ngay").value.trim(); const note=$("#dh-note").value.trim();
    if(!khach || !ngay || !state.orderLines.length) return;
    const total=state.orderLines.reduce((s,x)=>s+x["Thành tiền"],0); const paid=paysSum(); const debt_after=oldDebt+total-paid;
    const details=state.orderLines.map(x=>({ten:x["Tên"],so_luong:x["Số lượng"],don_gia:x["Đơn giá"]}));
    const payments=state.payments.map(p=>({so_tien:Number(p.amount||0),ghi_chu:p.note||""}));
    const rs=await safePost({action:"createOrder", order:{khach,ngay,total,paid,debt_before:oldDebt,debt_after,note}, details, payments});
    alert(rs.ok?`Đã lưu ${rs.ma_don}`:"Đã lưu chờ (offline)");
    state.orderLines=[]; state.payments=[]; oldDebt=0; $("#dh-khach").value=""; $("#dh-note").value=""; renderLines(); renderPays();
  };

  function updateTotals(){ sum=state.orderLines.reduce((s,x)=>s+x["Thành tiền"],0); const paid=paysSum(); const after=oldDebt+sum-paid; $("#dh-sum").textContent=fmtVND(sum); $("#dh-old-debt").textContent=fmtVND(oldDebt); $("#dh-paid-show").textContent=fmtVND(paid); $("#dh-debt-after").textContent=fmtVND(after); }
  function renderLines(){ if(!state.orderLines.length){ $("#dh-lines").innerHTML="Chưa có dòng"; $("#btn-save-order").disabled=true; updateTotals(); return; } $("#dh-lines").innerHTML=renderTableArray(["Tên","Số lượng","Đơn giá","Thành tiền"],state.orderLines); $("#btn-save-order").disabled=false; updateTotals(); }
  renderLines(); renderPays();
}

/* Orders view – TÁCH HÓA ĐƠN, có NỢ CŨ & danh sách thanh toán theo hóa đơn */
async function pageOrdersView(){
  toggleShell(false);
  appEl().innerHTML=`
    <div class="card">
      <h2>📚 Quản lý đơn hàng</h2>
      <div class="list-head"><input class="search" id="od-search" placeholder="Tìm theo mã đơn/khách"><button id="od-reload">🔄 Refresh</button></div>
    </div>
    <div class="card"><div id="od-table">Đang tải...</div></div>
    <div class="card"><h3>👁️ Chi tiết hóa đơn</h3><div id="od-detail">Chọn 1 hóa đơn để xem.</div></div>`;
  $("#od-reload").onclick=async()=>{await loadOrders(true); render();}; $("#od-search").oninput=()=>render();
  await loadOrders(); render();

  function render(){
    const q=($("#od-search").value||"").toLowerCase();
    // KHÔNG gộp – mỗi row DonHang là 1 hóa đơn
    const data = q? state.orders.filter(o=>(o.ma||"").toLowerCase().includes(q)||(o.khach||"").toLowerCase().includes(q)) : state.orders;
    let html=`<table><thead><tr>
      <th>Mã đơn</th><th>Khách hàng</th><th>Ngày</th>
      <th class="right">Nợ cũ</th><th class="right">Tổng</th><th class="right">Khách trả</th><th class="right">Còn nợ</th><th></th>
    </tr></thead><tbody>`;
    data.forEach(o=>{
      html+=`<tr>
        <td>${o.ma}</td><td>${o.khach}</td><td>${o.ngay}</td>
        <td class="right">${fmtVND(o.nocu)}</td>
        <td class="right">${fmtVND(o.tong)}</td>
        <td class="right">${fmtVND(o.paid)}</td>
        <td class="right">${fmtVND(o.debt_after)}</td>
        <td><button data-view="${o.ma}">Chi tiết</button></td>
      </tr>`;
    });
    html+=`</tbody></table>`;
    $("#od-table").innerHTML=html;

    $$("#od-table [data-view]").forEach(btn=>{
      btn.onclick=async()=>{ const ma=btn.getAttribute("data-view"); const o=state.orders.find(x=>x.ma===ma);
        const details=await loadOrderDetails(ma);
        const pays=await loadPaymentsByOrder(ma);
        const rows=details.map(d=>({"Tên sản phẩm":d.ten,"Số lượng":d.so_luong,"Đơn giá":fmtVND(d.don_gia),"Thành tiền":fmtVND(d.thanh_tien>0?d.thanh_tien:d.so_luong*d.don_gia)}));
        const total=details.reduce((s,x)=>s+(x.thanh_tien>0?x.thanh_tien:x.so_luong*x.don_gia),0);
        $("#od-detail").innerHTML = `
          <div class="muted">Mã đơn: <b>${o.ma}</b> — Ngày: ${o.ngay} — Khách: <b>${o.khach}</b></div>
          <div class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
            <div>
              <h4>Hàng hóa</h4>
              ${renderTableArray(["Tên sản phẩm","Số lượng","Đơn giá","Thành tiền"],rows)}
              <div class="right" style="margin-top:6px;font-weight:700">Tổng: ${fmtVND(total)}</div>
            </div>
            <div>
              <h4>Thanh toán của hóa đơn</h4>
              ${renderTableArray(["Số tiền","Ghi chú"], pays)}
              <div class="box" style="margin-top:8px">
                <div>🧷 Nợ cũ (ghi trong hóa đơn): <b>${fmtVND(o.nocu)}</b></div>
                <div>💵 Khách trả: <b>${fmtVND(o.paid)}</b></div>
                <div>🧾 Còn nợ sau HĐ: <b>${fmtVND(o.debt_after)}</b></div>
                <div>📝 Ghi chú: ${o.note||"—"}</div>
              </div>
            </div>
          </div>`;
      };
    });
  }
}

/* Routes */
function setActive(p){ $$(".menu-item,[data-page]").forEach(el=>{ if(el.dataset?.page) el.classList.toggle("active", el.dataset.page===p); }); }
async function loadPage(p){
  setActive(p);
  if(p==="overview"){ toggleShell(true); return pageOverview(); }
  toggleShell(false);
  if(p==="product")       return pageProduct();
  if(p==="order")         return pageOrder();
  if(p==="orders_view")   return pageOrdersView();
  if(p==="manufacturing") return pageManufacturing?.();   // giữ chỗ
  if(p==="timesheet")     return pageTimesheet?.();       // giữ chỗ
  if(p==="payroll")       return pagePayroll?.();         // giữ chỗ
  return pageOverview();
}

/* boot */
window.addEventListener("DOMContentLoaded",()=>{ if(!$("#app")){const m=document.createElement("main"); m.id="app"; document.body.appendChild(m);} toggleShell(true); loadPage("overview"); });
