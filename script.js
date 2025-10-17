/* ===================================================================
   ERP MAY MẶC – SPA Frontend (có công nợ khi tạo hóa đơn)
   =================================================================== */

/* =============== CONFIG =============== */
const API_URL = "/.netlify/functions/gas"; // proxy Netlify tới GAS
// const API_URL = "https://script.google.com/macros/s/XXXX/exec"; // dùng trực tiếp nếu không qua Netlify

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
      const right = /SL|Số lượng|Đơn giá|Thành tiền|Tổng|Ton|Gia|Amount|Qty|Nợ|Trả/i.test(h) ? ' class="right"' : "";
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
/* Công nợ: hỏi nợ hiện tại của 1 khách. Nếu backend chưa có action này -> trả 0 */
async function getDebt(khach) {
  try {
    const r = await apiPost({ action: "getDebt", khach });
    return r?.ok ? Number(r.debt || 0) : 0;
  } catch { return 0; }
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
    "Mã SP": o["Mã SP"] || o["MaSP"] || "",
    "Tên sản phẩm": o["Tên sản phẩm"] || o["TenSP"] || "",
    "Size": o["Size"] || "",
    "Giá": Number(o["Giá"] || o["Gia"] || 0),
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
    ma:o["Mã đơn"]||o["MaDon"]||"",
    khach:o["Khách hàng"]||o["KhachHang"]||"",
    ngay:o["Ngày tạo"]||o["NgayTao"]||"",
    tong:Number(o["Tổng tiền"]||o["TongTien"]||0),
    paid:Number(o["Khách trả"]||o["KhachTra"]||0),
    debt_after:Number(o["Còn nợ"]||o["ConNo"]||0),
  }));
  state.cacheAt = now;
}
async function loadOrderDetails(ma) {
  const rs = await apiGet("ChiTietDonHang"); const rows = rs.ok?rs.rows:[];
  if (!rows?.length) return [];
  const h = rows[0];
  return toObjects(h, rows.slice(1))
    .map(o=>({
      ma:o["Mã đơn"]||o["MaDon"]||"",
      ten:o["Tên sản phẩm"]||o["TenSP"]||"",
      so_luong:Number(o["Số lượng"]||o["SL"]||0),
      don_gia:Number(o["Đơn giá"]||o["DonGia"]||0),
      thanh_tien:Number(o["Thành tiền"]||o["ThanhTien"]||0),
    }))
    .filter(x=>x.ma===ma);
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
      alert(`Mã: ${row.ma}
Tên: ${row.ten}
Loại: ${row.loai}
SĐT: ${row.sdt}
Email: ${row.email}
Địa chỉ: ${row.diachi}
Ghi chú: ${row.ghichu}`);
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

/* ---- Product ---- */
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
        <div class="col"></div>
      </div>
      <div style="margin-top:10px"><button class="primary" id="btn-add-sp">💾 Lưu sản phẩm</button></div>
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

/* ---- Order (create) — có công nợ ---- */
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
        <div class="col"></div>
      </div>
      <div style="margin-top:10px">
        <button class="primary" id="btn-add-line">➕ Thêm vào đơn</button>
        <button class="danger" id="btn-clear-lines" style="margin-left:8px">🗑 Xoá</button>
      </div>
    </div>

    <div class="card">
      <h3>📋 Sản phẩm trong đơn</h3>
      <div id="dh-lines">Chưa có dòng</div>

      <div class="row" style="margin-top:10px">
        <div class="col"><label>Khách trả (VND)</label><input id="dh-paid" type="number" value="0"></div>
        <div class="col"><label>Ghi chú</label><input id="dh-note" placeholder="ghi chú..."></div>
      </div>

      <div style="margin-top:10px; display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div class="muted">🧮 Tổng tạm tính: <b id="dh-sum">0 VND</b></div>
        <div class="muted right">📦 Nợ cũ: <b id="dh-old-debt">0 VND</b></div>
        <div class="muted">💵 Khách trả: <b id="dh-paid-show">0 VND</b></div>
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

  let oldDebt = 0;
  let sum = 0;

  async function refreshDebt() {
    const kh = $("#dh-khach").value.trim();
    if (!kh) { oldDebt = 0; updateTotals(); return; }
    oldDebt = await getDebt(kh); // nếu backend chưa có -> 0
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
  $("#dh-paid").oninput = updateTotals;

  $("#btn-save-order").onclick = async () => {
    const khach = $("#dh-khach").value.trim();
    const ngay  = $("#dh-ngay").value.trim();
    const paid  = Number($("#dh-paid").value || 0);
    const note  = $("#dh-note").value.trim();
    if (!khach || !ngay || !state.orderLines.length) return;

    const total = state.orderLines.reduce((s,x)=>s+x["Thành tiền"],0);
    const debt_after = oldDebt + total - paid;

    const details = state.orderLines.map(x=>({ ten:x["Tên"], so_luong:x["Số lượng"], don_gia:x["Đơn giá"] }));

    const rs = await safePost({
      action: "createOrder",
      order: {
        khach, ngay, total, paid,
        debt_before: oldDebt, debt_after,
        note
      },
      details
    });
    alert(rs.ok ? `Đã lưu ${rs.ma_don}` : "Đã lưu chờ (offline)");
    state.orderLines=[]; oldDebt=0; $("#dh-khach").value=""; $("#dh-paid").value=0; $("#dh-note").value="";
    renderLines();
  };

  renderLines();

  function updateTotals() {
    sum = state.orderLines.reduce((s,x)=>s+x["Thành tiền"],0);
    const paid = Number($("#dh-paid").value || 0);
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
}

/* ---- Orders view (Chi tiết có tổng) ---- */
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
    <div class="card"><h3>👁️ Chi tiết</h3><div id="od-detail">Chọn 1 đơn để xem.</div></div>
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
      <th class="right">Tổng</th><th class="right">Khách trả</th><th class="right">Còn nợ</th><th></th>
    </tr></thead><tbody>`;
    data.forEach(o => {
      html += `<tr>
        <td>${o.ma}</td><td>${o.khach}</td><td>${o.ngay}</td>
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
        const detail = await loadOrderDetails(ma);
        if (!detail.length) { $("#od-detail").innerHTML = "Không có chi tiết."; return; }

        // Nếu cột "Thành tiền" trả 0, tự tính từ SL*Đơn giá
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
          renderTableArray(["Tên sản phẩm","Số lượng","Đơn giá","Thành tiền"], rows) +
          `<div class="right" style="margin-top:8px;font-weight:700">Tổng: ${fmtVND(total)}</div>`;
      };
    });
  }
}

