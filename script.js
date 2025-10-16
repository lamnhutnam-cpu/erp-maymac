/*******************************
 * ERP MAY MẶC – FRONTEND (SPA)
 * Kết nối Google Sheets qua Netlify Function (gas.js)
 * Tác giả: bạn & trợ lý
 *******************************/

/* ================== CẤU HÌNH ================== */
// Nếu frontend & function cùng 1 site Netlify:
const API_URL = "/.netlify/functions/gas";
// Nếu chạy ở domain/localhost khác, dùng full URL:
// const API_URL = "https://<site>.netlify.app/.netlify/functions/gas";

const SHEET = {
  SP: "SanPham",
  KH: "KhachHang",
  DH: "DonHang",
  CT: "ChiTietDonHang"
};

// Khoá localStorage để xếp hàng POST khi offline
const LS_QUEUE_KEY = "erp_queue_v1";

/* ================== TIỆN ÍCH CHUNG ================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fMoney = (n) =>
  (Number(n || 0)).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + " VND";
const today = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};
const toast = (msg, type = "info") => {
  console.log(`[${type}] ${msg}`);
  // có thể thay bằng lib/toast UI của bạn
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.position = "fixed";
  el.style.right = "12px";
  el.style.bottom = "12px";
  el.style.background = type === "error" ? "#d9534f" : type === "success" ? "#28a745" : "#343a40";
  el.style.color = "#fff";
  el.style.padding = "10px 14px";
  el.style.borderRadius = "8px";
  el.style.boxShadow = "0 6px 18px rgba(0,0,0,.2)";
  el.style.zIndex = 9999;
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
};

/* ================== API WRAPPER ================== */
async function apiGET(sheet) {
  const url = `${API_URL}?sheet=${encodeURIComponent(sheet)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "GET lỗi");
  return json.rows || [];
}

// POST qua function GAS
async function apiPOST(action, data) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ action, ...data })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "POST lỗi");
    return json;
  } catch (err) {
    // Nếu lỗi mạng → cho xếp hàng chờ đồng bộ
    queuePending({ action, ...data });
    toast("Đã lưu **chờ đồng bộ** (offline).", "info");
    return { ok: true, queued: true };
  }
}

// Xếp hàng lệnh POST khi offline
function queuePending(item) {
  const q = JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || "[]");
  q.push({ ...item, ts: Date.now() });
  localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(q));
}

// Đồng bộ các lệnh chờ (gọi khi online lại hoặc sau mỗi lần thành công)
async function flushQueue() {
  const q = JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || "[]");
  if (!q.length) return;
  toast(`Đang đồng bộ ${q.length} lệnh…`);
  const left = [];
  for (const it of q) {
    try {
      await apiPOST(it.action, it); // re-post
    } catch {
      left.push(it); // giữ lại nếu vẫn lỗi
    }
  }
  localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(left));
  if (left.length) toast(`${left.length} lệnh còn lại sẽ thử sau.`, "info");
  else toast("Đồng bộ hoàn tất ✔", "success");
}

/* ================== ROUTER – SPA ================== */
const PAGES = {
  dashboard: "#viewDashboard",
  sanpham: "#viewSanPham",
  khachhang: "#viewKhachHang",
  donhang: "#viewDonHang"
};

function showPage(name) {
  Object.values(PAGES).forEach((sel) => {
    const el = $(sel);
    if (el) el.style.display = "none";
  });
  const el = $(PAGES[name]);
  if (el) el.style.display = "block";

  // High-level hooks
  if (name === "sanpham") loadSanPham();
  if (name === "khachhang") loadKhachHang();
  if (name === "donhang") {
    // Thiết lập mặc định bộ lọc ngày
    const from = $("#dhFrom");
    const to = $("#dhTo");
    if (from && !from.value) from.value = today().slice(0, 8) + "01";
    if (to && !to.value) to.value = today();
    loadDonHang();
  }
}

// Gán menu
function bindNav() {
  $$("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const to = btn.getAttribute("data-nav");
      showPage(to);
    });
  });
}

/* ================== SẢN PHẨM ================== */
async function loadSanPham() {
  const rows = await apiGET(SHEET.SP); // mảng 2D
  if (!rows.length) {
    $("#tblSP").innerHTML = `<tr><td>Chưa có dữ liệu</td></tr>`;
    return;
  }
  const [header, ...data] = rows;
  // dự kiến header: ["Mã SP","Tên sản phẩm","Size","Giá"]
  const html = data
    .map(
      (r) => `
    <tr>
      <td>${r[0] ?? ""}</td>
      <td>${r[1] ?? ""}</td>
      <td>${r[2] ?? ""}</td>
      <td class="text-right">${fMoney(r[3])}</td>
    </tr>`
    )
    .join("");
  $("#tblSP").innerHTML =
    `<tr><th>${header[0]}</th><th>${header[1]}</th><th>${header[2]}</th><th>${header[3]}</th></tr>` +
    html;
}

async function onCreateSanPham() {
  const ten = $("#spTen").value.trim();
  const size = $("#spSize").value.trim();
  const gia = Number($("#spGia").value || 0);

  if (!ten || !size || gia <= 0) {
    toast("Nhập đủ Tên/Size/Giá > 0", "error");
    return;
  }

  const rs = await apiPOST("createProduct", { data: { ten, size, gia } });
  if (!rs.queued) toast(`Đã lưu sản phẩm, mã: ${rs.ma_sp}`, "success");

  // Reset & refresh
  $("#spTen").value = "";
  $("#spSize").value = "";
  $("#spGia").value = "0";
  await flushQueue();
  await loadSanPham();
}

/* ================== KHÁCH HÀNG ================== */
let KH_CACHE = [];

async function loadKhachHang() {
  const rows = await apiGET(SHEET.KH);
  const [header, ...data] = rows;
  // header: ["MaKH","TenKH","Loai","SDT","Email","DiaChi","GhiChu"]
  KH_CACHE = data.map((r) => ({
    MaKH: r[0] || "",
    TenKH: r[1] || "",
    Loai: r[2] || "",
    SDT: r[3] || "",
    Email: r[4] || "",
    DiaChi: r[5] || "",
    GhiChu: r[6] || ""
  }));
  renderKhachHang(KH_CACHE, header);
}

function renderKhachHang(list, header = ["Mã KH", "Tên KH", "Loại", "SĐT", "Email", "Địa chỉ", "Ghi chú"]) {
  const htmlHeader =
    `<tr>${header.map((h) => `<th>${h}</th>`).join("")}</tr>`;
  const htmlRows = list
    .map(
      (x) => `
    <tr>
      <td>${x.MaKH}</td>
      <td>${x.TenKH}</td>
      <td>${x.Loai}</td>
      <td>${x.SDT}</td>
      <td>${x.Email}</td>
      <td>${x.DiaChi}</td>
      <td>${x.GhiChu}</td>
    </tr>`
    )
    .join("");
  $("#tblKH").innerHTML = htmlHeader + htmlRows;
}

function onSearchKH() {
  const q = ($("#khSearch")?.value || "").toLowerCase();
  const filtered = KH_CACHE.filter(
    (x) =>
      x.MaKH.toLowerCase().includes(q) ||
      x.TenKH.toLowerCase().includes(q) ||
      x.SDT.toLowerCase().includes(q) ||
      x.Email.toLowerCase().includes(q)
  );
  renderKhachHang(filtered);
}

async function onCreateKhachHang() {
  const ten = $("#khTen").value.trim();
  const loai = $("#khLoai").value.trim();
  const sdt = $("#khSDT").value.trim();
  const email = $("#khEmail").value.trim();
  const diachi = $("#khDiaChi").value.trim();
  const ghichu = $("#khGhiChu").value.trim();

  if (!ten || !loai || !sdt) {
    toast("Thiếu Tên/Loại/SĐT", "error");
    return;
  }

  const rs = await apiPOST("createCustomer", {
    data: { ten, loai, sdt, email, diachi, ghichu }
  });

  if (!rs.queued) toast(`Đã tạo khách hàng: ${rs.ma_kh}`, "success");

  // reset
  $("#khTen").value = "";
  $("#khLoai").value = "";
  $("#khSDT").value = "";
  $("#khEmail").value = "";
  $("#khDiaChi").value = "";
  $("#khGhiChu").value = "";

  await flushQueue();
  await loadKhachHang();
}

/* ================== ĐƠN HÀNG (XEM LẠI) ================== */
let DH_CACHE = [];

async function loadDonHang() {
  const rows = await apiGET(SHEET.DH);
  const [header, ...data] = rows;
  // header: ["Mã đơn","Khách hàng","Ngày tạo","Tổng tiền"]
  DH_CACHE = data.map((r) => ({
    MaDon: r[0] || "",
    Khach: r[1] || "",
    Ngay: r[2] || "",
    Tong: Number(r[3] || 0)
  }));

  renderDonHang(filterDonHang());
}

function filterDonHang() {
  const f = $("#dhFrom")?.value || "";
  const t = $("#dhTo")?.value || "";
  const q = ($("#dhSearch")?.value || "").toLowerCase();

  return DH_CACHE.filter((d) => {
    const okDate =
      (!f || d.Ngay >= f.replaceAll("-", "/")) &&
      (!t || d.Ngay <= t.replaceAll("-", "/"));
    const okQ =
      !q ||
      d.MaDon.toLowerCase().includes(q) ||
      d.Khach.toLowerCase().includes(q);
    return okDate && okQ;
  });
}

function renderDonHang(list) {
  const thead =
    `<tr><th>Mã đơn</th><th>Khách hàng</th><th>Ngày tạo</th><th class="text-right">Tổng tiền</th></tr>`;
  const tbody = list
    .map(
      (d) => `
    <tr>
      <td>${d.MaDon}</td>
      <td>${d.Khach}</td>
      <td>${d.Ngay}</td>
      <td class="text-right">${fMoney(d.Tong)}</td>
    </tr>`
    )
    .join("");
  $("#tblDH").innerHTML = thead + tbody;
}

/* ================== KHỞI TẠO ================== */
function bindActions() {
  // sản phẩm
  $("#btnLuuSP")?.addEventListener("click", onCreateSanPham);

  // khách hàng
  $("#btnThemKH")?.addEventListener("click", onCreateKhachHang);
  $("#khSearch")?.addEventListener("input", onSearchKH);

  // đơn hàng
  $("#dhFrom")?.addEventListener("change", () => renderDonHang(filterDonHang()));
  $("#dhTo")?.addEventListener("change", () => renderDonHang(filterDonHang()));
  $("#dhSearch")?.addEventListener("input", () => renderDonHang(filterDonHang()));

  // khi online lại → flush hàng đợi
  window.addEventListener("online", flushQueue);
}

async function init() {
  bindNav();
  bindActions();
  showPage("dashboard"); // trang mặc định
  // có thể tải quick-stats dashboard ở đây nếu cần
  await flushQueue(); // thử đồng bộ nếu còn lệnh cũ
}

// chạy
document.addEventListener("DOMContentLoaded", init);
