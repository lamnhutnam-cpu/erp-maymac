/* ===================================================================
   ERP MAY MẶC – SPA Frontend (v2.3)
   - Customers CRUD
   - Debts: tổng hợp + sổ cái theo khách
   - Inventory: tồn kho + nhập/xuất/điều chỉnh & nhật ký
   - Orders: giữ như phiên bản trước (NoCu + nhiều payments)
=================================================================== */

const API_URL = "/.netlify/functions/gas";

/* =============== HELPERS =============== */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const appEl   = () => $("#app");
const shellEl = () => $("#dashboard-shell");

const fmtVND = (n) => (Number(n || 0)).toLocaleString("vi-VN") + " VND";
const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${dd}`;
};
const toObjects = (headers, rows) => rows.map(r => {
  const o = {}; headers.forEach((h, i) => (o[h] = r[i])); return o;
});
function renderTableArray(headers, data) {
  if (!data?.length) return `<div class="muted">—</div>`;
  let html = `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>`;
  data.forEach(row => {
    html += `<tr>${headers.map(h=>{
      const right = /SL|Số lượng|Đơn giá|Thành tiền|Tổng|Ton|Gia|Amount|Qty|Nợ|Trả|Debt|VND/i.test(h) ? ' class="right"' : "";
      return `<td${right}>${row[h] ?? ""}</td>`;
    }).join("")}</tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

