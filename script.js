/* ============================================================
   ERP MAY MẶC – SPA Frontend (Full)
   ------------------------------------------------------------
   Trang: Dashboard, Customers, Product, Order, Orders View,
         Manufacturing, Timesheet, Payroll
   API:   Google Apps Script Web App thông qua Netlify Function
   Tính năng:
     - Ẩn/hiện shell Dashboard
     - Event delegation cho menu [data-page]
     - Bảng, modal form
     - Hàng đợi offline (localStorage) cho POST
     - Thêm + Sửa + Xoá khách hàng
     - Công nợ: tạo đơn cộng nợ, thu tiền từng phần theo “Nguồn”
   ============================================================ */

/* ================== CONFIG ================== */
// Nếu frontend và function cùng 1 site Netlify:
const API_URL = "/.netlify/functions/gas";

// Nguồn thu (khách trả giúp bên phụ liệu…)
const PAYMENT_SOURCES = [
  "Mẹ", "Trần tài", "Vải thể thao", "Mẹ trả", "Hoàng anh", "Vải sỉ"
];

/* ================== UTILS ================== */
const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

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
const toObjects = (headers, rows) =>
  rows.map((r) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = r[i]));
    return o;
  });

function renderTableArray(headers, data) {
  if (!data?.length) return `<div>—</div>`;
  let html = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>`;
  data.forEach((rowObj) => {
    html += `<tr>${headers
      .map((h) =>
        `<td${/SL|Số lượng|Đơn giá|Thành tiền|Tổng|Ton|Gia|Amount|Qty|No/i.test(h) ? ' class="right"' : ""}>${rowObj[h] ?? ""}</td>`
      )
      .join("")}</tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

/* ================== API WRAPPERS ================== */
async function apiGet(sheet) {
  const res = await fetch(`${API_URL}?sheet=${encodeURIComponent(sheet)}`);
  return await res.json(); // {ok, rows}
}
async function apiPost(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return await res.json(); // {ok, ...}
}

/* ================== OFFLINE QUEUE ================== */
const SYNC_KEY = "erp_sync_queue_v2";
const getQueue = () => JSON.parse(localStorage.getItem(SYNC_KEY) || "[]");
const setQueue = (q) => localStorage.setItem(SYNC_KEY, JSON.stringify(q));

function toast(msg, type = "info") {
  const t = document.createElement("div");
  Object.assign(t.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    background: type === "error" ? "#d9534f" : type === "success" ? "#28a745" : "#111",
    color: "#fff",
    padding: "10px 12px",
    borderRadius: "10px",
    boxShadow: "0 8px 22px rgba(0,0,0,.25)",
    zIndex: 9999,
    fontSize: "14px",
  });
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

async function safePost(body) {
  try {
    const r = await apiPost(body);
    if (!r.ok) throw new Error(r.error || "API error");
    return r;
  } catch (e) {
    const q = getQueue();
    q.push({ body, ts: Date.now() });
    setQueue(q);
    toast("🔌 Mất mạng – đã lưu yêu cầu chờ đồng bộ", "info");
    return { ok: false, queued: true };
  }
}

// Thử đồng bộ 5s/lần
setInterval(async () => {
  const q = getQueue();
  if (!q.length) return;
  try {
    const r = await apiPost(q[0].body);
    if (r.ok) {
      q.shift();
      setQueue(q);
      toast("✅ Đã đồng bộ yêu cầu chờ", "success");
    }
  } catch {}
}, 5000);

/* ================== APP STATE ================== */
const state = {
  products: [],
  orders: [],
  orderLines: [],
  cacheAt: 0,
  customers: [],
};
const CACHE_TTL = 60 * 1000;

/* ================== LOADERS ================== */
async function loadProducts(invalidate = false) {
  const now = Date.now();
  if (!invalidate && state.products.length && now - state.cacheAt < CACHE_TTL) return;
  const rs = await apiGet("SanPham");
  const rows = rs.ok ? rs.rows : [];
  if (!rows?.length) { state.products = []; return; }
  const h = rows[0];
  state.products = toObjects(h, rows.slice(1)).map((o) => ({
    "Mã SP": o["Mã SP"] || o["MaSP"] || "",
    "Tên sản phẩm": o["Tên sản phẩm"] || o["TenSP"] || "",
    "Size": o["Size"] || "",
    "Giá": Number(o["Giá"] || o["Gia"] || 0),
  }));
  state.cacheAt = now;
}

async function loadOrders(invalidate = false) {
  const now = Date.now();
  if (!invalidate && state.orders.length && now - state.cacheAt < CACHE_TTL) return;
  const rs = await apiGet("DonHang");
  const rows = rs.ok ? rs.rows : [];
  if (!rows?.length) { state.orders = []; return; }
  const h = rows[0];
  state.orders = toObjects(h, rows.slice(1)).map((o) => ({
    ma:   o["Mã đơn"]     || o["MaDon"]   || "",
    khach:o["Khách hàng"] || o["KhachHang"] || "",
    ngay: o["Ngày tạo"]   || o["NgayTao"] || "",
    tong: Number(o["Tổng tiền"] || o["TongTien"] || 0),
  }));
  state.cacheAt = now;
}

async function loadOrderDetails(ma_don) {
  const rs = await apiGet("ChiTietDonHang");
  const rows = rs.ok ? rs.rows : [];
  if (!rows?.length) return [];
  const h = rows[0];
  return toObjects(h, rows.slice(1))
    .map((o) => ({
      ma: o["Mã đơn"] || o["MaDon"] || "",
      ten: o["Tên sản phẩm"] || o["TenSP"] || "",
      so_luong: Number(o["Số lượng"] || o["SL"] || 0),
      don_gia:  Number(o["Đơn giá"]   || o["DonGia"] || 0),
      thanh_tien: Number(o["Thành tiền"] || o["ThanhTien"] || 0),
    }))
    .filter((x) => x.ma === ma_don);
}

/* ================== DASHBOARD TOGGLER ================== */
function toggleShell(showShell) {
  const shell = shellEl();
  const app = appEl();
  if (!shell || !app) return;
  shell.classList.toggle("hidden", !showShell);
  app.classList.toggle("hidden", showShell);
  if (!showShell) window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ================== PAGES ================== */
// ---- Dashboard
async function pageOverview() {
  appEl().innerHTML = ""; // để vùng app trống khi đang ở dashboard
}

/* ---------- CUSTOMERS (Thêm + Sửa + Xoá + Công nợ) ---------- */
async function pageCustomers() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="page-head">
      <h1>Quản lý Khách hàng</h1>
    </div>

    <div class="card">
      <div class="quick-3">
        <button class="quick big" id="kh-btn-add">
          <div class="q-icon">👥➕</div>
          <div>Thêm khách hàng</div>
        </button>
        <div class="quick big">
          <div class="q-icon">🔎</div>
          <div><input id="kh-search" class="search w-full" placeholder="Tìm tên, SĐT, email..."></div>
        </div>
        <button class="quick big" id="kh-btn-export">
          <div class="q-icon">📊</div>
          <div>Xuất báo cáo</div>
        </button>
      </div>
    </div>

    <div class="card">
      <div class="list-head">
        <h3 id="kh-count">Danh sách Khách hàng</h3>
      </div>
      <div id="kh-list" class="kh-list"></div>
    </div>

    <!-- Modal Thêm/Sửa -->
    <div id="kh-modal" class="modal hidden">
      <div class="modal-body">
        <h3 id="kh-modal-title">➕ Thêm khách hàng</h3>

        <input type="hidden" id="m-ma" />

        <div class="row">
          <div class="col">
            <label>Tên khách hàng: <span class="req">*</span></label>
            <input id="m-ten" placeholder="Nguyễn Văn A">
          </div>
          <div class="col">
            <label>Loại khách hàng: <span class="req">*</span></label>
            <select id="m-loai">
              <option value="">Chọn loại</option>
              <option value="Cá nhân">Cá nhân</option>
              <option value="Doanh nghiệp">Doanh nghiệp</option>
              <option value="Khác">Khác</option>
            </select>
          </div>
        </div>

        <div class="row">
          <div class="col">
            <label>Số điện thoại: <span class="req">*</span></label>
            <input id="m-sdt" placeholder="09xxxxxxxx">
          </div>
          <div class="col">
            <label>Email:</label>
            <input id="m-email" placeholder="email@domain.com">
          </div>
        </div>

        <div>
          <label>Địa chỉ:</label>
          <input id="m-diachi" placeholder="Số nhà, đường, quận, TP">
        </div>

        <div>
          <label>Ghi chú khách hàng:</label>
          <textarea id="m-ghichu" rows="3" placeholder="Nhập ghi chú (không bắt buộc)"></textarea>
        </div>

        <div class="right" style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end">
          <button class="btn" id="m-cancel">Hủy</button>
          <button class="btn primary" id="m-save">Lưu</button>
        </div>
      </div>
    </div>
  `;

  // Modal thu tiền
  appEl().insertAdjacentHTML('beforeend', `
    <div id="pay-modal" class="modal hidden">
      <div class="modal-body">
        <h3>💵 Thu tiền khách hàng</h3>
        <input type="hidden" id="pay-ma" />
        <div class="row">
          <div class="col"><label>Ngày</label><input id="pay-ngay" value="${todayStr()}"></div>
          <div class="col"><label>Số tiền</label><input id="pay-tien" type="number" value="0"></div>
        </div>
        <div class="row">
          <div class="col">
            <label>Nguồn</label>
            <select id="pay-nguon">
              ${PAYMENT_SOURCES.map(s=>`<option>${s}</option>`).join("")}
            </select>
          </div>
          <div class="col">
            <label>Diễn giải</label>
            <input id="pay-note" placeholder="VD: KH trả đợt 1">
          </div>
        </div>
        <div class="right" style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn" id="pay-cancel">Hủy</button>
          <button class="btn primary" id="pay-save">Ghi thu</button>
        </div>
      </div>
    </div>
  `);

  const payModal = $("#pay-modal");
  const payOpen  = () => payModal.classList.remove("hidden");
  const payClose = () => payModal.classList.add("hidden");
  $("#pay-cancel").onclick = payClose;

  const modal = $("#kh-modal");
  const openModal  = () => modal.classList.remove("hidden");
  const closeModal = () => modal.classList.add("hidden");
  const form = {
    ma:     $("#m-ma"),
    ten:    $("#m-ten"),
    loai:   $("#m-loai"),
    sdt:    $("#m-sdt"),
    email:  $("#m-email"),
    diachi: $("#m-diachi"),
    ghichu: $("#m-ghichu"),
    title:  $("#kh-modal-title"),
    save:   $("#m-save"),
    cancel: $("#m-cancel"),
  };

  let customers = [];
  let mode = "create";

  function clearForm() {
    form.ma.value = "";
    form.ten.value = "";
    form.loai.value = "";
    form.sdt.value = "";
    form.email.value = "";
    form.diachi.value = "";
    form.ghichu.value = "";
  }
  function fillForm(x) {
    form.ma.value = x.ma || "";
    form.ten.value = x.ten || "";
    form.loai.value = x.loai || "";
    form.sdt.value = x.sdt || "";
    form.email.value = x.email || "";
    form.diachi.value = x.diachi || "";
    form.ghichu.value = x.ghichu || "";
  }
  const initials = (name) =>
    (String(name || "")
      .split(" ")
      .filter(Boolean)
      .slice(-2)
      .map((s) => s[0])
      .join("")
      .toUpperCase()) || "KH";

  async function fetchAllDebt() {
    const rs = await apiPost({ action:"allCustomerDebt" });
    const map = {};
    if (rs?.ok && Array.isArray(rs.items)) {
      rs.items.forEach(x => { map[x.MaKH || x.TenKH] = x.No; });
    }
    return map;
  }

  async function loadCustomersData() {
    const rs = await apiGet("KhachHang");
    const rows = rs.ok ? rs.rows : [];
    if (!rows?.length) { customers = []; render(""); return; }

    const data = rows.slice(1).map((r) => ({
      ma:     r[0],
      ten:    r[1],
      loai:   r[2] || "",
      sdt:    r[3] || "",
      email:  r[4] || "",
      diachi: r[5] || "",
      ghichu: r[6] || "",
    }));

    const debtMap = await fetchAllDebt();
    customers = data.map(x => ({
      ...x,
      no: debtMap[x.ma] ?? debtMap[x.ten] ?? 0
    }));

    render($("#kh-search").value || "");
  }

  function render(keyword = "") {
    const k = (keyword || "").toLowerCase();
    const list = k
      ? customers.filter(
          (x) =>
            (x.ten || "").toLowerCase().includes(k) ||
            (x.sdt || "").toLowerCase().includes(k) ||
            (x.email || "").toLowerCase().includes(k)
        )
      : customers;

    $("#kh-count").textContent = `Danh sách Khách hàng (${list.length})`;

    if (!list.length) {
      $("#kh-list").innerHTML = `<div class="muted">Chưa có dữ liệu</div>`;
      return;
    }

    $("#kh-list").innerHTML = list
      .map((x) => {
        const badge = x.loai ? `<span class="badge gray">${x.loai}</span>` : "";
        return `
          <div class="kh-card" data-item="${x.ma}">
            <div class="kh-left">
              <div class="avatar">${initials(x.ten)}</div>
              <div class="kh-info">
                <div class="kh-name">${x.ten} <span class="muted">(${x.ma})</span> ${badge}</div>
                <div class="kh-line">
                  ${x.sdt   ? `<span>📞 ${x.sdt}</span>`   : ""}
                  ${x.email ? `<span>✉️ ${x.email}</span>` : ""}
                  ${x.diachi? `<span>📍 ${x.diachi}</span>`: ""}
                </div>
              </div>
            </div>
            <div class="kh-right">
              <div class="kh-debt">
                ${ (x.no||0) > 0
                    ? `<span class="tag red">Nợ: ${fmtVND(x.no)}</span>`
                    : `<span class="tag green">Không nợ</span>` }
              </div>
              <div class="kh-actions">
                <button class="btn sm success" data-act="pay"    data-id="${x.ma}">Thu tiền</button>
                <button class="btn sm info"    data-act="detail" data-id="${x.ma}">Chi tiết</button>
                <button class="btn sm primary" data-act="edit"   data-id="${x.ma}">Sửa</button>
                <button class="btn sm danger"  data-act="delete" data-id="${x.ma}">Xóa</button>
              </div>
            </div>
          </div>`;
      })
      .join("");
  }

  // Open add
  $("#kh-btn-add").onclick = () => {
    mode = "create";
    form.title.textContent = "➕ Thêm khách hàng";
    form.save.textContent  = "Thêm khách hàng";
    clearForm();
    openModal();
  };

  // Export
  $("#kh-btn-export").onclick = () =>
    alert("Bạn có thể xuất trực tiếp trên Google Sheets, hoặc bổ sung sau.");

  // Search
  $("#kh-search").oninput = (e) => render(e.target.value || "");

  // Cancel modal
  form.cancel.onclick = closeModal;

  // Save modal (create or edit)
  form.save.onclick = async () => {
    const payload = {
      ten:    form.ten.value.trim(),
      loai:   form.loai.value.trim(),
      sdt:    form.sdt.value.trim(),
      email:  form.email.value.trim(),
      diachi: form.diachi.value.trim(),
      ghichu: form.ghichu.value.trim(),
    };
    if (!payload.ten)  return alert("Vui lòng nhập Tên khách hàng");
    if (!payload.loai) return alert("Vui lòng chọn Loại khách hàng");
    if (!payload.sdt)  return alert("Vui lòng nhập Số điện thoại");

    let rs;
    if (mode === "create") {
      rs = await safePost({ action: "createCustomer", data: payload });
    } else {
      rs = await safePost({
        action: "updateCustomer",
        data: { ma: form.ma.value, ...payload },
      });
    }

    if (!rs.ok && !rs.queued) return alert(rs.error || "Lỗi lưu");
    closeModal();
    await loadCustomersData();
    toast(mode === "create"
      ? (rs.ok ? `Đã tạo KH ${rs.ma_kh || ""}` : "Đã lưu chờ (offline)")
      : (rs.ok ? `Đã cập nhật KH ${form.ma.value}` : "Đã lưu chờ (offline)")
    );
  };

  // Delegation: pay / detail / edit / delete
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest(".kh-actions .btn");
    if (!btn || !$("#kh-list").contains(btn)) return;

    const id  = btn.dataset.id;
    const act = btn.dataset.act;
    const row = customers.find((x) => x.ma === id);
    if (!row) return;

    if (act === "pay") {
      $("#pay-ma").value   = row.ma;
      $("#pay-tien").value = 0;
      $("#pay-note").value = `Khách ${row.ten} trả tiền`;
      $("#pay-nguon").value = PAYMENT_SOURCES[0] || "";
      $("#pay-ngay").value  = todayStr();
      payOpen();
    }

    if (act === "detail") {
      const rs = await apiPost({ action:"ledgerByCustomer", data:{ MaKH: row.ma }});
      if (!rs.ok) return alert(rs.error || "Không tải được sổ cái");
      const sum = (rs.rows||[]).reduce((s,r)=> s + Number(r[4]||0) - Number(r[5]||0), 0);
      alert(`Sao kê ${row.ten}\nSố dòng: ${rs.rows.length}\nCông nợ hiện tại: ${fmtVND(sum)}`);
    }

    if (act === "edit") {
      mode = "edit";
      form.title.textContent = "✏️ Sửa khách hàng";
      form.save.textContent  = "Cập nhật";
      fillForm(row);
      openModal();
    }

    if (act === "delete") {
      if (!confirm(`Xóa khách hàng ${row.ten} (${row.ma})?`)) return;
      const rs = await safePost({ action:"deleteCustomer", data:{ ma: row.ma } });
      if (!rs.ok && !rs.queued) return alert(rs.error || "Không xóa được");
      await loadCustomersData();
      toast(rs.ok ? "Đã xóa" : "Đã xếp hàng đợi (offline)");
    }
  });

  // Ghi thu
  $("#pay-save").onclick = async () => {
    const ma    = $("#pay-ma").value;
    const ngay  = $("#pay-ngay").value;
    const tien  = Number($("#pay-tien").value || 0);
    const nguon = $("#pay-nguon").value;
    const note  = $("#pay-note").value.trim();
    if (!ma || tien <= 0) return alert("Thiếu mã KH hoặc số tiền không hợp lệ");

    const rs = await safePost({
      action: "addPayment",
      data: { Ngay: ngay, MaKH: ma, SoTien: tien, Nguon: nguon, DienGiai: note }
    });
    if (!rs.ok && !rs.queued) return alert(rs.error || "Lỗi ghi thu");
    payClose();
    await loadCustomersData();
    toast(rs.ok ? "Đã ghi phiếu thu" : "Đã xếp hàng đợi (offline)", rs.ok ? "success" : "info");
  };

  // load lần đầu
  await loadCustomersData();
}

/* ---------- PRODUCT ---------- */
async function pageProduct() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="card">
      <h2>📦 Sản phẩm</h2>
      <div class="row">
        <div class="col"><label>Tên sản phẩm</label><input id="sp-ten"></div>
        <div class="col"><label>Size</label><input id="sp-size" placeholder="S/M/L/XL"></div>
      </div>
      <div class="row">
        <div class="col"><label>Giá (VND)</label><input id="sp-gia" type="number" value="0"></div>
        <div class="col">&nbsp;</div>
      </div>
      <div style="margin-top:10px"><button class="primary" id="btn-add-sp">💾 Lưu sản phẩm</button></div>
    </div>
    <div class="card"><h3>📋 Danh sách sản phẩm</h3><div id="sp-list">Đang tải...</div></div>
  `;

  $("#btn-add-sp").onclick = async () => {
    const ten  = $("#sp-ten").value.trim();
    const size = $("#sp-size").value.trim();
    const gia  = Number($("#sp-gia").value || 0);
    if (!ten || !size || gia <= 0) return alert("Thiếu thông tin");
    const rs = await safePost({ action: "createProduct", data: { ten, size, gia } });
    if (rs.ok) {
      toast("Đã lưu sản phẩm!", "success");
      await loadProducts(true);
      renderList();
      $("#sp-ten").value = $("#sp-size").value = "";
      $("#sp-gia").value = 0;
    }
  };

  await loadProducts();
  renderList();

  function renderList() {
    $("#sp-list").innerHTML = renderTableArray(
      ["Mã SP", "Tên sản phẩm", "Size", "Giá"],
      state.products
    );
  }
}

/* ---------- ORDER (create) ---------- */
async function pageOrder() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="card">
      <h2>🧾 Tạo đơn hàng</h2>
      <div class="row">
        <div class="col"><label>Khách hàng</label><input id="dh-khach" placeholder="Nhập đúng tên KH trong danh sách"></div>
        <div class="col"><label>Ngày</label><input id="dh-ngay" value="${todayStr()}"></div>
      </div>
      <div class="row">
        <div class="col"><label>Sản phẩm</label><select id="dh-sp"></select></div>
        <div class="col"><label>Số lượng</label><input id="dh-sl" type="number" value="1"></div>
      </div>
      <div class="row">
        <div class="col"><label>Đơn giá</label><input id="dh-gia" type="number" value="0"></div>
        <div class="col">&nbsp;</div>
      </div>
      <div style="margin-top:10px">
        <button class="primary" id="btn-add-line">➕ Thêm vào đơn</button>
        <button class="danger"  id="btn-clear-lines" style="margin-left:8px">🗑 Xoá</button>
      </div>
    </div>

    <div class="card">
      <h3>📋 Sản phẩm trong đơn</h3>
      <div id="dh-lines"></div>
      <div class="right" id="dh-total" style="margin-top:8px;font-weight:700"></div>
      <div style="margin-top:10px"><button class="primary" id="btn-save-order" disabled>✅ Lưu đơn</button></div>
    </div>
  ";

  await loadProducts();
  const sel = $("#dh-sp");
  sel.innerHTML = (state.products || [])
    .map(
      (p) =>
        `<option value="${p["Tên sản phẩm"]}" data-gia="${p["Giá"]}">${p["Tên sản phẩm"]} — ${fmtVND(
          p["Giá"]
        )}</option>`
    )
    .join("");
  const syncPrice = () =>
    ($("#dh-gia").value = sel.selectedOptions[0]?.getAttribute("data-gia") || 0);
  syncPrice();
  sel.onchange = syncPrice;

  $("#btn-add-line").onclick = () => {
    const ten = $("#dh-sp").value;
    const so_luong = Number($("#dh-sl").value || 0);
    const don_gia  = Number($("#dh-gia").value || 0);
    if (!ten || so_luong <= 0 || don_gia <= 0) return;
    state.orderLines.push({
      "Tên": ten,
      "Số lượng": so_luong,
      "Đơn giá": don_gia,
      "Thành tiền": so_luong * don_gia,
    });
    renderLines();
  };
  $("#btn-clear-lines").onclick = () => {
    state.orderLines = [];
    renderLines();
  };
  $("#btn-save-order").onclick = async () => {
    const khach = $("#dh-khach").value.trim();
    const ngay  = $("#dh-ngay").value.trim();
    if (!khach || !ngay || !state.orderLines.length) return;
    const details = state.orderLines.map((x) => ({
      ten: x["Tên"],
      so_luong: x["Số lượng"],
      don_gia: x["Đơn giá"],
    }));
    const rs = await safePost({
      action: "createOrder",
      order: { khach, ngay },
      details,
    });
    alert(rs.ok ? `Đã lưu ${rs.ma_don}` : "Đã lưu chờ (offline)");
    state.orderLines = [];
    renderLines();
  };

  renderLines();

  function renderLines() {
    if (!state.orderLines.length) {
      $("#dh-lines").innerHTML = "Chưa có dòng";
      $("#btn-save-order").disabled = true;
      $("#dh-total").innerHTML = "";
      return;
    }
    $("#dh-lines").innerHTML = renderTableArray(
      ["Tên", "Số lượng", "Đơn giá", "Thành tiền"],
      state.orderLines
    );
    const total = state.orderLines.reduce((s, x) => s + x["Thành tiền"], 0);
    $("#dh-total").innerHTML = "🧮 Tổng tạm tính: <b>" + fmtVND(total) + "</b>";
    $("#btn-save-order").disabled = false;
  }
}