/* ---- Manufacturing ---- */
async function pageManufacturing() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="card">
      <h2>🧵 Sản xuất</h2>
      <div class="row">
        <div class="col"><label>Mẫu (Mã SP)</label><select id="mo-sp"></select></div>
        <div class="col"><label>Size</label><input id="mo-size" placeholder="S/M/L/XL"></div>
      </div>
      <div class="row">
        <div class="col"><label>Màu</label><input id="mo-mau"></div>
        <div class="col"><label>Số lượng</label><input id="mo-sl" type="number" value="100"></div>
      </div>
      <div style="margin-top:10px"><button class="primary" id="btn-create-mo">Tạo lệnh</button></div>
    </div>
    <div class="card"><h3>📦 Nhu cầu NVL theo BOM</h3><div id="bom-preview">—</div></div>
  `;

  const [spRs, bomRs] = await Promise.all([apiGet("SanPham"), apiGet("BOM")]);
  const sp = spRs.ok ? toObjects(spRs.rows[0], spRs.rows.slice(1)) : [];
  const bom = bomRs.ok ? toObjects(bomRs.rows[0], bomRs.rows.slice(1)) : [];

  $("#mo-sp").innerHTML = sp.map(x =>
    `<option value="${x["Mã SP"]||x["MaSP"]}">${x["Mã SP"]||x["MaSP"]} - ${x["Tên sản phẩm"]||x["TenSP"]||""}</option>`
  ).join("");

  const parseSizeDM = (s) => {
    const map = {};
    String(s||"").split(",").forEach(p => {
      const [a,b] = p.split(":"); if (a&&b) map[a.trim()] = Number(b);
    });
    return map;
  };
  const computeNeed = () => {
    const masp = $("#mo-sp").value;
    const size = $("#mo-size").value.trim();
    const sl   = Number($("#mo-sl").value || 0);
    const lines = bom.filter(r => (r["MaSP"]||r["Mã SP"])===masp);
    return lines.map(l=>{
      const dm  = parseSizeDM(l["DinhMucTheoSize"]||l["ĐịnhMứcTheoSize"]||"");
      const hao = Number(l["HaoHut%"]||l["HaoHut"]||0)/100;
      const need = Math.ceil(sl * (dm[size] ?? dm["ALL"] ?? 0) * (1+hao));
      return { MaNVL:l["MaNVL"]||l["Mã NVL"], SoLuong:need, DonVi:l["DonVi"]||l["Đơn vị"] };
    }).filter(x=>x.MaNVL);
  };
  const renderPreview = () => { $("#bom-preview").innerHTML = renderTableArray(["MaNVL","SoLuong","DonVi"], computeNeed()); };
  ["change","keyup"].forEach(ev => { $("#mo-size").addEventListener(ev, renderPreview); $("#mo-sl").addEventListener(ev, renderPreview); });
  renderPreview();

  $("#btn-create-mo").onclick = async () => {
    const rs = await safePost({ action:"createMO", data:{
      MaSP:$("#mo-sp").value, Size:$("#mo-size").value.trim(),
      Mau:$("#mo-mau").value.trim(), SoLuong:Number($("#mo-sl").value||0),
    }});
    const need = computeNeed();
    if (need.length) await safePost({ action:"issueMaterial", data:{ MaLenh: rs.MaLenh||"MO-PENDING", items: need }});
    alert(`Đã tạo ${rs.MaLenh||"(chờ đồng bộ)"} & xuất NVL theo BOM`);
  };
}

/* ---- Timesheet ---- */
async function pageTimesheet() {
  toggleShell(false);

  const cdRs = await apiGet("CongDoan");
  const cds = cdRs.ok ? toObjects(cdRs.rows[0], cdRs.rows.slice(1)) : [];

  appEl().innerHTML = `
    <div class="card"><h2>📝 Chấm công công đoạn</h2>
      <div class="row">
        <div class="col"><label>Ngày</label><input id="cc-ngay" value="${todayStr()}"></div>
        <div class="col"><label>Mã CN</label><input id="cc-macn"></div>
      </div>
      <div class="row">
        <div class="col"><label>Tên CN</label><input id="cc-tencn"></div>
        <div class="col"><label>Mã Lệnh</label><input id="cc-molenh"></div>
      </div>
      <div class="row">
        <div class="col"><label>Công đoạn</label>
          <select id="cc-cd">${cds.map(c=>`<option>${c["TenCD"]||c["Tên CD"]||c["Tên công đoạn"]||""}</option>`)}</select>
        </div>
        <div class="col"><label>SL</label><input id="cc-sl" type="number" value="10"></div>
      </div>
      <div style="margin-top:10px"><button class="primary" id="btn-cc">Ghi công</button></div>
    </div>
  `;
  $("#btn-cc").onclick = async () => {
    const d = { Ngay:$("#cc-ngay").value, MaCN:$("#cc-macn").value, TenCN:$("#cc-tencn").value, MaLenh:$("#cc-molenh").value, CongDoan:$("#cc-cd").value, SL:Number($("#cc-sl").value||0) };
    const rs = await safePost({ action:"recordTimesheet", data:d });
    alert(rs.ok?"Đã ghi công!":"Đã lưu chờ (offline)");
  };
}

/* ---- Payroll ---- */
async function pagePayroll() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="card"><h2>💰 Tính lương</h2>
      <div class="row">
        <div class="col"><label>Tháng</label><input id="pl-thang" value="${todayStr().slice(0,7)}"></div>
        <div class="col" style="display:flex;align-items:flex-end"><button class="primary" id="btn-calc">Tính</button></div>
      </div>
      <div id="pl-result" style="margin-top:10px"></div>
    </div>
  `;
  $("#btn-calc").onclick = async () => {
    const thang = $("#pl-thang").value;
    const rs = await safePost({ action:"calcPayroll", data:{ thang }});
    $("#pl-result").innerHTML = rs.ok ? `✅ Đã ghi ${rs.rows} dòng vào BangLuong` : `⚠️ Đã xếp yêu cầu vào hàng đợi (offline)`;
  };
}

/* =============== ROUTER =============== */
function setActive(page) { $$(".menu-item,[data-page]").forEach(el=>{ if (el.dataset?.page) el.classList.toggle("active", el.dataset.page===page); }); }
async function loadPage(page) {
  setActive(page);
  if (page==="overview") { toggleShell(true); return pageOverview(); }
  toggleShell(false);
  if (page==="customers")     return pageCustomers();
  if (page==="product")       return pageProduct();
  if (page==="order")         return pageOrder();
  if (page==="orders_view")   return pageOrdersView();
  if (page==="manufacturing") return pageManufacturing();
  if (page==="timesheet")     return pageTimesheet();
  if (page==="payroll")       return pagePayroll();
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