/* =============== API =============== */
async function apiGet(sheet) {
  const res = await fetch(`${API_URL}?sheet=${encodeURIComponent(sheet)}`);
  return res.json();
}
async function apiPost(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function getDebt(khach) {
  try { const r = await apiPost({ action: "getDebt", khach }); return r?.ok ? Number(r.debt || 0) : 0; }
  catch { return 0; }
}

/* =============== OFFLINE QUEUE =============== */
const SYNC_KEY = "erp_sync_queue_v2";
const getQueue = () => JSON.parse(localStorage.getItem(SYNC_KEY) || "[]");
const setQueue = (q) => localStorage.setItem(SYNC_KEY, JSON.stringify(q));
function toast(msg, type="info") {
  const t = document.createElement("div");
  Object.assign(t.style, {
    position:"fixed", right:"16px", bottom:"16px",
    background: type==="error"?"#d9534f": type==="success"?"#28a745":"#111",
    color:"#fff", padding:"10px 12px", borderRadius:"10px",
    boxShadow:"0 8px 22px rgba(0,0,0,.25)", zIndex:9999, fontSize:"14px"
  });
  t.textContent = msg; document.body.appendChild(t);
  setTimeout(()=> t.remove(), 2200);
}
async function safePost(body) {
  try {
    const r = await apiPost(body);
    if (!r.ok) throw new Error(r.error || "API error");
    return r;
  } catch (e) {
    const q = getQueue(); q.push({ body, ts: Date.now() }); setQueue(q);
    toast("🔌 Mất mạng – đã xếp yêu cầu vào hàng đợi", "info");
    return { ok:false, queued:true };
  }
}
setInterval(async () => {
  const q = getQueue(); if (!q.length) return;
  try {
    const r = await apiPost(q[0].body);
    if (r.ok) { q.shift(); setQueue(q); toast("✅ Đồng bộ thành công", "success"); }
  } catch {}
}, 5000);

/* =============== STATE & LOADERS =============== */
const state = {
  products: [],
  orders: [],
  customers: [],
  orderLines: [],
  payments: [],
  inventory: [],
  invLog: [],
  cacheAt: 0,
};
const CACHE_TTL = 60 * 1000;

async function loadProducts(invalidate=false) {
  const now = Date.now();
  if (!invalidate && state.products.length && now-state.cacheAt<CACHE_TTL) return;
  const rs = await apiGet("SanPham"); const rows = rs.ok?rs.rows:[];
  if (!rows?.length) { state.products=[]; return; }
  const h = rows[0];
  state.products = toObjects(h, rows.slice(1)).map(o => ({
    "Mã SP": o["MaSP"] || o["Mã SP"] || "",
    "Tên sản phẩm": o["TenSP"] || o["Tên sản phẩm"] || "",
    "Size": o["Size"] || "",
    "Giá": Number(o["Gia"] || o["Giá"] || 0),
  }));
  state.cacheAt = now;
}
async function loadCustomers() {
  const rs = await apiGet("KhachHang"); const rows = rs.ok?rs.rows:[];
  state.customers = rows?.length ? rows.slice(1).map(r=>({
    ma:r[0], ten:r[1], loai:r[2]||"", sdt:r[3]||"", email:r[4]||"", diachi:r[5]||"", ghichu:r[6]||""
  })) : [];
}
async function loadOrders(invalidate=false) {
  const now = Date.now();
  if (!invalidate && state.orders.length && now-state.cacheAt<CACHE_TTL) return;
  const rs = await apiGet("DonHang"); const rows = rs.ok?rs.rows:[];
  if (!rows?.length) { state.orders=[]; return; }
  const h = rows[0];
  state.orders = toObjects(h, rows.slice(1)).map(o => ({
    ma:o["MaDon"]||o["Mã đơn"]||"",
    khach:o["KhachHang"]||o["Khách hàng"]||"",
    ngay:o["NgayTao"]||o["Ngày tạo"]||"",
    tong:Number(o["TongTien"]||o["Tổng tiền"]||0),
    paid:Number(o["KhachTra"]||o["Khách trả"]||0),
    nocu:Number(o["NoCu"]||o["Nợ cũ"]||0),
    debt_after:Number(o["ConNo"]||o["Còn nợ"]||0),
    note:o["GhiChu"]||o["Ghi chú"]||""
  }));
  state.cacheAt = now;
}
async function loadOrderDetails(ma) {
  const rs = await apiGet("ChiTietDonHang"); const rows = rs.ok?rs.rows:[];
  if (!rows?.length) return [];
  const h = rows[0];
  return toObjects(h, rows.slice(1))
    .map(o=>({
      ma:o["MaDon"]||o["Mã đơn"]||"",
      ten:o["TenSP"]||o["Tên sản phẩm"]||"",
      so_luong:Number(o["SL"]||o["Số lượng"]||0),
      don_gia:Number(o["DonGia"]||o["Đơn giá"]||0),
      thanh_tien:Number(o["ThanhTien"]||o["Thành tiền"]||0),
    }))
    .filter(x=>x.ma===ma);
}
async function loadPaymentsByOrder(ma){
  const rs=await apiGet("CongNo"); const rows=rs.ok?rs.rows:[]; if(!rows?.length) return [];
  const h=rows[0]; const idx={Loai:h.indexOf("Loai")>-1?h.indexOf("Loai"):h.indexOf("Loại"), SoTien:h.indexOf("SoTien")>-1?h.indexOf("SoTien"):h.indexOf("Số tiền"), GhiChu:h.indexOf("GhiChu")>-1?h.indexOf("GhiChu"):h.indexOf("Ghi chú"), MaDon:h.indexOf("MaDon")>-1?h.indexOf("MaDon"):h.indexOf("Mã đơn")};
  return rows.slice(1).filter(r=>String(r[idx.MaDon]||"")===ma && String(r[idx.Loai]||"")==="TT")
    .map(r=>({ "Số tiền":fmtVND(r[idx.SoTien]||0), "Ghi chú":r[idx.GhiChu]||"" }));
}

/* Inventory loaders */
async function loadInventory() {
  const rs = await safePost({ action:"invList" });
  if (!rs.ok) { state.inventory=[]; return; }
  const rows = rs.rows || [];
  if (!rows.length) { state.inventory=[]; return; }
  const h = rows[0];
  state.inventory = toObjects(h, rows.slice(1)).map(o => ({
    MaSP:o["MaSP"]||"", TenSP:o["TenSP"]||"", Size:o["Size"]||"", Ton:Number(o["Ton"]||0), GhiChu:o["GhiChu"]||""
  }));
}
async function syncInventoryFromProducts(){
  const rs = await safePost({ action:"invSyncFromProducts" });
  return rs.ok ? rs.created : -1;
}

/* =============== LAYOUT TOGGLE =============== */
function toggleShell(showShell) {
  const sh = shellEl(), app = appEl(); if (!sh || !app) return;
  sh.classList.toggle("hidden", !showShell);
  app.classList.toggle("hidden", showShell);
  if (!showShell) window.scrollTo({ top:0, behavior:"smooth" });
}

/* =============== PAGES =============== */
// Dashboard
async function pageOverview() { appEl().innerHTML = ""; }

/* ---- Customers (create / update / delete) ---- */
async function pageCustomers() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="page-head"><h1>Quản lý Khách hàng</h1></div>
    <div class="card">
      <div class="quick-3">
        <button class="quick big" id="kh-add"><div class="q-icon">👥➕</div><div>Thêm khách hàng</div></button>
        <div class="quick big"><div class="q-icon">🔎</div><div><input id="kh-search" class="search w-full" placeholder="Tìm tên, SĐT, email..."></div></div>
        <button class="quick big" id="kh-export"><div class="q-icon">📊</div><div>Xuất báo cáo</div></button>
      </div>
    </div>
    <div class="card"><div class="list-head"><h3 id="kh-count">Danh sách Khách hàng</h3></div><div id="kh-list" class="kh-list"></div></div>

    <div id="kh-modal" class="modal hidden">
      <div class="modal-body">
        <h3 id="kh-title">➕ Thêm khách hàng</h3>
        <input type="hidden" id="m-ma">
        <div class="row">
          <div class="col"><label>Tên <span class="req">*</span></label><input id="m-ten"></div>
          <div class="col"><label>Loại <span class="req">*</span></label>
            <select id="m-loai"><option value="">Chọn</option><option>Cá nhân</option><option>Doanh nghiệp</option><option>Khác</option></select>
          </div>
        </div>
        <div class="row">
          <div class="col"><label>SĐT <span class="req">*</span></label><input id="m-sdt"></div>
          <div class="col"><label>Email</label><input id="m-email"></div>
        </div>
        <div><label>Địa chỉ</label><input id="m-diachi"></div>
        <div><label>Ghi chú</label><textarea id="m-ghichu" rows="3"></textarea></div>
        <div class="right" style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn" id="m-cancel">Hủy</button>
          <button class="btn primary" id="m-save">Lưu</button>
        </div>
      </div>
    </div>
  `;

  const modal = $("#kh-modal");
  const openModal = ()=> modal.classList.remove("hidden");
  const closeModal = ()=> modal.classList.add("hidden");
  const f = { ma:$("#m-ma"), ten:$("#m-ten"), loai:$("#m-loai"), sdt:$("#m-sdt"), email:$("#m-email"), diachi:$("#m-diachi"), ghichu:$("#m-ghichu"), title:$("#kh-title"), save:$("#m-save"), cancel:$("#m-cancel") };
  let mode = "create";
  const initials = name => (String(name||"").split(" ").filter(Boolean).slice(-2).map(s=>s[0]).join("").toUpperCase()) || "KH";

  await loadCustomers(); render("");

  function render(keyword="") {
    const k = keyword.toLowerCase();
    const list = k ? state.customers.filter(x =>
      (x.ten||"").toLowerCase().includes(k) ||
      (x.sdt||"").toLowerCase().includes(k) ||
      (x.email||"").toLowerCase().includes(k)
    ) : state.customers;

    $("#kh-count").textContent = `Danh sách Khách hàng (${list.length})`;
    if (!list.length) { $("#kh-list").innerHTML = `<div class="muted">Chưa có dữ liệu</div>`; return; }

    $("#kh-list").innerHTML = list.map(x => `
      <div class="kh-card" data-item="${x.ma}">
        <div class="kh-left">
          <div class="avatar">${initials(x.ten)}</div>
          <div class="kh-info">
            <div class="kh-name">${x.ten} <span class="muted">(${x.ma})</span> ${x.loai?`<span class="badge gray">${x.loai}</span>`:""}</div>
            <div class="kh-line">
              ${x.sdt?`<span>📞 ${x.sdt}</span>`:""}
              ${x.email?`<span>✉️ ${x.email}</span>`:""}
              ${x.diachi?`<span>📍 ${x.diachi}</span>`:""}
            </div>
          </div>
        </div>
        <div class="kh-right">
          <div class="kh-actions">
            <button class="btn sm info" data-act="detail" data-id="${x.ma}">Chi tiết</button>
            <button class="btn sm primary" data-act="edit" data-id="${x.ma}">Sửa</button>
            <button class="btn sm danger" data-act="delete" data-id="${x.ma}">Xóa</button>
          </div>
        </div>
      </div>
    `).join("");
  }

  $("#kh-search").oninput = e => render(e.target.value || "");
  $("#kh-export").onclick = () => alert("Xuất trực tiếp từ Google Sheets (bổ sung sau).");

  $("#kh-add").onclick = () => {
    mode = "create";
    f.title.textContent = "➕ Thêm khách hàng";
    f.save.textContent  = "Thêm khách hàng";
    f.ma.value = f.ten.value = f.loai.value = f.sdt.value = f.email.value = f.diachi.value = f.ghichu.value = "";
    openModal();
  };
  f.cancel.onclick = closeModal;

  f.save.onclick = async () => {
    const payload = { ten:f.ten.value.trim(), loai:f.loai.value.trim(), sdt:f.sdt.value.trim(), email:f.email.value.trim(), diachi:f.diachi.value.trim(), ghichu:f.ghichu.value.trim() };
    if (!payload.ten)  return alert("Vui lòng nhập Tên");
    if (!payload.loai) return alert("Vui lòng chọn Loại");
    if (!payload.sdt)  return alert("Vui lòng nhập SĐT");

    let rs;
    if (mode==="create") rs = await safePost({ action:"createCustomer", data: payload });
    else rs = await safePost({ action:"updateCustomer", data:{ ma:f.ma.value, ...payload }});

    if (!rs.ok && !rs.queued) return alert(rs.error || "Lỗi lưu");
    closeModal(); await loadCustomers(); render($("#kh-search").value || "");
    toast(mode==="create" ? (rs.ok?`Đã tạo KH ${rs.ma_kh||""}`:"Đã lưu chờ") : (rs.ok?"Đã cập nhật":"Đã lưu chờ"), "success");
  };

  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest(".kh-actions .btn");
    if (!b || !$("#kh-list").contains(b)) return;
    const id = b.dataset.id;
    const row = state.customers.find(x=>x.ma===id);
    const act = b.dataset.act;

    if (act==="detail") {
      // kèm nợ hiện tại
      const debt = await getDebt(row.ten);
      alert(`Mã: ${row.ma}
Tên: ${row.ten}
Loại: ${row.loai}
SĐT: ${row.sdt}
Email: ${row.email}
Địa chỉ: ${row.diachi}
Ghi chú: ${row.ghichu}
Công nợ hiện tại: ${fmtVND(debt)}`);
    }
    if (act==="edit") {
      mode="edit";
      f.title.textContent="✏️ Sửa khách hàng"; f.save.textContent="Cập nhật";
      f.ma.value=row.ma; f.ten.value=row.ten; f.loai.value=row.loai; f.sdt.value=row.sdt; f.email.value=row.email; f.diachi.value=row.diachi; f.ghichu.value=row.ghichu;
      openModal();
    }
    if (act==="delete") {
      if (!confirm(`Xóa khách hàng ${row.ten} (${row.ma})?`)) return;
      const rs = await safePost({ action:"deleteCustomer", data:{ ma:row.ma }});
      if (!rs.ok && !rs.queued) return alert(rs.error || "Không xóa được");
      await loadCustomers(); render($("#kh-search").value || ""); toast(rs.ok?"Đã xóa":"Đã xếp hàng đợi", "success");
    }
  });
}

/* ---- Debts (Công nợ) ---- */
async function pageDebts(){
  toggleShell(false);
  appEl().innerHTML = `
    <div class="card">
      <h2>💳 Công nợ</h2>
      <div class="row">
        <div class="col"><label>Tìm khách</label><input id="debt-kh" placeholder="Nhập đúng tên KH (giống trong hệ thống)"></div>
        <div class="col" style="display:flex;align-items:flex-end;gap:8px">
          <button class="primary" id="btn-debt-ledger">Xem sổ cái</button>
          <button id="btn-debt-summary">Tổng hợp</button>
        </div>
      </div>
    </div>
    <div class="card"><h3>📌 Kết quả</h3><div id="debt-result">—</div></div>
  `;

  $("#btn-debt-summary").onclick = async () => {
    const rs = await safePost({ action:"reportDebtSummary" });
    if (!rs.ok) { $("#debt-result").innerHTML="⚠️ Không tải được."; return; }
    const rows = (rs.rows||[]).map(x=>({ "Khách hàng":x.KhachHang, "Công nợ": fmtVND(x.Debt)}));
    $("#debt-result").innerHTML = renderTableArray(["Khách hàng","Công nợ"], rows) +
      `<div class="right" style="margin-top:8px">Tổng công nợ: <b>${fmtVND(rs.total||0)}</b></div>`;
  };

  $("#btn-debt-ledger").onclick = async () => {
    const kh = $("#debt-kh").value.trim();
    if (!kh) return alert("Nhập tên khách");
    const rs = await safePost({ action:"getLedger", khach: kh });
    if (!rs.ok) { $("#debt-result").innerHTML="⚠️ Không tải được."; return; }
    const rows = (rs.timeline||[]).map(x=>({
      "Ngày":x.Ngay, "Loại":x.Loai, "Số tiền":fmtVND(x.SoTien), "Biến động":fmtVND(x.BienDong), "Số dư":fmtVND(x.SoDu), "Mã đơn":x.MaDon||""
    }));
    $("#debt-result").innerHTML = `<div class="muted">Khách: <b>${kh}</b> — Số dư hiện tại: <b>${fmtVND(rs.debt||0)}</b></div>` +
      renderTableArray(["Ngày","Loại","Số tiền","Biến động","Số dư","Mã đơn"], rows);
  };
}

/* ---- Inventory (Kho hàng) ---- */
async function pageInventory(){
  toggleShell(false);
  appEl().innerHTML = `
    <div class="card">
      <h2>📦 Kho hàng</h2>
      <div class="row">
        <div class="col"><label>Tìm kiếm</label><input id="inv-search" placeholder="Tên SP/Size..."></div>
        <div class="col" style="display:flex;align-items:flex-end;gap:8px">
          <button class="primary" id="inv-sync">Đồng bộ từ Sản phẩm</button>
          <button id="inv-reload">🔄 Refresh</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="list-head"><h3>Tồn kho</h3></div>
      <div id="inv-table">Đang tải...</div>
    </div>

    <div class="card">
      <h3>➕ Nhập/Xuất/Điều chỉnh</h3>
      <div class="row">
        <div class="col"><label>Tên SP</label><input id="adj-ten"></div>
        <div class="col"><label>Size</label><input id="adj-size"></div>
      </div>
      <div class="row">
        <div class="col"><label>Loại</label>
          <select id="adj-type">
            <option>NHAP</option><option>XUAT</option><option>DIEUCHINH+</option><option>DIEUCHINH-</option>
          </select>
        </div>
        <div class="col"><label>Số lượng</label><input id="adj-sl" type="number" value="1"></div>
      </div>
      <div class="row">
        <div class="col"><label>Ghi chú</label><input id="adj-note" placeholder="phiếu nhập/xuất..."></div>
        <div class="col" style="display:flex;align-items:flex-end"><button class="primary" id="adj-save">Ghi</button></div>
      </div>
    </div>
  `;

  const render = (kw="") => {
    const q = kw.toLowerCase();
    const list = q ? state.inventory.filter(x =>
      (x.TenSP||"").toLowerCase().includes(q) || (x.Size||"").toLowerCase().includes(q)
    ) : state.inventory;
    const rows = list.map(x=>({ "Mã SP":x.MaSP||"", "Tên SP":x.TenSP, "Size":x.Size, "Tồn":x.Ton, "Ghi chú":x.GhiChu||"" }));
    $("#inv-table").innerHTML = renderTableArray(["Mã SP","Tên SP","Size","Tồn","Ghi chú"], rows);
  };

  $("#inv-search").oninput = (e)=>render(e.target.value||"");
  $("#inv-reload").onclick = async ()=>{ await loadInventory(); render($("#inv-search").value||""); };
  $("#inv-sync").onclick = async ()=>{
    const created = await syncInventoryFromProducts();
    if (created>=0) { toast(`Đã đồng bộ ${created} dòng`, "success"); await loadInventory(); render($("#inv-search").value||""); }
    else alert("Không đồng bộ được.");
  };
  $("#adj-save").onclick = async ()=>{
    const data = {
      TenSP: $("#adj-ten").value.trim(),
      Size:  $("#adj-size").value.trim(),
      Loai:  $("#adj-type").value,
      SL:    Number($("#adj-sl").value||0),
      GhiChu:$("#adj-note").value.trim(),
    };
    if (!data.TenSP || !data.Size || !data.SL) return alert("Điền đủ Tên/Size/SL");
    const rs = await safePost({ action:"invAdjust", data });
    if (!rs.ok && !rs.queued) return alert(rs.error || "Ghi kho thất bại");
    toast(rs.ok?`Tồn mới: ${rs.ton}`:"Đã lưu chờ", "success");
    await loadInventory(); render($("#inv-search").value||"");
  };

  await loadInventory(); render();
}

/* ---- Product (giữ nguyên CRUD đơn giản) ---- */
async function pageProduct() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="card">
      <h2>📦 Sản phẩm</h2>
      <div class="row">
        <div class="col"><label>Tên</label><input id="sp-ten"></div>
        <div class="col"><label>Size</label><input id="sp-size" placeholder="S/M/L/XL"></div>
      </div>
      <div class="row">
        <div class="col"><label>Giá (VND)</label><input id="sp-gia" type="number" value="0"></div>
        <div class="col" style="display:flex;align-items:flex-end"><button class="primary" id="btn-add-sp">💾 Lưu sản phẩm</button></div>
      </div>
    </div>
    <div class="card"><h3>📋 Danh sách sản phẩm</h3><div id="sp-list">Đang tải...</div></div>
  `;

  $("#btn-add-sp").onclick = async () => {
    const ten  = $("#sp-ten").value.trim();
    const size = $("#sp-size").value.trim();
    const gia  = Number($("#sp-gia").value || 0);
    if (!ten || !size || gia<=0) return alert("Thiếu thông tin");
    const rs = await safePost({ action:"createProduct", data:{ ten, size, gia }});
    if (rs.ok) { toast("Đã lưu!", "success"); await loadProducts(true); renderList(); $("#sp-ten").value=$("#sp-size").value=""; $("#sp-gia").value=0; }
  };

  await loadProducts(); renderList();
  function renderList() {
    $("#sp-list").innerHTML = renderTableArray(["Mã SP","Tên sản phẩm","Size","Giá"], state.products);
  }
}