/* ---------- ORDERS VIEW ---------- */
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

  $("#od-reload").onclick = async () => {
    await loadOrders(true);
    render();
  };
  $("#od-search").oninput = () => render();

  await loadOrders();
  render();

  function render() {
    const q = ($("#od-search").value || "").toLowerCase();
    const data = q
      ? state.orders.filter(
          (o) =>
            (o.ma || "").toLowerCase().includes(q) ||
            (o.khach || "").toLowerCase().includes(q)
        )
      : state.orders;
    let html = `<table><thead><tr>
      <th>Mã đơn</th><th>Khách hàng</th><th>Ngày</th><th class="right">Tổng</th><th></th>
    </tr></thead><tbody>`;
    data.forEach((o) => {
      html += `<tr>
        <td>${o.ma}</td><td>${o.khach}</td><td>${o.ngay}</td>
        <td class="right">${fmtVND(o.tong)}</td>
        <td><button data-view="${o.ma}">Chi tiết</button></td>
      </tr>`;
    });
    html += `</tbody></table>`;
    $("#od-table").innerHTML = html;

    $$("#od-table [data-view]").forEach((btn) => {
      btn.onclick = async () => {
        const ma = btn.getAttribute("data-view");
        const detail = await loadOrderDetails(ma);
        if (!detail.length) {
          $("#od-detail").innerHTML = "Không có chi tiết.";
          return;
        }
        const rows = detail.map((d) => ({
          "Tên sản phẩm": d.ten,
          "Số lượng": d.so_luong,
          "Đơn giá": fmtVND(d.don_gia),
          "Thành tiền": fmtVND(d.thanh_tien),
        }));
        $("#od-detail").innerHTML =
          renderTableArray(["Tên sản phẩm", "Số lượng", "Đơn giá", "Thành tiền"], rows) +
          `<div class="right" style="margin-top:8px;font-weight:700">
            Tổng: ${fmtVND(detail.reduce((s, x) => s + x.thanh_tien, 0))}
           </div>`;
      };
    });
  }
}

/* ---------- MANUFACTURING ---------- */
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
  const sp  = spRs.ok  ? toObjects(spRs.rows[0], spRs.rows.slice(1)) : [];
  const bom = bomRs.ok ? toObjects(bomRs.rows[0], bomRs.rows.slice(1)) : [];

  $("#mo-sp").innerHTML = sp
    .map(
      (x) =>
        `<option value="${x["Mã SP"] || x["MaSP"]}">${x["Mã SP"] || x["MaSP"]} - ${x["Tên sản phẩm"] || x["TenSP"] || ""}</option>`
    )
    .join("");

  const parseSizeDM = (s) => {
    const map = {};
    String(s || "")
      .split(",")
      .forEach((p) => {
        const [a, b] = p.split(":");
        if (a && b) map[a.trim()] = Number(b);
      });
    return map;
  };
  const computeNeed = () => {
    const masp = $("#mo-sp").value;
    const size = $("#mo-size").value.trim();
    const sl   = Number($("#mo-sl").value || 0);
    const lines = bom.filter((r) => (r["MaSP"] || r["Mã SP"]) === masp);
    return lines
      .map((l) => {
        const dm  = parseSizeDM(l["DinhMucTheoSize"] || l["ĐịnhMứcTheoSize"] || "");
        const hao = Number(l["HaoHut%"] || l["HaoHut"] || 0) / 100;
        const need = Math.ceil(sl * (dm[size] ?? dm["ALL"] ?? 0) * (1 + hao));
        return {
          MaNVL:  l["MaNVL"] || l["Mã NVL"],
          SoLuong: need,
          DonVi:  l["DonVi"]  || l["Đơn vị"],
        };
      })
      .filter((x) => x.MaNVL);
  };
  const renderPreview = () => {
    $("#bom-preview").innerHTML = renderTableArray(["MaNVL", "SoLuong", "DonVi"], computeNeed());
  };
  ["change", "keyup"].forEach((ev) => {
    $("#mo-size").addEventListener(ev, renderPreview);
    $("#mo-sl").addEventListener(ev, renderPreview);
  });
  renderPreview();

  $("#btn-create-mo").onclick = async () => {
    const payload = {
      action: "createMO",
      data: {
        MaSP: $("#mo-sp").value,
        Size: $("#mo-size").value.trim(),
        Mau:  $("#mo-mau").value.trim(),
        SoLuong: Number($("#mo-sl").value || 0),
      },
    };
    const rs = await safePost(payload);
    const need = computeNeed();
    if (need.length)
      await safePost({
        action: "issueMaterial",
        data: { MaLenh: rs.MaLenh || "MO-PENDING", items: need },
      });
    alert(`Đã tạo ${rs.MaLenh || "(chờ đồng bộ)"} & xuất NVL theo BOM`);
  };
}