/* ---- Order (create) — có công nợ & nhiều dòng KHÁCH TRẢ ---- */
async function pageOrder() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="card">
      <h2>🧾 Tạo đơn hàng</h2>
      <div class="row">
        <div class="col"><label>Khách hàng</label><input id="dh-khach" placeholder="Tên KH"></div>
        <div class="col"><label>Ngày</label><input id="dh-ngay" value="${todayStr()}"></div>
      </div>

      <div class="row">
        <div class="col"><label>Sản phẩm</label><select id="dh-sp"></select></div>
        <div class="col"><label>Số lượng</label><input id="dh-sl" type="number" value="1"></div>
      </div>
      <div class="row">
        <div class="col"><label>Đơn giá</label><input id="dh-gia" type="number" value="0"></div>
        <div class="col" style="display:flex;align-items:flex-end;gap:8px">
          <button class="primary" id="btn-add-line">➕ Thêm vào đơn</button>
          <button class="danger" id="btn-clear-lines">🗑 Xoá</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>📋 Sản phẩm trong đơn</h3>
      <div id="dh-lines">Chưa có dòng</div>

      <div class="subcard" style="margin-top:12px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <h3>💵 Khách trả (nhiều dòng)</h3>
          <button class="primary" id="btn-add-pay">+ Thêm dòng</button>
        </div>
        <div id="pay-rows" style="margin-top:8px"></div>
      </div>

      <div class="row" style="margin-top:10px">
        <div class="col"><label>Ghi chú</label><input id="dh-note" placeholder="ghi chú..."></div>
        <div class="col"></div>
      </div>

      <div style="margin-top:10px; display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div class="muted">🧮 Tổng tạm tính: <b id="dh-sum">0 VND</b></div>
        <div class="muted right">📦 Nợ cũ: <b id="dh-old-debt">0 VND</b></div>
        <div class="muted">💵 Tổng khách trả: <b id="dh-paid-show">0 VND</b></div>
        <div class="muted right">🧾 Còn nợ sau HĐ: <b id="dh-debt-after">0 VND</b></div>
      </div>

      <div style="margin-top:10px"><button class="primary" id="btn-save-order" disabled>✅ Lưu đơn</button></div>
    </div>
  `;

  await loadProducts();
  const sel = $("#dh-sp");
  sel.innerHTML = (state.products||[]).map(p =>
    `<option value="${p["Tên sản phẩm"]}" data-gia="${p["Giá"]}">${p["Tên sản phẩm"]} — ${fmtVND(p["Giá"])}</option>`
  ).join("");
  const syncPrice = () => { $("#dh-gia").value = sel.selectedOptions[0]?.getAttribute("data-gia") || 0; };
  syncPrice(); sel.onchange = syncPrice;

  let oldDebt = 0; state.orderLines=[]; state.payments=[];

  async function refreshDebt() {
    const kh = $("#dh-khach").value.trim();
    oldDebt = kh ? await getDebt(kh) : 0;
    updateTotals();
  }
  $("#dh-khach").addEventListener("change", refreshDebt);
  $("#dh-khach").addEventListener("blur", refreshDebt);

  $("#btn-add-line").onclick = () => {
    const ten = $("#dh-sp").value;
    const sl  = Number($("#dh-sl").value || 0);
    const gia = Number($("#dh-gia").value || 0);
    if (!ten || sl<=0 || gia<=0) return;
    state.orderLines.push({ "Tên":ten, "Số lượng":sl, "Đơn giá":gia, "Thành tiền": sl*gia });
    renderLines();
  };
  $("#btn-clear-lines").onclick = () => { state.orderLines=[]; renderLines(); };

  function addPaymentRow(amount=0, note="") {
    state.payments.push({ amount:Number(amount)||0, note:String(note)||"" });
    renderPayments();
  }
  function removePaymentRow(i){ state.payments.splice(i,1); renderPayments(); }
  function paymentsSum(){ return (state.payments||[]).reduce((s,p)=> s + Number(p.amount||0), 0); }
  $("#btn-add-pay").onclick = () => addPaymentRow();

  function renderPayments(){
    const wrap = $("#pay-rows");
    if (!state.payments.length) { wrap.innerHTML = `<div class="muted">Chưa có dòng thanh toán</div>`; updateTotals(); return; }
    wrap.innerHTML = state.payments.map((p,idx)=>`
      <div class="row" data-pay="${idx}">
        <div class="col"><input type="number" min="0" value="${p.amount}" placeholder="Số tiền (VND)"></div>
        <div class="col" style="display:flex;gap:8px">
          <input value="${p.note||""}" placeholder="Ghi chú (tiền mặt/chuyển khoản/...)">
          <button class="danger" data-del="${idx}">Xóa</button>
        </div>
      </div>
    `).join("");

    $$("#pay-rows [data-pay]").forEach(row=>{
      const idx = Number(row.dataset.pay);
      const inputs = $$("input", row);
      inputs[0].oninput = e => { state.payments[idx].amount = Number(e.target.value||0); updateTotals(); };
      inputs[1].oninput = e => { state.payments[idx].note   = e.target.value; };
    });
    $$("#pay-rows [data-del]").forEach(btn=>{
      btn.onclick = () => removePaymentRow(Number(btn.dataset.del));
    });
    updateTotals();
  }

  $("#btn-save-order").onclick = async () => {
    const khach = $("#dh-khach").value.trim();
    const ngay  = $("#dh-ngay").value.trim();
    const note  = $("#dh-note").value.trim();
    if (!khach || !ngay || !state.orderLines.length) return;

    const total = state.orderLines.reduce((s,x)=>s+x["Thành tiền"],0);
    const paid  = paymentsSum();
    const debt_after = oldDebt + total - paid;

    const details = state.orderLines.map(x=>({ ten:x["Tên"], so_luong:x["Số lượng"], don_gia:x["Đơn giá"] }));
    const payments = state.payments.map(p=> ({ so_tien:Number(p.amount||0), ghi_chu:p.note||"" }));

    const rs = await safePost({
      action: "createOrder",
      order: { khach, ngay, total, paid, debt_before: oldDebt, debt_after, note },
      details, payments
    });
    alert(rs.ok ? `Đã lưu ${rs.ma_don}` : "Đã lưu chờ (offline)");
    state.orderLines=[]; state.payments=[]; oldDebt=0; $("#dh-khach").value=""; $("#dh-note").value="";
    renderLines(); renderPayments();
  };

  function updateTotals() {
    const sum = state.orderLines.reduce((s,x)=>s+x["Thành tiền"],0);
    const paid = paymentsSum();
    const debt_after = oldDebt + sum - paid;
    $("#dh-sum").textContent = fmtVND(sum);
    $("#dh-old-debt").textContent = fmtVND(oldDebt);
    $("#dh-paid-show").textContent = fmtVND(paid);
    $("#dh-debt-after").textContent = fmtVND(debt_after);
  }
  function renderLines() {
    if (!state.orderLines.length) {
      $("#dh-lines").innerHTML = "Chưa có dòng";
      $("#btn-save-order").disabled = true;
      updateTotals(); return;
    }
    $("#dh-lines").innerHTML = renderTableArray(["Tên","Số lượng","Đơn giá","Thành tiền"], state.orderLines);
    $("#btn-save-order").disabled = false;
    updateTotals();
  }
  renderLines();
  renderPayments();
}

/* ---- Orders view (tách HĐ, hiển thị payments & Nợ cũ) ---- */
async function pageOrdersView() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="card">
      <h2>📚 Quản lý đơn hàng</h2>
      <div class="list-head">
        <input class="search" id="od-search" placeholder="Tìm theo mã đơn/khách">
        <button id="od-reload">🔄 Refresh</button>
      </div>
    </div>
    <div class="card"><div id="od-table">Đang tải...</div></div>
    <div class="card"><h3>👁️ Chi tiết hóa đơn</h3><div id="od-detail">Chọn 1 hóa đơn để xem.</div></div>
  `;

  $("#od-reload").onclick = async () => { await loadOrders(true); render(); };
  $("#od-search").oninput = () => render();

  await loadOrders(); render();

  function render() {
    const q = ($("#od-search").value || "").toLowerCase();
    const data = q ? state.orders.filter(o =>
      (o.ma||"").toLowerCase().includes(q) || (o.khach||"").toLowerCase().includes(q)
    ) : state.orders;

    let html = `<table><thead><tr>
      <th>Mã đơn</th><th>Khách hàng</th><th>Ngày</th>
      <th class="right">Nợ cũ</th><th class="right">Tổng</th><th class="right">Khách trả</th><th class="right">Còn nợ</th><th></th>
    </tr></thead><tbody>`;
    data.forEach(o => {
      html += `<tr>
        <td>${o.ma}</td><td>${o.khach}</td><td>${o.ngay}</td>
        <td class="right">${fmtVND(o.nocu)}</td>
        <td class="right">${fmtVND(o.tong)}</td>
        <td class="right">${fmtVND(o.paid)}</td>
        <td class="right">${fmtVND(o.debt_after)}</td>
        <td><button data-view="${o.ma}">Chi tiết</button></td>
      </tr>`;
    });
    html += `</tbody></table>`;
    $("#od-table").innerHTML = html;

    $$("#od-table [data-view]").forEach(btn=>{
      btn.onclick = async () => {
        const ma = btn.getAttribute("data-view");
        const o = state.orders.find(x=>x.ma===ma);
        const detail = await loadOrderDetails(ma);
        const pays = await loadPaymentsByOrder(ma);
        if (!detail.length) { $("#od-detail").innerHTML = "Không có chi tiết."; return; }

        const rows = detail.map(d=>{
          const tt = d.thanh_tien>0 ? d.thanh_tien : (d.so_luong * d.don_gia);
          return {
            "Tên sản phẩm": d.ten,
            "Số lượng": d.so_luong,
            "Đơn giá": fmtVND(d.don_gia),
            "Thành tiền": fmtVND(tt),
          };
        });
        const total = detail.reduce((s, x) => s + (x.thanh_tien>0 ? x.thanh_tien : x.so_luong*x.don_gia), 0);

        $("#od-detail").innerHTML =
          `<div class="muted">Mã đơn: <b>${o.ma}</b> — Ngày: ${o.ngay} — Khách: <b>${o.khach}</b></div>` +
          `<div class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">` +
            `<div>`+
              `<h4>Hàng hóa</h4>`+
              renderTableArray(["Tên sản phẩm","Số lượng","Đơn giá","Thành tiền"], rows) +
              `<div class="right" style="margin-top:6px;font-weight:700">Tổng: ${fmtVND(total)}</div>`+
            `</div>`+
            `<div>`+
              `<h4>Thanh toán của hóa đơn</h4>`+
              renderTableArray(["Số tiền","Ghi chú"], pays) +
              `<div class="box" style="margin-top:8px">
                <div>🧷 Nợ cũ: <b>${fmtVND(o.nocu)}</b></div>
                <div>💵 Khách trả: <b>${fmtVND(o.paid)}</b></div>
                <div>🧾 Còn nợ sau HĐ: <b>${fmtVND(o.debt_after)}</b></div>
                <div>📝 Ghi chú: ${o.note||"—"}</div>
              </div>`+
            `</div>`+
          `</div>`;
      };
    });
  }
}

/* ---- (Optional) placeholders để menu không báo lỗi) ---- */
async function pageSuppliers(){ toggleShell(false); appEl().innerHTML = `<div class="card"><h2>🏭 Nhà cung cấp</h2><div class="muted">Đang phát triển…</div></div>`; }
async function pageCategories(){ toggleShell(false); appEl().innerHTML = `<div class="card"><h2>🗂 Danh mục</h2><div class="muted">Đang phát triển…</div></div>`; }
async function pageReports(){ toggleShell(false); appEl().innerHTML = `<div class="card"><h2>📊 Báo cáo</h2><div class="muted">Đang phát triển…</div></div>`; }
async function pageManufacturing(){ toggleShell(false); appEl().innerHTML = `<div class="card"><h2>🧵 Sản xuất</h2><div class="muted">Giữ như bản trước.</div></div>`; }
async function pageTimesheet(){ toggleShell(false); appEl().innerHTML = `<div class="card"><h2>📝 Chấm công</h2><div class="muted">Giữ như bản trước.</div></div>`; }
async function pagePayroll(){ toggleShell(false); appEl().innerHTML = `<div class="card"><h2>💰 Tính lương</h2><div class="muted">Giữ như bản trước.</div></div>`; }

/* =============== ROUTER =============== */
function setActive(page) { $$(".menu-item,[data-page]").forEach(el=>{ if (el.dataset?.page) el.classList.toggle("active", el.dataset.page===page); }); }
async function loadPage(page) {
  setActive(page);
  if (page==="overview")     { toggleShell(true);  return pageOverview(); }
  toggleShell(false);
  if (page==="customers")     return pageCustomers();
  if (page==="suppliers")     return pageSuppliers();
  if (page==="product")       return pageProduct();
  if (page==="categories")    return pageCategories();
  if (page==="inventory")     return pageInventory();
  if (page==="debts")         return pageDebts();
  if (page==="orders_view")   return pageOrdersView();
  if (page==="order")         return pageOrder();
  if (page==="manufacturing") return pageManufacturing();
  if (page==="timesheet")     return pageTimesheet();
  if (page==="payroll")       return pagePayroll();
  if (page==="reports")       return pageReports();
  toggleShell(true); return pageOverview();
}

/* =============== GLOBAL =============== */
document.addEventListener("click", (e)=>{
  const el = e.target.closest("[data-page]"); if (!el) return;
  e.preventDefault(); const page = el.dataset.page; if (page) loadPage(page);
});
window.addEventListener("DOMContentLoaded", ()=>{
  if (!$("#app")) { const m=document.createElement("main"); m.id="app"; document.body.appendChild(m); }
  toggleShell(true); loadPage("overview");
});