/* ---------- TIMESHEET ---------- */
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
    const d = {
      Ngay:     $("#cc-ngay").value,
      MaCN:     $("#cc-macn").value,
      TenCN:    $("#cc-tencn").value,
      MaLenh:   $("#cc-molenh").value,
      CongDoan: $("#cc-cd").value,
      SL:       Number($("#cc-sl").value || 0),
    };
    const rs = await safePost({ action: "recordTimesheet", data: d });
    alert(rs.ok ? "Đã ghi công!" : "Đã lưu chờ đồng bộ (offline)");
  };
}

/* ---------- PAYROLL ---------- */
async function pagePayroll() {
  toggleShell(false);

  appEl().innerHTML = `
    <div class="card"><h2>💰 Tính lương</h2>
      <div class="row">
        <div class="col"><label>Tháng</label><input id="pl-thang" value="${todayStr().slice(0, 7)}"></div>
        <div class="col" style="display:flex;align-items:flex-end"><button class="primary" id="btn-calc">Tính</button></div>
      </div>
      <div id="pl-result" style="margin-top:10px"></div>
    </div>
  `;
  $("#btn-calc").onclick = async () => {
    const thang = $("#pl-thang").value;
    const rs = await safePost({ action: "calcPayroll", data: { thang } });
    $("#pl-result").innerHTML = rs.ok
      ? `✅ Đã ghi ${rs.rows} dòng vào BangLuong`
      : `⚠️ Đã xếp yêu cầu vào hàng đợi (offline)`;
  };
}

/* ================== ROUTER ================== */
function setActive(page) {
  $$(".menu-item, [data-page]").forEach((el) => {
    if (el.dataset?.page) el.classList.toggle("active", el.dataset.page === page);
  });
}
async function loadPage(page) {
  setActive(page);
  if (page === "overview") {
    toggleShell(true);
    return pageOverview();
  }
  toggleShell(false);
  if (page === "customers")      return pageCustomers();
  if (page === "product")        return pageProduct();
  if (page === "order")          return pageOrder();
  if (page === "orders_view")    return pageOrdersView();
  if (page === "manufacturing")  return pageManufacturing();
  if (page === "timesheet")      return pageTimesheet();
  if (page === "payroll")        return pagePayroll();
  toggleShell(true);
  return pageOverview();
}

/* ================== GLOBAL EVENTS ================== */
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-page]");
  if (!el) return;
  ev.preventDefault();
  const page = el.dataset.page;
  if (page) loadPage(page);
});

window.addEventListener("DOMContentLoaded", () => {
  if (!$("#app")) {
    const m = document.createElement("main");
    m.id = "app";
    document.body.appendChild(m);
  }
  toggleShell(true);
  loadPage("overview");
});
